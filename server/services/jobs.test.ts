import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createJobRunner, JobRequestError } from "./jobs.js"

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-jobs-"))
  const projectDir = path.join(root, "projects", "linh-nam")
  await mkdir(path.join(projectDir, "analysis"), { recursive: true })
  await mkdir(path.join(projectDir, "input"), { recursive: true })
  await mkdir(path.join(root, "scripts"), { recursive: true })
  await writeFile(path.join(projectDir, "project.json"), JSON.stringify({
    version: 1, id: "linh-nam", name: "Linh & Nam", tier: "lite", inputDir: "input", music: [],
    analysisDir: "analysis", selectedPhotos: "analysis/photos.selected.json", story: "analysis/story.json",
    timeline: "timeline/timeline.json", output: "output/final.mp4", quality: "share",
  }))
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
if (process.argv.includes("--dry-run")) setTimeout(() => { document.status = "completed"; document.updatedAt = new Date().toISOString(); delete document.currentPhase; for (const value of Object.values(document.phases)) value.status = "completed"; fs.writeFileSync(file, JSON.stringify(document)); }, 120);
else setInterval(() => {}, 1000);
`, "utf8")
  return { root }
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
  context.after(async () => { await runner.shutdown(); await rm(root, { recursive: true, force: true }) })
  const events: string[] = []
  const unsubscribe = runner.subscribe("linh-nam", (event) => { if (event.type === "log") events.push(event.data.line) })

  const started = await runner.start("linh-nam", { mode: "render", resume: false, deliver: true })
  assert.equal(started.status, "running")
  assert.equal(started.deliver, true)
  await assert.rejects(runner.start("linh-nam", { mode: "render", resume: false }), (error: unknown) => error instanceof JobRequestError && error.code === "JOB_ALREADY_RUNNING")
  await waitFor(async () => events.includes("stub pipeline started"))
  await waitFor(async () => events.includes("deliver=true"))
  const cancelled = await runner.cancel("linh-nam")
  assert.equal(cancelled.status, "paused")
  unsubscribe()
})

test("job runner reports completed dry runs and missing projects", async (context) => {
  const { root } = await workspace()
  const runner = createJobRunner(root)
  context.after(async () => { await runner.shutdown(); await rm(root, { recursive: true, force: true }) })
  await assert.rejects(runner.get("missing"), (error: unknown) => error instanceof JobRequestError && error.code === "PROJECT_NOT_FOUND")
  await runner.start("linh-nam", { mode: "dry_run", resume: false })
  await waitFor(async () => (await runner.get("linh-nam")).status === "completed")
  assert.equal((await runner.get("linh-nam")).progress, 100)
})
