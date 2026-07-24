import { randomUUID } from "node:crypto"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { createArtifactService, type ProjectArtifact } from "./artifacts.js"
import { acquireProjectOperation, ProjectOperationBusyError } from "./projectOperations.js"

const projectSchema = z.object({ id: z.string(), analysisDir: z.string().min(1) }).passthrough()
const approvalSchema = z.object({ approvedAt: z.string(), previewUpdatedAt: z.string(), previewSize: z.number().int().nonnegative() })
const releaseSchema = z.object({ releasedAt: z.string(), approvalAt: z.string() })

export type DeliveryApproval = { status: "none" | "approved" | "invalidated"; approvedAt: string | null; reason: string | null }
export type DeliverySnapshot = { projectId: string; artifacts: ProjectArtifact[]; summary: unknown | null; approval: DeliveryApproval; release: { releasedAt: string } | null }

export class DeliveryRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
}

export function createDeliveryService(engineRoot = process.cwd()) {
  const artifacts = createArtifactService(engineRoot), projectsRoot = path.resolve(engineRoot, "projects")
  async function project(projectId: string) {
    const projectDir = path.resolve(projectsRoot, projectId)
    if (path.dirname(projectDir) !== projectsRoot) throw new DeliveryRequestError(400, "INVALID_PROJECT_ID", "Project id resolves outside the projects directory")
    try {
      const manifest = projectSchema.parse(JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")))
      if (manifest.id !== projectId) throw new DeliveryRequestError(409, "PROJECT_ID_MISMATCH", "Project directory and manifest ids do not match")
      const analysisDir = path.resolve(projectDir, manifest.analysisDir)
      if (path.relative(projectDir, analysisDir).startsWith("..")) throw new DeliveryRequestError(500, "INVALID_PROJECT_MANIFEST", "Analysis directory escapes the project")
      return { projectDir, approvalFile: path.join(analysisDir, "delivery-approval.json"), releaseFile: path.join(analysisDir, "delivery-release.json") }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DeliveryRequestError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`)
      if (error instanceof DeliveryRequestError) throw error
      throw new DeliveryRequestError(500, "INVALID_PROJECT_MANIFEST", "Project manifest is invalid")
    }
  }
  async function optional<T>(file: string, schema?: z.ZodType<T>): Promise<T | null> {
    try { const value = JSON.parse(await readFile(file, "utf8")); return schema ? schema.parse(value) : value }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new DeliveryRequestError(500, "INVALID_DELIVERY_DATA", `Delivery data is invalid: ${path.basename(file)}`) }
  }
  async function get(projectId: string): Promise<DeliverySnapshot> {
    const files = await project(projectId), list = await artifacts.list(projectId)
    const preview = list.find((item) => item.id === "preview"), summaryArtifact = list.find((item) => item.id === "summary")
    const [record, released] = await Promise.all([optional(files.approvalFile, approvalSchema), optional(files.releaseFile, releaseSchema)])
    let approval: DeliveryApproval = { status: "none", approvedAt: null, reason: null }
    if (record) {
      const current = preview?.ready && preview.updatedAt === record.previewUpdatedAt && preview.size === record.previewSize
      approval = current ? { status: "approved", approvedAt: record.approvedAt, reason: null } : { status: "invalidated", approvedAt: record.approvedAt, reason: preview?.stale ? "Timeline changed after approval" : "Approved preview no longer matches the current delivery preview" }
    }
    let summary: unknown | null = null
    if (summaryArtifact?.ready) summary = await optional(path.join(files.projectDir, "output", "deliver", "project_summary.json"))
    const release = released && approval.status === "approved" && released.approvalAt === approval.approvedAt ? { releasedAt: released.releasedAt } : null
    return { projectId, artifacts: list, summary, approval, release }
  }
  async function locked<T>(projectId: string, action: () => Promise<T>) {
    let release: (() => void) | undefined
    try { release = acquireProjectOperation(engineRoot, projectId, "delivery") } catch (error) {
      if (error instanceof ProjectOperationBusyError) throw new DeliveryRequestError(409, "PROJECT_BUSY", error.message)
      throw error
    }
    try { return await action() } finally { release() }
  }
  async function approve(projectId: string) {
    return locked(projectId, async () => {
      const files = await project(projectId), preview = (await artifacts.list(projectId)).find((item) => item.id === "preview")
      if (!preview?.ready || !preview.updatedAt || preview.size === null) throw new DeliveryRequestError(409, "PREVIEW_NOT_READY", preview?.stale ? "The preview is stale; rerun delivery before approval" : "Generate a delivery preview before approval")
      await atomicJson(files.approvalFile, { approvedAt: new Date().toISOString(), previewUpdatedAt: preview.updatedAt, previewSize: preview.size })
      await rm(files.releaseFile, { force: true })
      return get(projectId)
    })
  }
  async function release(projectId: string) {
    return locked(projectId, async () => {
      const files = await project(projectId), snapshot = await get(projectId), master = snapshot.artifacts.find((item) => item.id === "delivery")
      if (snapshot.approval.status !== "approved" || !snapshot.approval.approvedAt) throw new DeliveryRequestError(409, "PREVIEW_APPROVAL_REQUIRED", "Approve the current preview before releasing the full film")
      if (!master?.ready) throw new DeliveryRequestError(409, "DELIVERY_NOT_READY", "The delivery master is not ready")
      await atomicJson(files.releaseFile, { releasedAt: new Date().toISOString(), approvalAt: snapshot.approval.approvedAt })
      return get(projectId)
    })
  }
  return { get, approve, release }
}

export const deliveryService = createDeliveryService()
