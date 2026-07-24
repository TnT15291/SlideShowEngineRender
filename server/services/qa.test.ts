import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createQaService } from "./qa.js"

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-qa-"))
  const project = path.join(root, "projects", "sample"), analysis = path.join(project, "analysis"), qa = path.join(analysis, "qa")
  await mkdir(path.join(project, "timeline"), { recursive: true }); await mkdir(qa, { recursive: true })
  await writeFile(path.join(project, "project.json"), JSON.stringify({ id: "sample", analysisDir: "analysis", timeline: "timeline/final.json" }))
  await writeFile(path.join(project, "timeline", "final.json"), "{}")
  return { root, analysis, qa, service: createQaService(root) }
}

test("QA service reports unknown when mechanical checks pass but bookend vision is unavailable", async (context) => {
  const { root, qa, service } = await fixture(); context.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(qa, "final.loop.json"), JSON.stringify({ status: "clean", revisions: 0, maxRevisions: 2, preflightPasses: 3, preflightFixes: 2, preflightCapped: false, journal: ["preflight: fixed"], manualReview: [] }))
  await writeFile(path.join(qa, "final.proxy.json"), JSON.stringify({ verdict: "ok", problems: [], checks: { bookend: { status: "skipped", reason: "no VISION_API_KEY" } } }))
  const result = await service.get("sample")
  assert.equal(result.verdict, "unknown"); assert.equal(result.preflightPasses, 3); assert.equal(result.preflightFixes, 2)
})

test("QA service exposes manual review after the bounded repair budget", async (context) => {
  const { root, qa, service } = await fixture(); context.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(qa, "final.loop.json"), JSON.stringify({ status: "delivered_with_flags", revisions: 2, maxRevisions: 2, journal: [], manualReview: ["scene-4[too_dark]"] }))
  await writeFile(path.join(qa, "final.proxy.json"), JSON.stringify({ verdict: "review", problems: [{ id: "scene-4", check: "frame_brightness", flags: ["too_dark"] }], checks: {} }))
  const result = await service.get("sample")
  assert.equal(result.verdict, "review"); assert.equal(result.revisions, 2); assert.deepEqual(result.manualReview, ["scene-4[too_dark]"])
})

test("QA service distinguishes an active auto-revision from completed review", async (context) => {
  const { root, analysis, qa, service } = await fixture(); context.after(() => rm(root, { recursive: true, force: true }))
  await writeFile(path.join(qa, "final.loop-state.json"), JSON.stringify({ status: "running", stage: "revising", preflightPasses: 4, preflightFixes: 3, preflightCapped: false, revisions: 1, maxRevisions: 2, updatedAt: new Date().toISOString() }))
  await writeFile(path.join(analysis, "job-manifest.json"), JSON.stringify({ status: "running", currentPhase: "qa" }))
  const result = await service.get("sample")
  assert.equal(result.status, "running"); assert.equal(result.stage, "revising"); assert.equal(result.revisions, 1)
})
