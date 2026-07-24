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
