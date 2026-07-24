import assert from "node:assert/strict"
import { mkdtemp, mkdir, rm, utimes, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { ArtifactRequestError, createArtifactService } from "./artifacts.js"

async function fixture(output = "output/final.mp4") {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-artifacts-"))
  const project = path.join(root, "projects", "linh-nam")
  await mkdir(path.join(project, "timeline"), { recursive: true })
  await mkdir(path.join(project, "output", "deliver"), { recursive: true })
  await writeFile(path.join(project, "project.json"), JSON.stringify({
    id: "linh-nam", analysisDir: "analysis", timeline: "timeline/timeline.json", output,
  }))
  await writeFile(path.join(project, "timeline", "timeline.json"), "{}")
  await writeFile(path.join(project, "output", "deliver", "preview.mp4"), "preview")
  return { root }
}

test("artifact service exposes only known project outputs and reports readiness", async (context) => {
  const { root } = await fixture()
  context.after(() => rm(root, { recursive: true, force: true }))
  const service = createArtifactService(root)
  const artifacts = await service.list("linh-nam")
  assert.equal(artifacts.find((artifact) => artifact.id === "timeline")?.ready, true)
  assert.equal(artifacts.find((artifact) => artifact.id === "preview")?.size, 7)
  assert.equal(artifacts.find((artifact) => artifact.id === "delivery")?.ready, false)
  assert.equal((await service.get("linh-nam", "preview")).filename, "preview.mp4")
  await assert.rejects(service.get("linh-nam", "secrets"), (error: unknown) => error instanceof ArtifactRequestError && error.code === "ARTIFACT_NOT_FOUND")
  await assert.rejects(service.get("linh-nam", "delivery"), (error: unknown) => error instanceof ArtifactRequestError && error.code === "ARTIFACT_NOT_READY")
})

test("artifact service rejects manifest paths outside the project", async (context) => {
  const { root } = await fixture("../../outside.mp4")
  context.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(createArtifactService(root).get("linh-nam", "render"), (error: unknown) => error instanceof ArtifactRequestError && error.code === "INVALID_PROJECT_MANIFEST")
})

test("artifact service marks render outputs stale when the timeline changes", async (context) => {
  const { root } = await fixture()
  context.after(() => rm(root, { recursive: true, force: true }))
  const timeline = path.join(root, "projects", "linh-nam", "timeline", "timeline.json")
  const future = new Date(Date.now() + 5_000)
  await utimes(timeline, future, future)
  const preview = (await createArtifactService(root).list("linh-nam")).find((artifact) => artifact.id === "preview")!
  assert.equal(preview.ready, false)
  assert.equal(preview.stale, true)
})
