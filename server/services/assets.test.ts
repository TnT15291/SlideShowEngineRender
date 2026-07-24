import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import test from "node:test"

import { AssetRequestError, deleteProjectAsset, getProjectAssetFile, listProjectAssets, MUSIC_MAX_BYTES, uploadProjectAsset } from "./assets.js"

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
