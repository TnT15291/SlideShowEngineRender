import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createJobRunner, JobRequestError } from "./jobs.js"

async function workspace(projectIds: string[] = ["linh-nam"]) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-jobs-"))
  for (const id of projectIds) {
    const projectDir = path.join(root, "projects", id)
    await mkdir(path.join(projectDir, "analysis"), { recursive: true })
    await mkdir(path.join(projectDir, "input"), { recursive: true })
    await writeFile(path.join(projectDir, "project.json"), JSON.stringify({
      version: 1, id, name: id, tier: "lite", inputDir: "input", music: [],
      analysisDir: "analysis", selectedPhotos: "analysis/photos.selected.json", story: "analysis/story.json",
      timeline: "timeline/timeline.json", output: "output/final.mp4", quality: "share",
    }))
  }
  await mkdir(path.join(root, "scripts"), { recursive: true })
  await writeFile(path.join(root, "scripts", "runProject.mjs"), `
import fs from "node:fs";
import path from "node:path";
const projectArg = process.argv[process.argv.indexOf("--project") + 1];
const project = JSON.parse(fs.readFileSync(path.join(projectArg, "project.json"), "utf8"));
const file = path.join(projectArg, project.analysisDir, "job-manifest.json");
const now = new Date().toISOString();
const phase = (status) => ({ status });
const document = { schemaVersion: 1, projectId: project.id, status: "running", startedAt: now, updatedAt: now, currentPhase: "analyze", phases: { validate: phase("completed"), analyze: phase("running"), plan: phase("pending"), build: phase("pending"), render: phase("pending"), qa: phase("pending"), deliver: phase("pending") }, artifacts: {} };
fs.writeFileSync(file, JSON.stringify(document));
console.log("stub pipeline started");
console.log("deliver=" + process.argv.includes("--deliver"));
console.log("acceptMusicMismatch=" + process.argv.includes("--accept-music-mismatch"));
if (process.argv.includes("--dry-run")) setTimeout(() => { document.status = "completed"; document.updatedAt = new Date().toISOString(); delete document.currentPhase; for (const value of Object.values(document.phases)) value.status = "completed"; fs.writeFileSync(file, JSON.stringify(document)); }, 120);
else setInterval(() => {}, 1000);
`, "utf8")
  return { root }
}

/**
 * Delete a test workspace, tolerating Windows' delayed handle release.
 *
 * `terminate()` waits for the child's "close", but on Windows the OS can still
 * be holding the killed process's handles on files under the project directory
 * for a few more milliseconds, and `rm` then fails with ENOTEMPTY/EBUSY. That
 * is a teardown artefact, not a fault in the runner, so it is retried rather
 * than allowed to fail a test that already passed.
 */
async function removeWorkspace(root: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true })
      return
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== "ENOTEMPTY" && code !== "EBUSY" && code !== "EPERM") throw error
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  // Out of retries: let the real error surface rather than hiding a directory
  // something is genuinely still holding.
  await rm(root, { recursive: true, force: true })
}

async function waitFor(check: () => Promise<boolean>, timeout = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("Timed out waiting for job state")
}

test("job runner locks each project, streams logs, and records cancellation as paused", async (context) => {
  const { root } = await workspace()
  const runner = createJobRunner(root)
  context.after(async () => { await runner.shutdown(); await removeWorkspace(root) })
  const events: string[] = []
  const unsubscribe = runner.subscribe("linh-nam", (event) => { if (event.type === "log") events.push(event.data.line) })

  const started = await runner.start("linh-nam", { mode: "render", resume: false, deliver: true })
  assert.equal(started.status, "running")
  assert.equal(started.deliver, true)
  await assert.rejects(runner.start("linh-nam", { mode: "render", resume: false }), (error: unknown) => error instanceof JobRequestError && error.code === "JOB_ALREADY_RUNNING")
  await waitFor(async () => events.includes("stub pipeline started"))
  await waitFor(async () => events.includes("deliver=true"))
  await waitFor(async () => events.includes("acceptMusicMismatch=false"))
  const cancelled = await runner.cancel("linh-nam")
  assert.equal(cancelled.status, "paused")
  await runner.start("linh-nam", { mode: "render", resume: true, acceptMusicMismatch: true })
  await waitFor(async () => events.includes("acceptMusicMismatch=true"))
  await runner.cancel("linh-nam")
  unsubscribe()
})

