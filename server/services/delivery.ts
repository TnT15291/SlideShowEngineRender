import { spawn } from "node:child_process"
import { readFile, rm } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { createArtifactService, type ProjectArtifact } from "./artifacts.js"
import { acquireProjectOperation, ProjectOperationBusyError } from "./projectOperations.js"
import { writeJsonAtomic } from "./atomicFile.js"

const projectSchema = z.object({
  id: z.string(),
  analysisDir: z.string().min(1),
  timeline: z.string().min(1),
  tier: z.enum(["template", "lite", "premium"]).optional(),
}).passthrough()
const approvalSchema = z.object({ approvedAt: z.string(), previewUpdatedAt: z.string(), previewSize: z.number().int().nonnegative() })
const releaseSchema = z.object({ releasedAt: z.string(), approvalAt: z.string() })

export type DeliveryApproval = { status: "none" | "approved" | "invalidated"; approvedAt: string | null; reason: string | null }
export type DeliverySnapshot = { projectId: string; artifacts: ProjectArtifact[]; summary: unknown | null; approval: DeliveryApproval; release: { releasedAt: string } | null }

export class DeliveryRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
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
      const timelineFile = path.resolve(projectDir, manifest.timeline)
      if (path.relative(projectDir, timelineFile).startsWith("..")) throw new DeliveryRequestError(500, "INVALID_PROJECT_MANIFEST", "Timeline path escapes the project")
      return {
        projectDir, analysisDir, timelineFile, tier: manifest.tier ?? null,
        approvalFile: path.join(analysisDir, "delivery-approval.json"), releaseFile: path.join(analysisDir, "delivery-release.json"),
      }
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
  // deliver.mjs only knows director|template|lite|unknown. Premium is the one tier
  // that can fall back mid-render, and renderWithRetry records which tier actually
  // reached the screen in analysis/tier.json — the same file runProject.mjs's own
  // --deliver phase reads (see survivingTier() there) — so both paths report the
  // same tier for one project.
  async function resolvedTier(files: Awaited<ReturnType<typeof project>>): Promise<string> {
    if (files.tier !== "premium") return files.tier ?? "unknown"
    const recorded = await optional<{ tier?: string }>(path.join(files.analysisDir, "tier.json"))
    return recorded?.tier || "unknown"
  }
  // Packages the delivery output fresh from the current render + timeline — the
  // exact scripts/deliver.mjs invocation runProject.mjs's own --deliver phase uses
  // (60s watermarked preview, full unwatermarked master). Approve runs this itself
  // so an operator never has to know a separate "deliver" job mode exists; without
  // it, every re-render leaves the package stale with no way left in the app to
  // freshen it.
  function regenerate(files: Awaited<ReturnType<typeof project>>): Promise<void> {
    return resolvedTier(files).then((tier) => new Promise<void>((resolve, reject) => {
      const args = [
        "scripts/deliver.mjs", files.timelineFile,
        "--tier", tier,
        "--analysis-dir", files.analysisDir,
        "--out-dir", path.join(files.projectDir, "output", "deliver"),
        "--preview-seconds", "60",
        "--watermark", "StoReel Preview",
      ]
      const child = spawn(process.execPath, args, { cwd: engineRoot, windowsHide: true })
      let stderr = ""
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk })
      child.on("error", (error) => reject(new DeliveryRequestError(500, "DELIVERY_REGENERATE_FAILED", error.message)))
      child.on("exit", (code) => code === 0
        ? resolve()
        : reject(new DeliveryRequestError(500, "DELIVERY_REGENERATE_FAILED", stderr.trim().slice(0, 500) || `deliver.mjs exited ${code}`)))
    }))
  }
  async function approve(projectId: string) {
    return locked(projectId, async () => {
      const files = await project(projectId)
      let preview = (await artifacts.list(projectId)).find((item) => item.id === "preview")
      if (!preview?.ready) {
        await regenerate(files)
        preview = (await artifacts.list(projectId)).find((item) => item.id === "preview")
      }
      if (!preview?.ready || !preview.updatedAt || preview.size === null) throw new DeliveryRequestError(409, "PREVIEW_NOT_READY", "Generate a delivery preview before approval")
      await writeJsonAtomic(files.approvalFile, { approvedAt: new Date().toISOString(), previewUpdatedAt: preview.updatedAt, previewSize: preview.size })
      await rm(files.releaseFile, { force: true })
      return get(projectId)
    })
  }
  async function release(projectId: string) {
    return locked(projectId, async () => {
      const files = await project(projectId), snapshot = await get(projectId), master = snapshot.artifacts.find((item) => item.id === "delivery")
      if (snapshot.approval.status !== "approved" || !snapshot.approval.approvedAt) throw new DeliveryRequestError(409, "PREVIEW_APPROVAL_REQUIRED", "Approve the current preview before releasing the full film")
      if (!master?.ready) throw new DeliveryRequestError(409, "DELIVERY_NOT_READY", "The delivery master is not ready")
      await writeJsonAtomic(files.releaseFile, { releasedAt: new Date().toISOString(), approvalAt: snapshot.approval.approvedAt })
      return get(projectId)
    })
  }
  return { get, approve, release }
}

export const deliveryService = createDeliveryService()
