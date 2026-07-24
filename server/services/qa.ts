import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

const projectSchema = z.object({ id: z.string(), analysisDir: z.string().min(1), timeline: z.string().min(1) }).passthrough()
const stateSchema = z.object({
  status: z.enum(["running", "completed"]), stage: z.enum(["preflight", "render", "revising", "manual_review", "complete"]),
  preflightPasses: z.number().int().nonnegative(), preflightFixes: z.number().int().nonnegative(), preflightCapped: z.boolean(),
  revisions: z.number().int().nonnegative(), maxRevisions: z.number().int().nonnegative(), updatedAt: z.string(), result: z.string().optional(), manualReview: z.array(z.string()).optional(),
})
const summarySchema = z.object({
  status: z.enum(["clean", "delivered_with_flags", "blocked_pre_render"]), revisions: z.number().int().nonnegative(), maxRevisions: z.number().int().nonnegative(),
  preflightPasses: z.number().int().nonnegative().default(0), preflightFixes: z.number().int().nonnegative().default(0), preflightCapped: z.boolean().default(false),
  journal: z.array(z.string()).default([]), manualReview: z.array(z.string()).default([]),
})
const proxySchema = z.object({ verdict: z.enum(["ok", "review"]), problems: z.array(z.object({ id: z.string(), check: z.string(), flags: z.array(z.string()), detail: z.string().optional() })).default([]), checks: z.record(z.unknown()).default({}) }).passthrough()
const clipSchema = z.object({ scenes: z.number().int().optional(), passed: z.number().int().optional(), flagged: z.number().int().optional(), problems: z.array(z.object({ id: z.string(), check: z.string(), flags: z.array(z.string()) })).default([]) }).passthrough()
const jobSchema = z.object({ status: z.enum(["running", "completed", "failed", "paused"]), currentPhase: z.string().optional(), error: z.object({ message: z.string() }).optional() }).passthrough()

export type QaProblem = { id: string; check: string; flags: string[]; detail?: string }
export type QaSnapshot = {
  projectId: string; ready: boolean; status: "not_started" | "waiting" | "running" | "completed" | "failed"
  stage: "preflight" | "render" | "revising" | "manual_review" | "complete" | null; verdict: "ok" | "review" | "unknown" | null
  preflightPasses: number; preflightFixes: number; preflightCapped: boolean; revisions: number; maxRevisions: number
  manualReview: string[]; journal: string[]; proxyProblems: QaProblem[]; clipProblems: QaProblem[]; visionReason: string | null; updatedAt: string | null; error: string | null
}

export class QaRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

function isInside(parent: string, child: string) { const relative = path.relative(parent, child); return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative) }

export function createQaService(engineRoot = process.cwd()) {
  const projectsRoot = path.resolve(engineRoot, "projects")
  async function optional<T>(file: string, schema: z.ZodType<T>): Promise<T | null> {
    try { return schema.parse(JSON.parse(await readFile(file, "utf8"))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new QaRequestError(500, "INVALID_QA_REPORT", `QA report is invalid: ${path.basename(file)}`) }
  }
  async function get(projectId: string): Promise<QaSnapshot> {
    const projectDir = path.resolve(projectsRoot, projectId)
    if (path.dirname(projectDir) !== projectsRoot) throw new QaRequestError(400, "INVALID_PROJECT_ID", "Project id resolves outside the projects directory")
    let manifest: z.infer<typeof projectSchema>
    try { manifest = projectSchema.parse(JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new QaRequestError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`); throw new QaRequestError(500, "INVALID_PROJECT_MANIFEST", "Project manifest is invalid") }
    if (manifest.id !== projectId) throw new QaRequestError(409, "PROJECT_ID_MISMATCH", "Project directory and manifest ids do not match")
    const analysisDir = path.resolve(projectDir, manifest.analysisDir), timeline = path.resolve(projectDir, manifest.timeline)
    if (!isInside(projectDir, analysisDir) || !isInside(projectDir, timeline)) throw new QaRequestError(500, "INVALID_PROJECT_MANIFEST", "A QA path escapes the project directory")
    const base = path.basename(timeline, path.extname(timeline)), qaDir = path.join(analysisDir, "qa")
    const [state, summary, proxy, clip, job] = await Promise.all([
      optional(path.join(qaDir, `${base}.loop-state.json`), stateSchema), optional(path.join(qaDir, `${base}.loop.json`), summarySchema),
      optional(path.join(qaDir, `${base}.proxy.json`), proxySchema), optional(path.join(qaDir, `${base}.json`), clipSchema),
      optional(path.join(analysisDir, "job-manifest.json"), jobSchema),
    ])
    let ready = true
    try { await stat(timeline) } catch { ready = false }
    const jobQaRunning = job?.status === "running" && job.currentPhase === "qa"
    const failed = job?.status === "failed" && job.currentPhase === "qa"
    const status = failed ? "failed" : jobQaRunning ? "running" : summary ? "completed" : job?.status === "running" ? "waiting" : "not_started"
    const bookend = (proxy?.checks || {}).bookend as { status?: string; reason?: string } | undefined
    const visionReason = bookend?.status === "skipped" ? bookend.reason || "Bookend vision scoring was skipped" : null
    const verdict = !summary ? null : (summary.manualReview || []).length || summary.status !== "clean" ? "review" : visionReason ? "unknown" : "ok"
    return {
      projectId, ready, status, stage: state?.stage || null, verdict,
      preflightPasses: state?.preflightPasses ?? summary?.preflightPasses ?? 0, preflightFixes: state?.preflightFixes ?? summary?.preflightFixes ?? 0,
      preflightCapped: state?.preflightCapped ?? summary?.preflightCapped ?? false, revisions: state?.revisions ?? summary?.revisions ?? 0,
      maxRevisions: state?.maxRevisions ?? summary?.maxRevisions ?? 2, manualReview: summary?.manualReview || state?.manualReview || [], journal: summary?.journal || [],
      proxyProblems: (proxy?.problems || []) as QaProblem[], clipProblems: (clip?.problems || []) as QaProblem[], visionReason,
      updatedAt: state?.updatedAt || null, error: failed ? job?.error?.message || "QA failed" : null,
    }
  }
  return { get }
}

export const qaService = createQaService()
