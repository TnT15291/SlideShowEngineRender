import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { AnalysisRequestError, createAnalysisService } from "./analysis.js"

async function workspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-analysis-"))
  const projectDir = path.join(root, "projects", "linh-nam")
  await mkdir(path.join(projectDir, "analysis", "music"), { recursive: true })
  await mkdir(path.join(projectDir, "input"), { recursive: true })
  await mkdir(path.join(root, "scripts"), { recursive: true })
  await writeFile(path.join(projectDir, "project.json"), JSON.stringify({
    version: 1, id: "linh-nam", tier: "lite", inputDir: "input", music: [], analysisDir: "analysis",
    selectedPhotos: "analysis/photos.selected.json", selectionPolicy: "analysis/selection_policy.json",
  }))
  await writeFile(path.join(root, "scripts", "analyzeProject.mjs"), `
import fs from "node:fs";
import path from "node:path";
const projectArg = process.argv[process.argv.indexOf("--project") + 1];
const analysis = path.join(projectArg, "analysis");
setTimeout(() => fs.writeFileSync(path.join(analysis, "photos.json"), JSON.stringify({ dir: "input", count: 2, photos: [{ file: "input/a.jpg", w: 1600, h: 1200, qualityNorm: 1 }, { file: "input/b.jpg", w: 1200, h: 1600, qualityNorm: 0 }] })), 120);
`, "utf8")
  return { root, projectDir }
}

async function waitFor(check: () => Promise<boolean>, timeout = 5000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error("Timed out waiting for analysis")
}

test("analysis service locks runs, reports technical output, and estimates vision before execution", async (context) => {
  const originalVisionBaseUrl = process.env.VISION_BASE_URL
  process.env.VISION_BASE_URL = "https://api.deepseek.com/v1"
  context.after(() => { if (originalVisionBaseUrl === undefined) delete process.env.VISION_BASE_URL; else process.env.VISION_BASE_URL = originalVisionBaseUrl })
  const { root } = await workspace()
  const service = createAnalysisService(root)
  context.after(async () => { await service.shutdown(); await rm(root, { recursive: true, force: true }) })
  const started = await service.start("linh-nam", { kind: "technical" })
  assert.equal(started.run?.status, "running")
  await assert.rejects(service.start("linh-nam", { kind: "technical" }), (error: unknown) => error instanceof AnalysisRequestError && error.code === "ANALYSIS_ALREADY_RUNNING")
  await waitFor(async () => (await service.get("linh-nam")).run?.status === "completed")
  const result = await service.get("linh-nam")
  assert.equal(result.photos.technical, 2)
  assert.equal(result.vision.photoCount, 2)
  assert.equal(result.vision.requests, 1)
  assert.ok((result.vision.imageInputTokens || 0) > 0)
  assert.equal(result.vision.configured, false)
  await assert.rejects(service.start("linh-nam", { kind: "vision" }), (error: unknown) => error instanceof AnalysisRequestError && error.code === "VISION_NOT_CONFIGURED")
})

test("analysis service surfaces probe errors and applies cull only to selected photos", async (context) => {
  const { root, projectDir } = await workspace()
  const service = createAnalysisService(root)
  context.after(async () => { await service.shutdown(); await rm(root, { recursive: true, force: true }) })
  await writeFile(path.join(root, "scripts", "analyzeProject.mjs"), `console.error("[analyzePhotos] FAILED: ffprobe exit 1: corrupt image"); process.exit(1);`, "utf8")
  await service.start("linh-nam", { kind: "technical" })
  await waitFor(async () => (await service.get("linh-nam")).run?.status === "failed")
  const failed = await service.get("linh-nam")
  assert.match(failed.run?.error || "", /ffprobe/i)
  assert.equal(failed.run?.probeErrors.length, 1)

  const photos = { dir: "input", count: 3, photos: [
    { file: "input/a.jpg", qualityNorm: 1 }, { file: "input/b.jpg", qualityNorm: 0.5 }, { file: "input/c.jpg", qualityNorm: 0 },
  ] }
  const photosRaw = JSON.stringify(photos)
  await writeFile(path.join(projectDir, "analysis", "photos.json"), photosRaw)
  await writeFile(path.join(projectDir, "analysis", "cull_suggestion.json"), JSON.stringify({
    generatedBy: "cull-advisor", generatedAt: new Date().toISOString(), sourceHash: createHash("sha256").update(photosRaw).digest("hex"),
    keep: 2, sourceCount: 3, drop: [{ file: "input/c.jpg", reason: "low quality" }], locked: [],
  }))
  const applied = await service.applyCull("linh-nam")
  assert.equal(applied.appliedCull?.keep, 2)
  const selected = JSON.parse(await readFile(path.join(projectDir, "analysis", "photos.selected.json"), "utf8"))
  assert.deepEqual(selected.photos.map((photo: { file: string }) => photo.file), ["input/a.jpg", "input/b.jpg"])
  assert.equal(selected.policy, "cull_approved")
  assert.equal(await readFile(path.join(projectDir, "analysis", "photos.json"), "utf8"), photosRaw)
})
