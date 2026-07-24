import { spawn, type ChildProcessByStdio } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import type { Readable } from "node:stream"

import { z } from "zod"

import { acquireProjectOperation, ProjectOperationBusyError } from "./projectOperations.js"

const phases = ["validate", "analyze", "plan", "build", "render", "qa", "deliver"] as const
const phaseStatusSchema = z.enum(["pending", "running", "completed", "failed", "skipped"])
const jobManifestSchema = z.object({
  status: z.enum(["running", "completed", "completed_with_warning", "failed", "paused"]),
  startedAt: z.string(),
  updatedAt: z.string(),
  currentPhase: z.enum(phases).optional(),
  error: z.object({ message: z.string() }).optional(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).passthrough()).optional(),
  phases: z.object({
    validate: z.object({ status: phaseStatusSchema }).passthrough(),
    analyze: z.object({ status: phaseStatusSchema }).passthrough(),
    plan: z.object({ status: phaseStatusSchema }).passthrough(),
    build: z.object({ status: phaseStatusSchema }).passthrough(),
    render: z.object({ status: phaseStatusSchema }).passthrough(),
    qa: z.object({ status: phaseStatusSchema }).passthrough(),
    deliver: z.object({ status: phaseStatusSchema }).passthrough(),
  }),
}).passthrough()
const projectManifestSchema = z.object({
  id: z.string(),
  tier: z.enum(["template", "lite", "premium"]),
  recipe: z.string().optional(),
  analysisDir: z.string(),
  inputDir: z.string(),
  selectedPhotos: z.string().optional(),
  story: z.string().optional(),
  timeline: z.string(),
  output: z.string(),
}).passthrough()

export const startJobInputSchema = z.object({
  mode: z.enum(["dry_run", "render"]),
  resume: z.boolean().default(false),
  deliver: z.boolean().default(false),
}).superRefine((input, context) => {
  if (input.mode === "dry_run" && input.deliver) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["deliver"], message: "Delivery requires render mode" })
  }
})

export type StartJobInput = z.input<typeof startJobInputSchema>
export type JobStatus = "not_started" | "pending" | "running" | "paused" | "failed" | "completed" | "completed_with_warning"
export type JobSnapshot = {
  projectId: string
  status: JobStatus
  currentPhase: (typeof phases)[number] | null
  progress: number
  error: string | null
  warnings: Array<{ code: string; message: string }>
  startedAt: string | null
  updatedAt: string
  mode: StartJobInput["mode"] | null
  deliver: boolean | null
  phases: Record<string, z.infer<typeof phaseStatusSchema>>
}
export type JobEvent =
  | { type: "snapshot"; data: JobSnapshot }
  | { type: "log"; data: { stream: "stdout" | "stderr"; line: string; timestamp: string } }

type ActiveJob = {
  child: ChildProcessByStdio<null, Readable, Readable>
  startedAt: string
  mode: StartJobInput["mode"]
  deliver: boolean
  cancelRequested: boolean
  log: ReturnType<typeof createWriteStream>
  manifestTimer: NodeJS.Timeout
  lastManifest: string
  releaseOperation: () => void
}

export class JobRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

function pendingPhases(): Record<string, z.infer<typeof phaseStatusSchema>> {
  return Object.fromEntries(phases.map((phase) => [phase, "pending" as const]))
}

function progressOf(manifest: z.infer<typeof jobManifestSchema>) {
  if (manifest.status === "completed" || manifest.status === "completed_with_warning") return 100
  const completed = phases.filter((phase) => ["completed", "skipped"].includes(manifest.phases[phase].status)).length
  return Math.round((completed / phases.length) * 100)
}

