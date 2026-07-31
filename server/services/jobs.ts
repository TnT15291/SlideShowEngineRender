import { spawn, type ChildProcessByStdio } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, stat, utimes } from "node:fs/promises"
import path from "node:path"
import type { Readable } from "node:stream"

import { z } from "zod"

import { acquireProjectOperation, ProjectOperationBusyError } from "./projectOperations.js"
import { writeJsonAtomic } from "./atomicFile.js"

const phases = ["validate", "analyze", "plan", "build", "render", "qa", "deliver"] as const
const phaseStatusSchema = z.enum(["pending", "running", "completed", "failed", "skipped"])
const jobPhaseSchema = z.object({ status: phaseStatusSchema, reason: z.string().optional() }).passthrough()
export const manualCompletionReason = "Completed manually by an operator"
export const manualCompletionWarning = {
  code: "PROJECT_MANUALLY_COMPLETED",
  message: "Completed manually; review the QA findings before using the delivered video.",
}
const jobManifestSchema = z.object({
  status: z.enum(["running", "completed", "completed_with_warning", "failed", "paused"]),
  startedAt: z.string(),
  updatedAt: z.string(),
  currentPhase: z.enum(phases).optional(),
  error: z.object({ message: z.string() }).optional(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).passthrough()).optional(),
  phases: z.object({
    validate: jobPhaseSchema,
    analyze: jobPhaseSchema,
    plan: jobPhaseSchema,
    build: jobPhaseSchema,
    render: jobPhaseSchema,
    qa: jobPhaseSchema,
    deliver: jobPhaseSchema,
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
  mode: z.literal("render").default("render"),
  resume: z.boolean().default(true),
  deliver: z.boolean().default(false),
  acceptMusicMismatch: z.boolean().default(false),
})

export type StartJobInput = z.input<typeof startJobInputSchema>
export type JobStatus = "not_started" | "pending" | "running" | "paused" | "failed" | "completed" | "completed_with_warning"
export type JobSnapshot = {
  projectId: string
  status: JobStatus
  currentPhase: (typeof phases)[number] | null
  progress: number
  error: string | null
  pauseReason?: string | null
  warnings: Array<{ code: string; message: string }>
  manuallyCompleted: boolean
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
      let manifest = jobManifestSchema.parse(JSON.parse(raw))
      const belongsToCurrentRun = !running || Date.parse(manifest.startedAt) >= Date.parse(running.startedAt)
      if (running && !belongsToCurrentRun) throw new Error("previous run")
      manifest = await healOrphanedRun(projectId, manifest)
      return {
        projectId,
        status: manifest.status,
        currentPhase: manifest.currentPhase || null,
        progress: progressOf(manifest),
        error: manifest.error?.message || null,
        pauseReason: manifest.currentPhase ? String(manifest.phases[manifest.currentPhase].reason || "") || null : null,
        warnings: manifest.warnings?.length
          ? manifest.warnings
          : manifest.phases.deliver.reason === manualCompletionReason ? [manualCompletionWarning] : [],
        manuallyCompleted: manifest.phases.deliver.reason === manualCompletionReason,
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
        pauseReason: null,
        warnings: [],
        manuallyCompleted: false,
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

  // A crash, a forced kill (taskkill /F, Stop-Process -Force — neither lets
  // shutdown() run), or a lost machine can all leave a manifest saying
  // "running" forever: no child process anywhere will ever move it forward,
  // so the UI would show a stuck percentage with no sign anything is wrong.
  // "Is this run orphaned" has one true answer — no ActiveJob for it in THIS
  // process's memory — so both readers below (snapshotFromDisk, which the UI
  // polls, and start's pre-check, which must not refuse a retry because of a
  // run nothing is actually running) go through this one function rather than
  // re-deriving the same judgment call twice.
  async function healOrphanedRun(projectId: string, manifest: z.infer<typeof jobManifestSchema>) {
    if (manifest.status !== "running" || active.has(projectId)) return manifest
    await markRunnerFailure(projectId, "Render process was interrupted (server restarted or crashed) — retry to resume from where it left off.")
    const project = await loadProject(projectId)
    return jobManifestSchema.parse(JSON.parse(await readFile(project.jobManifest, "utf8")))
  }

  async function terminate(child: ChildProcessByStdio<null, Readable, Readable>) {
    if (!child.pid) return
    // taskkill's own process closing is not proof the TARGET process is gone —
    // it only confirms the kill request was issued. Callers (cancel/shutdown)
    // immediately follow this with an rm(recursive) on the project workspace,
    // and on Windows that raced ahead of the OS actually releasing the killed
    // process's file handles often enough to flake test cleanup with ENOTEMPTY.
    // child's own "close" (already wired in start(), a second listener here is
    // fine) is the real signal — it only fires once the process has exited.
    // Bounded, not indefinite: a process taskkill/SIGTERM genuinely can't
    // reach (permissions, a wedged driver call) must not hang cancel/shutdown
    // forever — 5s is generous for a teardown that normally takes ms.
    const exited = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5000)
      child.once("close", () => { clearTimeout(timer); resolve() })
    })
    if (process.platform === "win32") {
      await new Promise<void>((resolve) => {
        const killer = spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" })
        killer.once("close", () => resolve())
        killer.once("error", () => { child.kill("SIGTERM"); resolve() })
      })
    } else {
      try { process.kill(-child.pid, "SIGTERM") } catch { child.kill("SIGTERM") }
    }
    await exited
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
      const healed = await healOrphanedRun(projectId, existing.data)
      if (healed.status === "running") throw new JobRequestError(409, "JOB_ALREADY_RUNNING", `The project manifest already reports a running job for ${projectId}`)
    }

    const args = ["scripts/runProject.mjs", "--project", `projects/${projectId}`]
    if (input.deliver) args.push("--deliver")
    if (input.resume) args.push("--resume")
    if (input.acceptMusicMismatch) args.push("--accept-music-mismatch")
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
      // cancel()/shutdown() own the paused-manifest write. Writing it here too
      // races the caller's atomic rename on Windows after taskkill completes.
      if (!job.cancelRequested && code !== 0) {
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
    if (!job) {
      const snapshot = await snapshotFromDisk(projectId)
      if (snapshot.status !== "running" && snapshot.status !== "pending") {
        throw new JobRequestError(409, "JOB_NOT_RUNNING", `No active job is running for ${projectId}`)
      }
      // A server restart can leave a manifest at "running" after its child is
      // already gone. Treat that state as a stale job and make it resumable.
      await markCancelled(projectId)
      await publishSnapshot(projectId)
      return snapshotFromDisk(projectId)
    }
    job.cancelRequested = true
    await terminate(job.child)
    await markCancelled(projectId)
    await publishSnapshot(projectId)
    return snapshotFromDisk(projectId)
  }

  async function completeManually(projectId: string) {
    const project = await loadProject(projectId)
    if (active.has(projectId)) throw new JobRequestError(409, "JOB_ALREADY_RUNNING", `A job is still running for ${projectId}`)
    let document: z.infer<typeof jobManifestSchema>
    try {
      document = jobManifestSchema.parse(JSON.parse(await readFile(project.jobManifest, "utf8")))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new JobRequestError(409, "MANUAL_COMPLETION_NOT_AVAILABLE", "No project run is available to complete")
      throw new JobRequestError(500, "INVALID_JOB_MANIFEST", "Job manifest is invalid")
    }
    if (document.phases.render.status !== "completed") {
      throw new JobRequestError(409, "RENDER_NOT_COMPLETED", "The video render has not completed")
    }
    const failedAtQa = document.status === "failed" && document.currentPhase === "qa" && document.phases.qa.status === "failed"
    const alreadyCompletedManually = document.warnings?.some((warning) => warning.code === "PROJECT_MANUALLY_COMPLETED" || warning.code === "QA_MANUALLY_ACCEPTED")
    const awaitingManualCompletion = ["completed", "completed_with_warning", "paused"].includes(document.status)
      && document.phases.deliver.status !== "completed"
    if (alreadyCompletedManually || (!failedAtQa && !awaitingManualCompletion)) {
      throw new JobRequestError(409, "MANUAL_COMPLETION_NOT_AVAILABLE", "This project is not eligible for manual completion")
    }
    const output = path.resolve(project.projectDir, project.manifest.output)
    if (path.relative(project.projectDir, output).startsWith("..") || path.isAbsolute(path.relative(project.projectDir, output))) {
      throw new JobRequestError(500, "INVALID_PROJECT_MANIFEST", "The render output escapes the project directory")
    }
    try {
      const outputStat = await stat(output)
      if (!outputStat.isFile() || outputStat.size === 0) throw new Error("empty output")
    } catch {
      throw new JobRequestError(409, "RENDER_OUTPUT_NOT_READY", "The rendered video is missing or empty")
    }

    const now = new Date().toISOString()
    await utimes(output, new Date(now), new Date(now))
    document.status = "completed_with_warning"
    document.updatedAt = now
    if (failedAtQa) {
      document.phases.qa = { ...document.phases.qa, status: "completed", completedAt: now, reason: "Accepted manually after QA failure" }
    }
    document.phases.deliver = { ...document.phases.deliver, status: "completed", completedAt: now, reason: "Completed manually by an operator" }
    document.warnings = [
      ...(document.warnings || []).filter((warning) => warning.code !== "QA_MANUALLY_ACCEPTED" && warning.code !== "PROJECT_MANUALLY_COMPLETED"),
      manualCompletionWarning,
    ]
    delete document.currentPhase
    delete document.error
    await writeJsonAtomic(project.jobManifest, document)
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

  return { start, cancel, completeManually, get: snapshotFromDisk, subscribe, shutdown }
}

export const jobRunner = createJobRunner()