test("five simultaneous renders produce one running job and four queued, and the queue drains in order", async (context) => {
  const ids = ["job-one", "job-two", "job-three", "job-four", "job-five"]
  const { root } = await workspace(ids)
  const runner = createJobRunner(root)
  context.after(async () => { await runner.shutdown(); await removeWorkspace(root) })

  // The whole point of G2.6: five customers pressing render at the same moment
  // used to spawn five ffmpeg processes on one machine. Started in parallel, as
  // five separate HTTP requests would arrive.
  const snapshots = await Promise.all(ids.map((id) => runner.start(id, { mode: "render", resume: false })))

  // Which of five simultaneous callers wins the slot is not defined — they
  // race through their own validation before reaching the admission check — so
  // the assertions are about the invariant, not about a particular winner.
  const runningIds = snapshots.filter((snapshot) => snapshot.status === "running").map((snapshot) => snapshot.projectId)
  const queuedSnapshots = snapshots.filter((snapshot) => snapshot.status === "queued")
  assert.equal(runningIds.length, 1)
  assert.equal(queuedSnapshots.length, 4)
  // Not rejected, not errored — waiting, and each told where it stands.
  assert.deepEqual([...queuedSnapshots.map((snapshot) => snapshot.queuePosition)].sort(), [0, 1, 2, 3])
  assert.equal(snapshots.find((snapshot) => snapshot.status === "running")?.queuePosition, null)

  const [runningId] = runningIds
  const line = runner.listQueued().map((entry) => entry.projectId)
  assert.deepEqual([...line].sort(), ids.filter((id) => id !== runningId).sort())

  // A queued project reports its position on a fresh read too, not only in the
  // snapshot that start() returned.
  const third = line[2]
  assert.equal((await runner.get(third)).status, "queued")
  assert.equal((await runner.get(third)).queuePosition, 2)

  // Pressing render twice on a queued project is refused rather than silently
  // adding it to the line a second time.
  await assert.rejects(
    runner.start(third, { mode: "render", resume: false }),
    (error: unknown) => error instanceof JobRequestError && error.code === "JOB_ALREADY_QUEUED",
  )

  // Leaving the line moves everyone behind it up, and does not disturb the
  // job that is actually running.
  await runner.cancel(line[1])
  assert.deepEqual(runner.listQueued().map((entry) => entry.projectId), [line[0], line[2], line[3]])
  assert.equal((await runner.get(third)).queuePosition, 1)
  assert.equal((await runner.get(runningId)).status, "running")

  // Ending the running job hands the slot to the head of the queue, with no
  // further prompting.
  await runner.cancel(runningId)
  await waitFor(async () => (await runner.get(line[0])).status === "running")
  assert.deepEqual(runner.listQueued().map((entry) => entry.projectId), [line[2], line[3]])
  assert.equal((await runner.get(line[2])).queuePosition, 0)
})

test("the concurrency cap is read from the environment", async (context) => {
  const ids = ["cap-one", "cap-two", "cap-three"]
  const { root } = await workspace(ids)
  const previous = process.env.STOREEL_MAX_CONCURRENT_RENDERS
  process.env.STOREEL_MAX_CONCURRENT_RENDERS = "2"
  const runner = createJobRunner(root)
  context.after(async () => {
    await runner.shutdown()
    if (previous === undefined) delete process.env.STOREEL_MAX_CONCURRENT_RENDERS
    else process.env.STOREEL_MAX_CONCURRENT_RENDERS = previous
    await removeWorkspace(root)
  })

  const snapshots = await Promise.all(ids.map((id) => runner.start(id, { mode: "render", resume: false })))
  // Two slots, so exactly one of the three has to wait — which one is a race.
  assert.deepEqual([...snapshots.map((snapshot) => snapshot.status)].sort(), ["queued", "running", "running"])
})

