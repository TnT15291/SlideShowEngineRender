import { spawn, type ChildProcessByStdio } from "node:child_process"
import { createWriteStream } from "node:fs"
import { mkdir, readFile, stat, utimes } from "node:fs/promises"
import path from "node:path"
import type { Readable } from "node:stream"

import { z } from "zod"

import { acquireProjectOperation, ProjectOperationBusyError } from "./projectOperations.js"
import { writeJsonAtomic } from "./atomicFile.js"
import { describeFailure, redactEnginePaths, type FailureCause } from "./failureCause.js"

// Enough to carry the stack trace and the lines above it that name the cause,
// without turning the manifest into a log file.
const LOG_TAIL_LINES = 80

/**
 * How many renders may run at once, across every project and every customer.
 *
 * One by default. A render is 15–48 minutes of ffmpeg on a single machine, so
 * five customers pressing the button together did not produce five films —
 * `projectOperations.ts` only ever locked *per project*, so all five spawned,
 * fought over the same cores, and all five took far longer than five sequential
 * runs would have. Beyond the cap, work waits in `queue` and starts when a slot
 * frees; nothing is rejected.
 *
 * Read per call so an operator can raise it in .env after moving rendering to a
 * bigger box, without a code change.
 */
function maxConcurrentRenders(): number {
  const raw = Number(process.env.STOREEL_MAX_CONCURRENT_RENDERS)
  return Number.isInteger(raw) && raw >= 1 ? raw : 1
}

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
  mode: z.literal("render", { error: (issue) => `Only "render" jobs can be started, not ${JSON.stringify(issue.input)}` }).default("render"),
  resume: z.boolean().default(true),
  deliver: z.boolean().default(false),
  acceptMusicMismatch: z.boolean().default(false),
})

export type StartJobInput = z.input<typeof startJobInputSchema>
export type JobStatus = "not_started" | "pending" | "queued" | "running" | "paused" | "failed" | "completed" | "completed_with_warning"
export type JobSnapshot = {
  projectId: string
  status: JobStatus
  currentPhase: (typeof phases)[number] | null
  progress: number
  error: string | null
  pauseReason?: string | null
  /**
   * How many renders are ahead of this one, when `status` is "queued": 0 means
   * next up. `null` for every other status.
   *
   * The customer is told the truth about the wait rather than watching a
   * progress bar that has not moved because nothing has started yet.
   */
  queuePosition: number | null
  warnings: Array<{ code: string; message: string }>
  manuallyCompleted: boolean
  startedAt: string | null
  updatedAt: string
  mode: StartJobInput["mode"] | null
  deliver: boolean | null
  phases: Record<string, z.infer<typeof phaseStatusSchema>>
  /**
   * A recognised, customer-language reason for a failure, when the output
   * matched one — see `failureCause.ts`. `null` means "unknown", not "fine".
   */
  cause: FailureCause | null
  /**
   * The tail of the run's own output, persisted with the manifest.
   * The live log arrives over SSE and lived only in the browser's memory, so
   * reloading the page after a failure threw away the sole explanation the
   * customer had been given.
   */
  logTail: string[]
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
  tail: string[]
}

/**
 * A render that has been accepted and paid for but has no slot yet.
 *
 * Holds the project-operation lease it acquired in `start`, so a queued
 * project cannot be re-analysed or re-edited out from under the run it is
 * waiting for. Deliberately in-memory only: a restart clears the queue, the
 * customer sees the project back at "not started", and pressing render again
 * reuses the open billing hold (see `findOpenReservation` in app.ts) rather
 * than charging twice.
 */
