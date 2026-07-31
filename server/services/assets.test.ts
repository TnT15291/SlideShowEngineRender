import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import test from "node:test"

import { AssetRequestError, deleteProjectAsset, getProjectAssetFile, getProjectAssetThumbnail, listProjectAssets, MUSIC_MAX_BYTES, uploadProjectAsset } from "./assets.js"

async function createWorkspace() {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-assets-"))
  const projectDir = path.join(root, "projects", "linh-nam")
  await mkdir(path.join(projectDir, "analysis"), { recursive: true })
  await mkdir(path.join(projectDir, "input"), { recursive: true })
  await mkdir(path.join(projectDir, "music"), { recursive: true })
  await writeFile(path.join(projectDir, "project.json"), JSON.stringify({ id: "linh-nam", name: "Linh & Nam", music: [] }))
  return { root, projectDir }
}

function upload(root: string, overrides: Partial<Parameters<typeof uploadProjectAsset>[0]> = {}) {
  const content = Buffer.from("sample-media")
  return uploadProjectAsset({
    projectId: "linh-nam",
    kind: "photo",
    filename: "Ceremony 01.jpg",
    uploadIndex: 0,
    mimeType: "image/jpeg",
    contentLength: content.length,
    body: Readable.from([content]),
    ...overrides,
  }, root)
}