test("job runner rejects public dry runs and reports missing projects", async (context) => {
  const { root } = await workspace()
  const runner = createJobRunner(root)
  context.after(async () => { await runner.shutdown(); await removeWorkspace(root) })
  await assert.rejects(runner.get("missing"), (error: unknown) => error instanceof JobRequestError && error.code === "PROJECT_NOT_FOUND")
  await assert.rejects(
    runner.start("linh-nam", { mode: "dry_run", resume: false } as never),
    /dry_run/,
  )
})

test("job runner reports nothing to cancel once a stale running manifest has self-healed to failed", async (context) => {
  const { root } = await workspace()
  const runner = createJobRunner(root)
  context.after(async () => { await runner.shutdown(); await removeWorkspace(root) })
  const phase = (status: string) => ({ status })
  await writeFile(path.join(root, "projects", "linh-nam", "analysis", "job-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    projectId: "linh-nam",
    status: "running",
    startedAt: "2026-07-24T10:00:00.000Z",
    updatedAt: "2026-07-24T10:01:00.000Z",
    currentPhase: "render",
    phases: {
      validate: phase("completed"), analyze: phase("completed"), plan: phase("completed"),
      build: phase("completed"), render: phase("running"), qa: phase("pending"), deliver: phase("pending"),
    },
    artifacts: {},
  }))

  // cancel() reads the manifest itself before deciding whether there is
  // anything to cancel — that read now self-heals the orphaned "running"
  // state to "failed" (healOrphanedRun), so by the time cancel's own check
  // runs there is genuinely nothing left running to cancel. This supersedes
  // the old "cancel resolves a stale run to paused" behavior: the run is now
  // resolved the instant anything reads it, not only when a human clicks
  // cancel, so cancel correctly reports JOB_NOT_RUNNING instead.
  await assert.rejects(runner.cancel("linh-nam"), (error: unknown) => error instanceof JobRequestError && error.code === "JOB_NOT_RUNNING")
  const snapshot = await runner.get("linh-nam")
  assert.equal(snapshot.status, "failed")
  assert.equal(snapshot.phases.render, "failed")
})

test("job runner self-heals a stale running manifest to failed, and a retry is not blocked by it", async (context) => {
  const { root } = await workspace()
  const runner = createJobRunner(root)
  context.after(async () => { await runner.shutdown(); await removeWorkspace(root) })
  const phase = (status: string) => ({ status })
  const manifestFile = path.join(root, "projects", "linh-nam", "analysis", "job-manifest.json")
  await writeFile(manifestFile, JSON.stringify({
    schemaVersion: 1,
    projectId: "linh-nam",
    status: "running",
    startedAt: "2026-07-24T10:00:00.000Z",
    updatedAt: "2026-07-24T10:01:00.000Z",
    currentPhase: "render",
    phases: {
      validate: phase("completed"), analyze: phase("completed"), plan: phase("completed"),
      build: phase("completed"), render: phase("running"), qa: phase("pending"), deliver: phase("pending"),
    },
    artifacts: {},
  }))

  // No ActiveJob was ever created for this run in this process — exactly what
  // a fresh server sees after a crash or a forced kill left the old process's
  // job with no chance to run shutdown(). A plain read must not keep repeating
  // "running" forever; it should surface a clear failure instead.
  const snapshot = await runner.get("linh-nam")
  assert.equal(snapshot.status, "failed")
  assert.match(snapshot.error ?? "", /interrupted/i)
  assert.equal(snapshot.phases.render, "failed")
  assert.equal(snapshot.progress, 57) // 4 of 7 phases (validate/analyze/plan/build) were genuinely done

  // The self-heal must also unblock start() — the whole point of detecting
  // this is that a retry should work, not trade one stuck state for another.
  const restarted = await runner.start("linh-nam", { mode: "render", resume: false })
  assert.equal(restarted.status, "running")
})

