import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createDeliveryService, DeliveryRequestError } from "./delivery.js"

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-delivery-")), project = path.join(root, "projects", "sample")
  await mkdir(path.join(project, "analysis", "qa"), { recursive: true }); await mkdir(path.join(project, "timeline"), { recursive: true }); await mkdir(path.join(project, "output", "deliver"), { recursive: true })
  await writeFile(path.join(project, "project.json"), JSON.stringify({ id: "sample", analysisDir: "analysis", timeline: "timeline/final.json", output: "output/final.mp4" }))
  await writeFile(path.join(project, "timeline", "final.json"), "{}")
  await writeFile(path.join(project, "output", "deliver", "preview.mp4"), "preview")
  await writeFile(path.join(project, "output", "deliver", "final.mp4"), "master")
  await writeFile(path.join(project, "output", "deliver", "thumbnail.jpg"), "thumb")
  await writeFile(path.join(project, "output", "deliver", "project_summary.json"), JSON.stringify({ tier: "lite", provenance: { photoContent: "stub" }, qa: { verdict: "unknown" }, thumbnail: { chosenBy: "midpoint" } }))
  const future = new Date(Date.now() + 2_000)
  for (const name of ["preview.mp4", "final.mp4", "thumbnail.jpg", "project_summary.json"]) await utimes(path.join(project, "output", "deliver", name), future, future)
  return { root, project, service: createDeliveryService(root) }
}

test("delivery approval binds to the current preview and permits an explicit release", async (context) => {
  const { root, service } = await fixture(); context.after(() => rm(root, { recursive: true, force: true }))
  const approved = await service.approve("sample")
  assert.equal(approved.approval.status, "approved")
  const released = await service.release("sample")
  assert.ok(released.release?.releasedAt); assert.equal(released.summary && (released.summary as { tier: string }).tier, "lite")
})

test("a changed timeline invalidates approval and the prior release", async (context) => {
  const { root, project, service } = await fixture(); context.after(() => rm(root, { recursive: true, force: true }))
  await service.approve("sample"); await service.release("sample")
  const later = new Date(Date.now() + 5_000); await utimes(path.join(project, "timeline", "final.json"), later, later)
  const stale = await service.get("sample")
  assert.equal(stale.approval.status, "invalidated"); assert.equal(stale.release, null)
  await assert.rejects(() => service.release("sample"), (error: unknown) => error instanceof DeliveryRequestError && error.code === "PREVIEW_APPROVAL_REQUIRED")
})

test("release is refused before an operator approves the preview", async (context) => {
  const { root, service } = await fixture(); context.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(() => service.release("sample"), (error: unknown) => error instanceof DeliveryRequestError && error.code === "PREVIEW_APPROVAL_REQUIRED")
})

// After the JobRunner UI stopped offering a "deliver" run mode, nothing was left
// in the app that could refresh a stale package — approve() must repackage itself.
async function staleWorkspace(deliverScript: string) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-delivery-stale-")), project = path.join(root, "projects", "sample")
  await mkdir(path.join(project, "analysis"), { recursive: true }); await mkdir(path.join(project, "timeline"), { recursive: true })
  await mkdir(path.join(project, "output", "deliver"), { recursive: true }); await mkdir(path.join(root, "scripts"), { recursive: true })
  await writeFile(path.join(project, "project.json"), JSON.stringify({ id: "sample", analysisDir: "analysis", timeline: "timeline/final.json", output: "output/final.mp4" }))
  await writeFile(path.join(project, "timeline", "final.json"), "{}")
  // The old package predates the timeline — exactly what a re-render after a
  // recipe edit leaves behind — so artifacts.ts reports the preview as stale.
  const old = new Date(Date.now() - 60_000)
  for (const name of ["preview.mp4", "final.mp4", "thumbnail.jpg"]) { await writeFile(path.join(project, "output", "deliver", name), "old"); await utimes(path.join(project, "output", "deliver", name), old, old) }
  await writeFile(path.join(project, "output", "deliver", "project_summary.json"), JSON.stringify({ tier: "old" }))
  await utimes(path.join(project, "output", "deliver", "project_summary.json"), old, old)
  await writeFile(path.join(root, "scripts", "deliver.mjs"), deliverScript, "utf8")
  return { root, project, service: createDeliveryService(root) }
}

const fakeDeliverSuccess = `
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[process.argv.indexOf("--out-dir") + 1];
const tier = process.argv[process.argv.indexOf("--tier") + 1];
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "preview.mp4"), "regenerated-preview");
fs.writeFileSync(path.join(outDir, "final.mp4"), "regenerated-master");
fs.writeFileSync(path.join(outDir, "thumbnail.jpg"), "regenerated-thumb");
fs.writeFileSync(path.join(outDir, "project_summary.json"), JSON.stringify({ tier, provenance: { photoContent: "stub" }, qa: { verdict: "unknown" }, thumbnail: { chosenBy: "midpoint" } }));
`

test("approving a stale package repackages it first, instead of refusing", async (context) => {
  const { root, service } = await staleWorkspace(fakeDeliverSuccess); context.after(() => rm(root, { recursive: true, force: true }))
  const approved = await service.approve("sample")
  assert.equal(approved.approval.status, "approved")
  const summary = approved.summary as { tier: string }
  assert.equal(summary.tier, "unknown") // project.json carries no tier here — resolvedTier() must not crash, just fall back
})

test("approve reports the real reason when repackaging fails, instead of a generic PREVIEW_NOT_READY", async (context) => {
  const { root, service } = await staleWorkspace(`console.error("boom: rendered video not found"); process.exit(1);`)
  context.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(
    () => service.approve("sample"),
    (error: unknown) => error instanceof DeliveryRequestError && error.code === "DELIVERY_REGENERATE_FAILED" && /boom: rendered video not found/.test(error.message),
  )
})