test("asset service persists upload order, syncs music, and deletes uploaded files", async (context) => {
  const { root, projectDir } = await createWorkspace()
  context.after(() => rm(root, { recursive: true, force: true }))

  const secondPhoto = await upload(root, { filename: "Reception.webp", uploadIndex: 4, mimeType: "image/webp" })
  const firstPhoto = await upload(root, { uploadIndex: 1 })
  const music = await upload(root, { kind: "music", filename: "First dance.mp3", uploadIndex: 0, mimeType: "audio/mpeg" })
  const listed = await listProjectAssets("linh-nam", root)

  assert.deepEqual(listed.photos.map((asset) => asset.id), [firstPhoto.id, secondPhoto.id])
  assert.deepEqual(listed.music.map((asset) => asset.id), [music.id])
  const musicFile = await getProjectAssetFile("linh-nam", music.id, root)
  assert.equal(musicFile.absolutePath, path.join(projectDir, "music", music.storedName))
  assert.equal((await readFile(musicFile.absolutePath, "utf8")), "sample-media")
  assert.equal((await stat(path.join(projectDir, "input", firstPhoto.storedName))).size, Buffer.byteLength("sample-media"))
  const project = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"))
  assert.deepEqual(project.music, [`music/${music.storedName}`])

  const afterDelete = await deleteProjectAsset("linh-nam", music.id, root)
  assert.equal(afterDelete.music.length, 0)
  await assert.rejects(stat(path.join(projectDir, "music", music.storedName)), { code: "ENOENT" })
  assert.deepEqual(JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")).music, [])
})

test("asset service keeps every track from a multi-file upload", async (context) => {
  const { root, projectDir } = await createWorkspace()
  context.after(() => rm(root, { recursive: true, force: true }))

  const tracks = await Promise.all([
    upload(root, { kind: "music", filename: "First.mp3", uploadIndex: 0, mimeType: "audio/mpeg" }),
    upload(root, { kind: "music", filename: "Second.mp3", uploadIndex: 1, mimeType: "audio/mpeg" }),
    upload(root, { kind: "music", filename: "Third.mp3", uploadIndex: 2, mimeType: "audio/mpeg" }),
  ])

  const listed = await listProjectAssets("linh-nam", root)
  assert.deepEqual(listed.music.map((asset) => asset.id), tracks.map((track) => track.id))
  assert.deepEqual(
    JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")).music,
    tracks.map((track) => `music/${track.storedName}`),
  )
})

test("asset service rejects duplicates, traversal, unsupported types, oversized files, and missing projects", async (context) => {
  const { root } = await createWorkspace()
  context.after(() => rm(root, { recursive: true, force: true }))
  await upload(root)

  await assert.rejects(upload(root), (error: unknown) => error instanceof AssetRequestError && error.code === "ASSET_EXISTS")
  await assert.rejects(upload(root, { filename: "../escape.jpg", uploadIndex: 2 }), (error: unknown) => error instanceof AssetRequestError && error.code === "INVALID_FILENAME")
  await assert.rejects(upload(root, { filename: "clip.exe", mimeType: "application/octet-stream", uploadIndex: 2 }), (error: unknown) => error instanceof AssetRequestError && error.code === "UNSUPPORTED_ASSET_TYPE")
  await assert.rejects(upload(root, { kind: "music", filename: "song.mp3", mimeType: "audio/mpeg", contentLength: MUSIC_MAX_BYTES + 1 }), (error: unknown) => error instanceof AssetRequestError && error.code === "ASSET_TOO_LARGE")
  await assert.rejects(listProjectAssets("missing-project", root), (error: unknown) => error instanceof AssetRequestError && error.code === "PROJECT_NOT_FOUND")
})

function ffmpegAvailable() {
  const probe = spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-version"], { windowsHide: true })
  return !probe.error && probe.status === 0
}

test("thumbnails serve a cached preview, reject non-photos, and are dropped with the asset", async (context) => {
  const { root, projectDir } = await createWorkspace()
  context.after(() => rm(root, { recursive: true, force: true }))

  const photo = await upload(root)
  const music = await upload(root, { kind: "music", filename: "Song.mp3", uploadIndex: 0, mimeType: "audio/mpeg" })

  await assert.rejects(
    getProjectAssetThumbnail("linh-nam", music.id, root),
    (error: unknown) => error instanceof AssetRequestError && error.code === "THUMBNAIL_UNSUPPORTED",
  )
  await assert.rejects(
    getProjectAssetThumbnail("linh-nam", "00000000-0000-4000-8000-000000000000", root),
    (error: unknown) => error instanceof AssetRequestError && error.code === "ASSET_NOT_FOUND",
  )

  // Seed the cache so the fresh-cache branch is exercised without shelling out
  // to ffmpeg — the upload fixtures are byte strings, not decodable images.
  const cached = path.join(projectDir, "analysis", "thumbnails", `${photo.id}.jpg`)
  await mkdir(path.dirname(cached), { recursive: true })
  await writeFile(cached, Buffer.from("cached-preview"))

  const preview = await getProjectAssetThumbnail("linh-nam", photo.id, root)
  assert.equal(preview.absolutePath, cached)
  assert.equal(preview.mimeType, "image/jpeg")
  assert.equal(preview.size, Buffer.byteLength("cached-preview"))
  assert.equal(preview.originalName, photo.originalName)

  await deleteProjectAsset("linh-nam", photo.id, root)
  assert.equal(await stat(cached).then(() => true, () => false), false)
})

test("thumbnails downscale a real photo and reuse the cache", { skip: ffmpegAvailable() ? false : "ffmpeg is not installed" }, async (context) => {
  const { root, projectDir } = await createWorkspace()
  context.after(() => rm(root, { recursive: true, force: true }))

  // A 900x600 source, so the 480px cap has something to actually shrink.
  const source = path.join(root, "source.jpg")
  spawnSync(process.env.FFMPEG_PATH || "ffmpeg", ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=900x600:duration=1", "-frames:v", "1", source], { windowsHide: true })
  const bytes = await readFile(source)
  const photo = await upload(root, { filename: "Real.jpg", uploadIndex: 7, contentLength: bytes.length, body: Readable.from([bytes]) })

  const preview = await getProjectAssetThumbnail("linh-nam", photo.id, root)
  assert.equal(preview.absolutePath, path.join(projectDir, "analysis", "thumbnails", `${photo.id}.jpg`))
  assert.ok(preview.size > 0, "preview should have content")
  assert.ok(preview.size < bytes.length, `preview (${preview.size}) should be smaller than the source (${bytes.length})`)

  const firstMtime = (await stat(preview.absolutePath)).mtimeMs
  const again = await getProjectAssetThumbnail("linh-nam", photo.id, root)
  assert.equal((await stat(again.absolutePath)).mtimeMs, firstMtime, "a warm cache must not be regenerated")
})