test("manual completion accepts only a rendered video stopped by QA and keeps a warning", async (context) => {
  const { root } = await workspace()
  const runner = createJobRunner(root)
  context.after(async () => { await runner.shutdown(); await removeWorkspace(root) })
  const projectDir = path.join(root, "projects", "linh-nam")
  const manifestFile = path.join(projectDir, "analysis", "job-manifest.json")
  const phase = (status: string) => ({ status })
  await writeFile(manifestFile, JSON.stringify({
    schemaVersion: 1,
    projectId: "linh-nam",
    status: "failed",
    startedAt: "2026-07-24T10:00:00.000Z",
    updatedAt: "2026-07-24T10:01:00.000Z",
    currentPhase: "qa",
    error: { phase: "qa", message: "Frame check failed" },
    phases: {
      validate: phase("completed"), analyze: phase("completed"), plan: phase("completed"),
      build: phase("completed"), render: phase("completed"), qa: phase("failed"), deliver: phase("pending"),
    },
    artifacts: {},
  }))

  await assert.rejects(
    runner.completeManually("linh-nam"),
    (error: unknown) => error instanceof JobRequestError && error.code === "RENDER_OUTPUT_NOT_READY",
  )

  await mkdir(path.join(projectDir, "output"), { recursive: true })
  await writeFile(path.join(projectDir, "output", "final.mp4"), "rendered video")
  const completed = await runner.completeManually("linh-nam")
  assert.equal(completed.status, "completed_with_warning")
  assert.equal(completed.phases.render, "completed")
  assert.equal(completed.phases.qa, "completed")
  assert.equal(completed.phases.deliver, "completed")
  assert.equal(completed.error, null)
  assert.deepEqual(completed.warnings, [{
    code: "PROJECT_MANUALLY_COMPLETED",
    message: "Completed manually; review the QA findings before using the delivered video.",
  }])
  assert.equal(completed.manuallyCompleted, true)

  await assert.rejects(
    runner.completeManually("linh-nam"),
    (error: unknown) => error instanceof JobRequestError && error.code === "MANUAL_COMPLETION_NOT_AVAILABLE",
  )
})

test("manual completion also accepts a rendered project whose QA passed but delivery is pending", async (context) => {
  const { root } = await workspace()
  const runner = createJobRunner(root)
  context.after(async () => { await runner.shutdown(); await removeWorkspace(root) })
  const projectDir = path.join(root, "projects", "linh-nam")
  const phase = (status: string) => ({ status })
  await writeFile(path.join(projectDir, "analysis", "job-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    projectId: "linh-nam",
    status: "completed",
    startedAt: "2026-07-24T10:00:00.000Z",
    updatedAt: "2026-07-24T10:01:00.000Z",
    phases: {
      validate: phase("completed"), analyze: phase("completed"), plan: phase("completed"),
      build: phase("completed"), render: phase("completed"), qa: phase("completed"), deliver: phase("pending"),
    },
    artifacts: {},
  }))
  await mkdir(path.join(projectDir, "output"), { recursive: true })
  await writeFile(path.join(projectDir, "output", "final.mp4"), "rendered video")

  const completed = await runner.completeManually("linh-nam")
  assert.equal(completed.status, "completed_with_warning")
  assert.equal(completed.phases.qa, "completed")
  assert.equal(completed.phases.deliver, "completed")
  assert.deepEqual(completed.warnings, [{
    code: "PROJECT_MANUALLY_COMPLETED",
    message: "Completed manually; review the QA findings before using the delivered video.",
  }])
  assert.equal(completed.manuallyCompleted, true)
})
