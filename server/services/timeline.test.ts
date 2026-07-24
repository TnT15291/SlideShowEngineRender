import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { acquireProjectOperation } from "./projectOperations.js"
import { createTimelineService, TimelineRequestError } from "./timeline.js"

const photoId = "11111111-1111-4111-8111-111111111111"

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-timeline-"))
  const projectDir = path.join(root, "projects", "linh-nam")
  await mkdir(path.join(projectDir, "analysis"), { recursive: true })
  await mkdir(path.join(projectDir, "timeline"), { recursive: true })
  await mkdir(path.join(projectDir, "input"), { recursive: true })
  await mkdir(path.join(root, "schema"), { recursive: true })
  await writeFile(path.join(root, "schema", "timeline.schema.json"), await readFile(path.resolve("schema/timeline.schema.json")))
  await writeFile(path.join(projectDir, "project.json"), JSON.stringify({
    id: "linh-nam", analysisDir: "analysis", timeline: "timeline/timeline.json", output: "output/final.mp4",
  }))
  await writeFile(path.join(projectDir, "input", "old.jpg"), "old")
  await writeFile(path.join(projectDir, "input", "new.jpg"), "new")
  await writeFile(path.join(projectDir, "analysis", "uploads.json"), JSON.stringify({ version: 1, assets: [{
    id: photoId, kind: "photo", originalName: "New.jpg", storedName: "new.jpg", uploadIndex: 0,
    mimeType: "image/jpeg", size: 3, uploadedAt: "2026-07-22T00:00:00.000Z",
  }] }))
  await writeFile(path.join(projectDir, "analysis", "job-manifest.json"), JSON.stringify({
    status: "completed", updatedAt: "2026-07-22T00:00:00.000Z", phases: {
      validate: { status: "completed" }, analyze: { status: "completed" }, plan: { status: "completed" }, build: { status: "completed" },
      render: { status: "completed" }, qa: { status: "completed" }, deliver: { status: "completed" },
    },
  }))
  const timeline = {
    project: { name: "Linh & Nam", width: 1920, height: 1080, fps: 30, quality: "share" },
    output: { path: "projects/linh-nam/output/final.mp4" }, music: [], audio: { fade_in: 0, fade_out: 0, crossfade: 0 }, overlays: [],
    slides: [
      { id: "scene_001", duration: 5, effect: "layer_scene", transition: { type: "crossfade", duration: 1 }, captions: [], layers: [{
        type: "image", path: "projects/linh-nam/input/old.jpg", x: 0, y: 0, width: 1920, height: 1080,
        focusX: 0.5, focusY: 0.4, faceBox: { x: 0.3, y: 0.1, width: 0.4, height: 0.5 },
        technicalColor: { file: "projects/linh-nam/input/old.jpg", brightness: 0, saturation: 1, redBalance: 0, blueBalance: 0, confidence: 0.9, reason: "album correction" },
      }] },
      { id: "scene_002", image: "projects/linh-nam/input/old.jpg", duration: 5, effect: "still", transition: { type: "none", duration: 0 }, captions: [] },
    ],
  }
  await writeFile(path.join(projectDir, "timeline", "timeline.json"), JSON.stringify(timeline))
  return { root, projectDir }
}

test("timeline service reads scene flow and replaces only an uploaded photo slot", async (context) => {
  const { root, projectDir } = await fixture()
  context.after(() => rm(root, { recursive: true, force: true }))
  const service = createTimelineService(root)
  const before = await service.get("linh-nam")
  assert.equal(before.ready, true)
  assert.equal(before.totalDuration, 9)
  assert.equal(before.scenes[0].images[0].url, "/projects/linh-nam/timeline/images/0/layer-0")
  assert.equal((await service.image("linh-nam", 0, "layer-0")).size, 3)

  const after = await service.replaceImage("linh-nam", { sceneId: "scene_001", slotId: "layer-0", assetId: photoId })
  assert.equal(after.scenes[0].images[0].path, "projects/linh-nam/input/new.jpg")
  const written = JSON.parse(await readFile(path.join(projectDir, "timeline", "timeline.json"), "utf8"))
  assert.equal(written.slides[0].layers[0].path, "projects/linh-nam/input/new.jpg")
  const job = JSON.parse(await readFile(path.join(projectDir, "analysis", "job-manifest.json"), "utf8"))
  assert.equal(job.status, "paused")
  assert.equal(job.currentPhase, "render")
  assert.equal(job.phases.render.status, "pending")
  assert.equal(job.phases.qa.status, "pending")
  assert.equal(job.phases.deliver.status, "pending")
})

test("timeline replacement rejects unknown assets, slots, and concurrent jobs", async (context) => {
  const { root } = await fixture()
  context.after(() => rm(root, { recursive: true, force: true }))
  const service = createTimelineService(root)
  await assert.rejects(service.replaceImage("linh-nam", { sceneId: "scene_001", slotId: "image", assetId: "22222222-2222-4222-8222-222222222222" }), (error: unknown) => error instanceof TimelineRequestError && error.code === "PHOTO_ASSET_NOT_FOUND")
  await assert.rejects(service.replaceImage("linh-nam", { sceneId: "scene_001", slotId: "layer-9", assetId: photoId }), (error: unknown) => error instanceof TimelineRequestError && error.code === "TIMELINE_SLOT_NOT_FOUND")
  const release = acquireProjectOperation(root, "linh-nam", "job")
  try {
    await assert.rejects(service.replaceImage("linh-nam", { sceneId: "scene_001", slotId: "image", assetId: photoId }), (error: unknown) => error instanceof TimelineRequestError && error.code === "PROJECT_BUSY")
  } finally { release() }
})

test("timeline image endpoint refuses paths outside the project", async (context) => {
  const { root, projectDir } = await fixture()
  context.after(() => rm(root, { recursive: true, force: true }))
  const timelineFile = path.join(projectDir, "timeline", "timeline.json")
  const timeline = JSON.parse(await readFile(timelineFile, "utf8"))
  timeline.slides[0].image = "outside.jpg"
  await writeFile(path.join(root, "outside.jpg"), "outside")
  await writeFile(timelineFile, JSON.stringify(timeline))
  const service = createTimelineService(root)
  assert.equal((await service.get("linh-nam")).scenes[0].images[0].url, null)
  await assert.rejects(service.image("linh-nam", 0, "image"), (error: unknown) => error instanceof TimelineRequestError && error.code === "TIMELINE_IMAGE_UNAVAILABLE")
})
