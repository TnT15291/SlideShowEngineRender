import { spawn } from "node:child_process"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { z } from "zod"

import { acquireProjectOperation, ProjectOperationBusyError } from "./projectOperations.js"

export const revisionInputSchema = z.object({ request: z.string().trim().min(1).max(10_000), maxRounds: z.number().int().min(1).max(20).default(2), confirmRestory: z.boolean().optional() })
export const revisionUndoSchema = z.object({ round: z.number().int().positive(), maxRounds: z.number().int().min(1).max(20).default(2) })
export type RevisionInput = z.infer<typeof revisionInputSchema>
export type RevisionUndoInput = z.infer<typeof revisionUndoSchema>
export type RevisionDirective = { id: string; round: number; quote: string; kind: string; op: string; target: unknown; supersededBy?: number; undoneBy?: number }
export type RevisionRound = { round: number; status: "active" | "superseded" | "undone"; directives: RevisionDirective[]; undoable: boolean }
export type RevisionSnapshot = { projectId: string; maxRounds: number; usedRounds: number; remainingRounds: number; nextRound: number; rounds: RevisionRound[] }
export type RevisionResult = { round: number | null; blastRadius: "timeline" | "build" | "plan" | null; requiresRestory: boolean; destructive: boolean; output: string; snapshot: RevisionSnapshot }

const manifestSchema = z.object({ id: z.string(), analysisDir: z.string().min(1) }).passthrough()
const directiveSchema = z.object({ id: z.string(), round: z.number().int(), quote: z.string(), kind: z.string(), op: z.string(), target: z.unknown(), supersededBy: z.number().int().optional(), undoneBy: z.number().int().optional() }).passthrough()
const ledgerSchema = z.object({ directives: z.array(directiveSchema).default([]) }).passthrough()

export class RevisionRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message) }
}

function inside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function atomicJson(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try { await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" }); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
}

export function createRevisionService(engineRoot = process.cwd(), revisionScript = path.resolve(engineRoot, "scripts", "reviseProject.mjs")) {
  const projectsRoot = path.resolve(engineRoot, "projects")

  async function project(projectId: string) {
    const projectDir = path.resolve(projectsRoot, projectId)
    if (path.dirname(projectDir) !== projectsRoot) throw new RevisionRequestError(400, "INVALID_PROJECT_ID", "Project id resolves outside the projects directory")
    try {
      const manifest = manifestSchema.parse(JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")))
      if (manifest.id !== projectId) throw new RevisionRequestError(409, "PROJECT_ID_MISMATCH", "Project directory and manifest ids do not match")
      const ledgerFile = path.resolve(projectDir, "directives.json")
      const jobFile = path.resolve(projectDir, manifest.analysisDir, "job-manifest.json")
      if (!inside(projectDir, ledgerFile) || !inside(projectDir, jobFile)) throw new RevisionRequestError(500, "INVALID_PROJECT_MANIFEST", "A project artifact path escapes the project directory")
      return { projectDir, ledgerFile, jobFile }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new RevisionRequestError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`)
      if (error instanceof RevisionRequestError) throw error
      throw new RevisionRequestError(500, "INVALID_PROJECT_MANIFEST", "Project manifest is invalid")
    }
  }

  async function snapshot(projectId: string, maxRounds = 2): Promise<RevisionSnapshot> {
    const files = await project(projectId)
    let directives: RevisionDirective[] = []
    try { directives = ledgerSchema.parse(JSON.parse(await readFile(files.ledgerFile, "utf8"))).directives as RevisionDirective[] }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new RevisionRequestError(500, "INVALID_REVISION_LEDGER", "Revision ledger is invalid") }
    const groups = new Map<number, RevisionDirective[]>()
    for (const directive of directives) if (directive.round > 0) groups.set(directive.round, [...(groups.get(directive.round) || []), directive])
    const rounds = [...groups.entries()].sort(([a], [b]) => b - a).map(([round, entries]): RevisionRound => ({
      round, directives: entries, undoable: entries.some((item) => item.undoneBy === undefined),
      status: entries.every((item) => item.undoneBy !== undefined) ? "undone" : entries.every((item) => item.supersededBy !== undefined) ? "superseded" : "active",
    }))
    const nextRound = Math.max(0, ...directives.map((item) => item.round)) + 1
    return { projectId, maxRounds, usedRounds: rounds.length, remainingRounds: Math.max(0, maxRounds - rounds.length), nextRound, rounds }
  }

  function run(args: string[]) {
    return new Promise<{ code: number; output: string }>((resolve, reject) => {
      const child = spawn(process.execPath, [revisionScript, ...args], { cwd: engineRoot, windowsHide: true, env: process.env })
      let stdout = "", stderr = ""
      child.stdout.on("data", (chunk) => { stdout += String(chunk) })
      child.stderr.on("data", (chunk) => { stderr += String(chunk) })
      child.once("error", reject)
      child.once("close", (code) => resolve({ code: code ?? 1, output: `${stdout}${stderr}`.trim() }))
    })
  }

  async function normalizePaused(jobFile: string) {
    try {
      const value = JSON.parse(await readFile(jobFile, "utf8"))
      if (value.status === "running") { value.status = "paused"; value.updatedAt = new Date().toISOString(); await atomicJson(jobFile, value) }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  }

  function parse(output: string) {
    const match = /round\s+(\d+):[\s\S]*?blast radius = (timeline|build|plan)/i.exec(output)
    return { round: match ? Number(match[1]) : null, blastRadius: (match?.[2]?.toLowerCase() || null) as RevisionResult["blastRadius"], requiresRestory: /RE-TELLING|confirm-restory/i.test(output), destructive: /THIS DESTROYS WORK/i.test(output) }
  }

  function failure(result: { code: number; output: string }): never {
    if (result.code === 4) throw new RevisionRequestError(409, "RESTORY_CONFIRMATION_REQUIRED", "This revision retells the film and needs explicit confirmation", result.output)
    if (result.code === 5) throw new RevisionRequestError(409, "REVISION_BUDGET_EXCEEDED", "Revision budget has been spent", result.output)
    throw new RevisionRequestError(400, "REVISION_FAILED", result.output || "Revision command failed")
  }

  async function operate(projectId: string, args: string[], maxRounds: number, mutate: boolean): Promise<RevisionResult> {
    const files = await project(projectId)
    let release: (() => void) | undefined
    try { release = acquireProjectOperation(engineRoot, projectId, "revision") } catch (error) {
      if (error instanceof ProjectOperationBusyError) throw new RevisionRequestError(409, "PROJECT_BUSY", error.message)
      throw error
    }
    try {
      const result = await run(["--project", path.relative(engineRoot, files.projectDir), ...args, "--max-rounds", String(maxRounds)])
      if (result.code !== 0) failure(result)
      if (mutate) await normalizePaused(files.jobFile)
      return { ...parse(result.output), output: result.output, snapshot: await snapshot(projectId, maxRounds) }
    } finally { release() }
  }

  return {
    get: snapshot,
    preview: (projectId: string, input: RevisionInput) => operate(projectId, ["--request", input.request, "--preview"], input.maxRounds, false),
    apply: (projectId: string, input: RevisionInput) => operate(projectId, ["--request", input.request, ...(input.confirmRestory ? ["--confirm-restory"] : [])], input.maxRounds, true),
    undo: (projectId: string, input: RevisionUndoInput) => operate(projectId, ["--undo", String(input.round)], input.maxRounds, true),
  }
}

export const revisionService = createRevisionService()