type QueuedJob = {
  projectId: string
  input: z.output<typeof startJobInputSchema>
  queuedAt: string
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

// `jobManifestSchema` is `.passthrough()`, so these ride along untyped and are
// read back defensively — an older manifest simply has neither.
function tailFromManifest(manifest: z.infer<typeof jobManifestSchema>): string[] {
  const value = (manifest as { logTail?: unknown }).logTail
  return Array.isArray(value) ? value.filter((line): line is string => typeof line === "string") : []
}

function causeFromManifest(manifest: z.infer<typeof jobManifestSchema>): FailureCause | null {
  const value = (manifest as { cause?: unknown }).cause
  if (!value || typeof value !== "object") return null
  const candidate = value as { code?: unknown; params?: unknown }
  if (typeof candidate.code !== "string") return null
  return { code: candidate.code, params: (candidate.params ?? {}) as Record<string, string | number> }
}

function progressOf(manifest: z.infer<typeof jobManifestSchema>) {
  if (manifest.status === "completed" || manifest.status === "completed_with_warning") return 100
  const completed = phases.filter((phase) => ["completed", "skipped"].includes(manifest.phases[phase].status)).length
  return Math.round((completed / phases.length) * 100)
}

export function createJobRunner(engineRoot = process.cwd()) {
  const active = new Map<string, ActiveJob>()
  /**
   * Slots claimed by a `launch` that has not reached `active.set` yet.
   *
   * Without this the cap does not hold. `launch` awaits before it registers
   * the job, so five `start` calls arriving in the same tick all read
   * `active.size === 0`, all decide there is room, and all spawn — the exact
   * five-ffmpeg pile-up the cap exists to prevent. Counting a slot from the
   * synchronous instant it is claimed closes that window.
   */
  const starting = new Set<string>()
  // FIFO. First in line is index 0, which is what `queuePosition` reports.
  const queue: QueuedJob[] = []
  const listeners = new Map<string, Set<(event: JobEvent) => void>>()

  function slotsInUse() {
    return active.size + starting.size
  }

  function queueIndex(projectId: string) {
    return queue.findIndex((entry) => entry.projectId === projectId)
  }

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

    // Answered before the manifest is read, and it has to be: a queued project
    // still has whatever manifest its previous run left behind (often
    // "completed" from an earlier delivery, or nothing at all), and reporting
    // that would tell the customer their new render had already finished.
    const waiting = queueIndex(projectId)
    if (waiting !== -1) {
      const entry = queue[waiting]
      return {
        projectId,
        status: "queued",
        currentPhase: null,
        progress: 0,
        error: null,
        pauseReason: null,
        warnings: [],
        manuallyCompleted: false,
        startedAt: null,
        updatedAt: entry.queuedAt,
        mode: entry.input.mode,
        deliver: entry.input.deliver,
        phases: pendingPhases(),
        cause: null,
        logTail: [],
        queuePosition: waiting,
      }
    }

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
        error: manifest.error?.message ? redactEnginePaths(manifest.error.message, engineRoot) : null,
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
        // Live runs stream their tail over SSE; a finished one reads it back
        // from the manifest that `persistRunDiagnostics` wrote.
        cause: causeFromManifest(manifest),
        logTail: running?.tail ?? tailFromManifest(manifest),
        queuePosition: null,
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
        cause: null,
        logTail: running?.tail ?? [],
        queuePosition: null,
      }
    }
  }

  async function publishSnapshot(projectId: string) {
    try { emit(projectId, { type: "snapshot", data: await snapshotFromDisk(projectId) }) } catch { /* route polling reports malformed state */ }
  }

  function pipeLogs(projectId: string, job: ActiveJob, stream: "stdout" | "stderr") {
    let remainder = ""
    // The on-disk log keeps the raw line (it is an operator artefact); the tail
    // and the SSE stream, both of which a customer can read, do not.
    const publish = (line: string) => {
      job.log.write(`[${stream}] ${line}\n`)
      const safe = redactEnginePaths(line, engineRoot)
      job.tail.push(`${stream === "stderr" ? "!" : ">"} ${safe}`)
      if (job.tail.length > LOG_TAIL_LINES) job.tail.splice(0, job.tail.length - LOG_TAIL_LINES)
      emit(projectId, { type: "log", data: { stream, line: safe, timestamp: new Date().toISOString() } })
    }
    job.child[stream].on("data", (chunk: Buffer) => {
      const text = remainder + chunk.toString("utf8")
      const lines = text.split(/\r?\n/)
      remainder = lines.pop() || ""
      for (const line of lines) publish(line)
    })
    job.child[stream].on("end", () => {
      if (remainder) publish(remainder)
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

  /**
   * Attach the run's output tail, and any cause recognised from it, to the job
   * manifest. `jobManifestSchema` passes unknown keys through, so these ride
   * alongside the engine's own fields without the engine knowing about them.
   */
  async function persistRunDiagnostics(projectId: string, tail: string[]) {
    if (!tail.length) return
    const project = await loadProject(projectId)
    const document = JSON.parse(await readFile(project.jobManifest, "utf8")) as Record<string, unknown>
    document.logTail = tail
    const cause = describeFailure(tail)
    if (cause) document.cause = cause
    if (document.error && typeof document.error === "object") {
      const error = document.error as { message?: unknown }
      if (typeof error.message === "string") error.message = redactEnginePaths(error.message, engineRoot)
    }
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
    if (queueIndex(projectId) !== -1) throw new JobRequestError(409, "JOB_ALREADY_QUEUED", `A job is already queued for ${projectId}`)
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

    // Taken here rather than in `launch` so it covers the wait as well as the
    // run — a queued project must not be re-analysed while it sits in line.
    let releaseOperation: () => void
    try { releaseOperation = acquireProjectOperation(engineRoot, projectId, "job") } catch (error) {
      if (error instanceof ProjectOperationBusyError) throw new JobRequestError(409, "PROJECT_BUSY", error.message)
      throw error
    }

    // The global cap. Checked *after* every per-project validation above, so a
    // request that would have failed anyway fails now with its real reason
    // instead of queueing and failing 40 minutes later.
    //
    // Nothing may await between this test and the `starting.add` below — that
    // pair is the whole mutual exclusion, and an await between them lets a
    // concurrent caller read a stale count.
    if (slotsInUse() >= maxConcurrentRenders()) {
      queue.push({ projectId, input, queuedAt: new Date().toISOString(), releaseOperation })
      await publishSnapshot(projectId)
      return snapshotFromDisk(projectId)
    }
    starting.add(projectId)

    try {
      return await launch(projectId, input, releaseOperation)
    } catch (error) {
      starting.delete(projectId)
      releaseOperation()
      throw error
    }
  }

  /**
   * Take the next queued job, if there is one and there is room.
   *
   * Called from the child's `close` handler and from `cancel`. Failing to
   * launch must not wedge the line, so a job that cannot start is dropped with
   * its manifest marked failed and the pump tries the one behind it.
   */
  function pump() {
    while (queue.length > 0 && slotsInUse() < maxConcurrentRenders()) {
      const next = queue.shift()!
      starting.add(next.projectId)
      launch(next.projectId, next.input, next.releaseOperation).catch(async (error) => {
        starting.delete(next.projectId)
        next.releaseOperation()
        await markRunnerFailure(next.projectId, error instanceof Error ? error.message : "Queued render could not be started")
          .catch(() => undefined)
        await publishSnapshot(next.projectId).catch(() => undefined)
        // The slot this job never took belongs to whoever is behind it.
        pump()
      })
    }
    // Everyone behind the job that just left moved up a place.
    for (const entry of queue) void publishSnapshot(entry.projectId).catch(() => undefined)
  }

  async function launch(projectId: string, input: z.output<typeof startJobInputSchema>, releaseOperation: () => void) {
    const project = await loadProject(projectId)
    const args = ["scripts/runProject.mjs", "--project", `projects/${projectId}`]
    if (input.deliver) args.push("--deliver")
    if (input.resume) args.push("--resume")
    if (input.acceptMusicMismatch) args.push("--accept-music-mismatch")
    if (project.manifest.tier === "template" && project.manifest.recipe && !project.manifest.recipe.includes("/") && !project.manifest.recipe.includes("\\")) {
      args.push("--recipe", `story-templates/${project.manifest.recipe}.json`)
    }

    await mkdir(path.join(project.projectDir, "logs"), { recursive: true })
    const startedAt = new Date().toISOString()
    const logPath = path.join(project.projectDir, "logs", `job-${startedAt.replace(/[:.]/g, "-")}.log`)
    const child: ChildProcessByStdio<null, Readable, Readable> = spawn(process.execPath, args, {
      cwd: engineRoot,
      env: process.env,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    })
    const job: ActiveJob = {
      child, startedAt, mode: input.mode, deliver: input.deliver, cancelRequested: false,
      log: createWriteStream(logPath, { flags: "a" }), lastManifest: "",
      manifestTimer: setInterval(() => undefined, 60_000), releaseOperation, tail: [],
    }
    clearInterval(job.manifestTimer)
    active.set(projectId, job)
    // Handed over from the provisional claim to the real one, in the same tick,
    // so the slot is never counted twice and never momentarily free.
    starting.delete(projectId)
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
        // Written after the failure is marked so it lands on the final
        // manifest: this is the only copy of the output that survives a reload.
        await persistRunDiagnostics(projectId, job.tail).catch(() => undefined)
      }
      job.log.end(`[runner] process exited with code ${code ?? 1}\n`)
      active.delete(projectId)
      job.releaseOperation()
      if (!job.cancelRequested) await publishSnapshot(projectId)
      // A slot just opened. Last, so the snapshot above still describes a
      // finished job rather than racing the next one's first manifest write.
      pump()
    })

    await publishSnapshot(projectId)
    return snapshotFromDisk(projectId)
  }

  async function cancel(projectId: string) {
    await loadProject(projectId)

    // Cancelling something that never started is just leaving the line. No
    // child to kill and no manifest to rewrite — writing "paused" here would
    // invent a run that never happened, and would clobber the manifest of the
    // last one that did.
    const waiting = queueIndex(projectId)
    if (waiting !== -1) {
      const [entry] = queue.splice(waiting, 1)
      entry.releaseOperation()
      await publishSnapshot(projectId)
      for (const behind of queue) void publishSnapshot(behind.projectId).catch(() => undefined)
      return snapshotFromDisk(projectId)
    }

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
    // Drained first, so a job finishing during teardown cannot pump a fresh
    // render into a process that is on its way out.
    for (const entry of queue.splice(0)) entry.releaseOperation()
    await Promise.all([...active.entries()].map(async ([projectId, job]) => {
      job.cancelRequested = true
      await terminate(job.child)
      await markCancelled(projectId).catch(() => undefined)
    }))
  }

  /** Renders waiting for a slot, in line order. Read by the admin queue panel. */
  function listQueued(): Array<{ projectId: string; queuedAt: string; position: number }> {
    return queue.map((entry, position) => ({ projectId: entry.projectId, queuedAt: entry.queuedAt, position }))
  }

  return { start, cancel, completeManually, get: snapshotFromDisk, subscribe, shutdown, listQueued }
}

export const jobRunner = createJobRunner()