async function writeJsonAtomic(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

export function createJobRunner(engineRoot = process.cwd()) {
  const active = new Map<string, ActiveJob>()
  const listeners = new Map<string, Set<(event: JobEvent) => void>>()

  function paths(projectId: string) {
    const projectsDir = path.resolve(engineRoot, "projects")
    const projectDir = path.resolve(projectsDir, projectId)
    if (path.dirname(projectDir) !== projectsDir) throw new JobRequestError(400, "INVALID_PROJECT_ID", "Project id resolves outside the projects directory")
    return { projectDir, projectManifest: path.join(projectDir, "project.json") }
  }

  async function loadProject(projectId: string) {
    const resolved = paths(projectId)
    try {
      const manifest = projectManifestSchema.parse(JSON.parse(await readFile(resolved.projectManifest, "utf8")))
      if (manifest.id !== projectId) throw new JobRequestError(409, "PROJECT_ID_MISMATCH", "Project directory and manifest ids do not match")
      return { ...resolved, manifest, jobManifest: path.join(resolved.projectDir, manifest.analysisDir, "job-manifest.json") }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new JobRequestError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`)
      if (error instanceof JobRequestError) throw error
      throw new JobRequestError(500, "INVALID_PROJECT_MANIFEST", "Project manifest is invalid")
    }
  }

  function emit(projectId: string, event: JobEvent) {
    for (const listener of listeners.get(projectId) || []) listener(event)
  }

  async function snapshotFromDisk(projectId: string): Promise<JobSnapshot> {
    const project = await loadProject(projectId)
    const running = active.get(projectId)
    try {
      const raw = await readFile(project.jobManifest, "utf8")
      const manifest = jobManifestSchema.parse(JSON.parse(raw))
      const belongsToCurrentRun = !running || Date.parse(manifest.startedAt) >= Date.parse(running.startedAt)
      if (running && !belongsToCurrentRun) throw new Error("previous run")
      return {
        projectId,
        status: manifest.status,
        currentPhase: manifest.currentPhase || null,
        progress: progressOf(manifest),
        error: manifest.error?.message || null,
        warnings: manifest.warnings || [],
        startedAt: manifest.startedAt,
        updatedAt: manifest.updatedAt,
        mode: running?.mode || null,
        deliver: running?.deliver ?? null,
        phases: Object.fromEntries(phases.map((phase) => [phase, manifest.phases[phase].status])),
      }
    } catch (error) {
      if (!running && (error as NodeJS.ErrnoException).code !== "ENOENT") throw new JobRequestError(500, "INVALID_JOB_MANIFEST", "Job manifest is invalid")
      const now = new Date().toISOString()
      return {
        projectId,
        status: running ? "running" : "not_started",
        currentPhase: null,
        progress: 0,
        error: null,
        warnings: [],
        startedAt: running?.startedAt || null,
        updatedAt: running?.startedAt || now,
        mode: running?.mode || null,
        deliver: running?.deliver ?? null,
        phases: pendingPhases(),
      }
    }
  }

  async function publishSnapshot(projectId: string) {
    try { emit(projectId, { type: "snapshot", data: await snapshotFromDisk(projectId) }) } catch { /* route polling reports malformed state */ }
  }

  function pipeLogs(projectId: string, job: ActiveJob, stream: "stdout" | "stderr") {
    let remainder = ""
    job.child[stream].on("data", (chunk: Buffer) => {
      const text = remainder + chunk.toString("utf8")
      const lines = text.split(/\r?\n/)
      remainder = lines.pop() || ""
      for (const line of lines) {
        job.log.write(`[${stream}] ${line}\n`)
        emit(projectId, { type: "log", data: { stream, line, timestamp: new Date().toISOString() } })
      }
    })
    job.child[stream].on("end", () => {
      if (!remainder) return
      job.log.write(`[${stream}] ${remainder}\n`)
      emit(projectId, { type: "log", data: { stream, line: remainder, timestamp: new Date().toISOString() } })
    })
  }

  async function markCancelled(projectId: string) {
    const project = await loadProject(projectId)
    let document: Record<string, unknown>
    try {
      document = JSON.parse(await readFile(project.jobManifest, "utf8")) as Record<string, unknown>
    } catch {
      const manifest = project.manifest
      const now = new Date().toISOString()
      document = {
        schemaVersion: 1, projectId, status: "paused", startedAt: now, updatedAt: now,
        phases: Object.fromEntries(phases.map((phase) => [phase, { status: "pending" }])),
        artifacts: {
          photos: `${manifest.analysisDir}/photos.json`, photoContent: `${manifest.analysisDir}/photo_content.json`,
          selection: manifest.selectedPhotos || `${manifest.analysisDir}/photos.selected.json`, story: manifest.story || `${manifest.analysisDir}/story-template.generated.json`,
          timeline: manifest.timeline, qaDir: `${manifest.analysisDir}/qa`, output: manifest.output, deliveryDir: "output/deliver",
        },
      }
    }
    document.status = "paused"
    document.updatedAt = new Date().toISOString()
    delete document.error
    const currentPhase = typeof document.currentPhase === "string" ? document.currentPhase : null
    if (currentPhase && document.phases && typeof document.phases === "object") {
      const phaseMap = document.phases as Record<string, Record<string, unknown>>
      phaseMap[currentPhase] = { ...phaseMap[currentPhase], status: "pending", reason: "Cancelled by user" }
    }
    await mkdir(path.dirname(project.jobManifest), { recursive: true })
    await writeJsonAtomic(project.jobManifest, document)
  }

  async function markRunnerFailure(projectId: string, message: string) {
    await markCancelled(projectId)
    const project = await loadProject(projectId)
    const document = JSON.parse(await readFile(project.jobManifest, "utf8")) as Record<string, unknown>
    const phase = typeof document.currentPhase === "string" && phases.includes(document.currentPhase as (typeof phases)[number]) ? document.currentPhase : "validate"
    document.status = "failed"
    document.currentPhase = phase
    document.updatedAt = new Date().toISOString()
    document.error = { phase, message }
    const phaseMap = document.phases as Record<string, Record<string, unknown>>
    phaseMap[phase] = { ...phaseMap[phase], status: "failed", completedAt: new Date().toISOString() }
    await writeJsonAtomic(project.jobManifest, document)
  }

  async function terminate(child: ChildProcessByStdio<null, Readable, Readable>) {
    if (!child.pid) return
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
        killer.once("close", () => resolve())
        killer.once("error", () => { child.kill("SIGTERM"); resolve() })
      })
      return
    }
    try { process.kill(-child.pid, "SIGTERM") } catch { child.kill("SIGTERM") }
  }

  async function start(projectId: string, rawInput: StartJobInput) {
    const input = startJobInputSchema.parse(rawInput)
    if (active.has(projectId)) throw new JobRequestError(409, "JOB_ALREADY_RUNNING", `A job is already running for ${projectId}`)
    const project = await loadProject(projectId)
    let existingRaw: string | null = null
    try { existingRaw = await readFile(project.jobManifest, "utf8") } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
    if (existingRaw !== null) {
      let existingValue: unknown
      try { existingValue = JSON.parse(existingRaw) } catch { throw new JobRequestError(500, "INVALID_JOB_MANIFEST", "Job manifest is invalid") }
      const existing = jobManifestSchema.safeParse(existingValue)
      if (!existing.success) throw new JobRequestError(500, "INVALID_JOB_MANIFEST", "Job manifest is invalid")
      if (existing.data.status === "running") throw new JobRequestError(409, "JOB_ALREADY_RUNNING", `The project manifest already reports a running job for ${projectId}`)
    }

    const args = ["scripts/runProject.mjs", "--project", `projects/${projectId}`]
    if (input.mode === "dry_run") args.push("--dry-run")
    if (input.deliver) args.push("--deliver")
    if (input.resume) args.push("--resume")
    if (project.manifest.tier === "template" && project.manifest.recipe && !project.manifest.recipe.includes("/") && !project.manifest.recipe.includes("\\")) {
      args.push("--recipe", `story-templates/${project.manifest.recipe}.json`)
    }

    await mkdir(path.join(project.projectDir, "logs"), { recursive: true })
    let releaseOperation: () => void
    try { releaseOperation = acquireProjectOperation(engineRoot, projectId, "job") } catch (error) {
      if (error instanceof ProjectOperationBusyError) throw new JobRequestError(409, "PROJECT_BUSY", error.message)
      throw error
    }
    const startedAt = new Date().toISOString()
    const logPath = path.join(project.projectDir, "logs", `job-${startedAt.replace(/[:.]/g, "-")}.log`)
    let child: ChildProcessByStdio<null, Readable, Readable>
    try {
      child = spawn(process.execPath, args, {
        cwd: engineRoot,
        env: process.env,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      })
    } catch (error) {
      releaseOperation()
      throw error
    }
    const job: ActiveJob = {
      child, startedAt, mode: input.mode, deliver: input.deliver, cancelRequested: false,
      log: createWriteStream(logPath, { flags: "a" }), lastManifest: "",
      manifestTimer: setInterval(() => undefined, 60_000), releaseOperation,
    }
    clearInterval(job.manifestTimer)
    active.set(projectId, job)
    pipeLogs(projectId, job, "stdout")
    pipeLogs(projectId, job, "stderr")
    job.manifestTimer = setInterval(async () => {
      try {
        const value = await readFile(project.jobManifest, "utf8")
        if (value !== job.lastManifest) { job.lastManifest = value; await publishSnapshot(projectId) }
      } catch { /* runProject may not have initialized the manifest yet */ }
    }, 300)

    child.once("error", async (error) => {
      job.log.write(`[runner] ${error.message}\n`)
    })
    child.once("close", async (code) => {
      clearInterval(job.manifestTimer)
      if (job.cancelRequested) await markCancelled(projectId).catch(() => undefined)
      else if (code !== 0) {
        const snapshot = await snapshotFromDisk(projectId).catch(() => null)
        if (snapshot?.status === "running") await markRunnerFailure(projectId, `Pipeline process exited with code ${code ?? 1}`).catch(() => undefined)
      }
      job.log.end(`[runner] process exited with code ${code ?? 1}\n`)
      active.delete(projectId)
      job.releaseOperation()
      await publishSnapshot(projectId)
    })

    await publishSnapshot(projectId)
    return snapshotFromDisk(projectId)
  }

  async function cancel(projectId: string) {
    await loadProject(projectId)
    const job = active.get(projectId)
    if (!job) throw new JobRequestError(409, "JOB_NOT_RUNNING", `No active job is running for ${projectId}`)
    job.cancelRequested = true
    await terminate(job.child)
    await markCancelled(projectId)
    await publishSnapshot(projectId)
    return snapshotFromDisk(projectId)
  }

  function subscribe(projectId: string, listener: (event: JobEvent) => void) {
    const projectListeners = listeners.get(projectId) || new Set()
    projectListeners.add(listener)
    listeners.set(projectId, projectListeners)
    return () => {
      projectListeners.delete(listener)
      if (!projectListeners.size) listeners.delete(projectId)
    }
  }

  async function shutdown() {
    await Promise.all([...active.entries()].map(async ([projectId, job]) => {
      job.cancelRequested = true
      await terminate(job.child)
      await markCancelled(projectId).catch(() => undefined)
    }))
  }

  return { start, cancel, get: snapshotFromDisk, subscribe, shutdown }
}

export const jobRunner = createJobRunner()
