import { open, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { z } from "zod"

export const PHOTO_MAX_BYTES = 50 * 1024 * 1024
export const MUSIC_MAX_BYTES = 200 * 1024 * 1024

const assetKindSchema = z.enum(["photo", "music"])
const assetSchema = z.object({
  id: z.string().uuid(),
  kind: assetKindSchema,
  originalName: z.string().min(1),
  storedName: z.string().min(1),
  uploadIndex: z.number().int().nonnegative(),
  mimeType: z.string().min(1),
  size: z.number().int().positive(),
  uploadedAt: z.string().datetime(),
})
const uploadManifestSchema = z.object({ version: z.literal(1), assets: z.array(assetSchema) })

export type AssetKind = z.infer<typeof assetKindSchema>
export type ProjectAsset = z.infer<typeof assetSchema>
export type ProjectAssets = {
  photos: ProjectAsset[]
  music: ProjectAsset[]
  limits: { photoMaxBytes: number; musicMaxBytes: number }
}
export type ProjectAssetFile = ProjectAsset & { absolutePath: string }
export type UploadAssetInput = {
  projectId: string
  kind: AssetKind
  filename: string
  uploadIndex: number
  mimeType: string
  contentLength?: number
  body: AsyncIterable<Uint8Array>
}

const allowedFiles = {
  photo: {
    extensions: new Set([".jpg", ".jpeg", ".png", ".webp", ".heic", ".heif"]),
    mimeTypes: new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]),
    maxBytes: PHOTO_MAX_BYTES,
    directory: "input",
  },
  music: {
    extensions: new Set([".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg"]),
    mimeTypes: new Set(["audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/aac", "audio/flac", "audio/x-flac", "audio/ogg"]),
    maxBytes: MUSIC_MAX_BYTES,
    directory: "music",
  },
} as const

export class AssetRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const projectLocks = new Map<string, Promise<void>>()

async function withProjectLock<T>(projectId: string, action: () => Promise<T>) {
  const previous = projectLocks.get(projectId) || Promise.resolve()
  let release: () => void = () => undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const current = previous.then(() => gate)
  projectLocks.set(projectId, current)
  await previous
  try {
    return await action()
  } finally {
    release()
    if (projectLocks.get(projectId) === current) projectLocks.delete(projectId)
  }
}

function projectPaths(projectId: string, engineRoot: string) {
  const projectsDir = path.resolve(engineRoot, "projects")
  const projectDir = path.resolve(projectsDir, projectId)
  if (path.dirname(projectDir) !== projectsDir) throw new AssetRequestError(400, "INVALID_PROJECT_ID", "Project id resolves outside the projects directory")
  return {
    projectDir,
    projectManifest: path.join(projectDir, "project.json"),
    uploadManifest: path.join(projectDir, "analysis", "uploads.json"),
  }
}

async function ensureProject(projectManifest: string) {
  try {
    await stat(projectManifest)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AssetRequestError(404, "PROJECT_NOT_FOUND", "Project not found")
    throw error
  }
}

async function readUploads(uploadManifest: string) {
  try {
    return uploadManifestSchema.parse(JSON.parse(await readFile(uploadManifest, "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 as const, assets: [] }
    throw new AssetRequestError(500, "INVALID_UPLOAD_MANIFEST", "Project upload metadata is invalid")
  }
}

async function writeJsonAtomic(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
}

function cleanFilename(filename: string) {
  if (!filename || filename.length > 255 || path.basename(filename) !== filename || /[\\/\0\r\n]/.test(filename)) {
    throw new AssetRequestError(400, "INVALID_FILENAME", "Filename must be a plain file name")
  }
  const extension = path.extname(filename).toLowerCase()
  const stem = path.basename(filename, path.extname(filename)).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "asset"
  return { extension, safeName: `${stem.slice(0, 120)}${extension}` }
}

function sortAssets(assets: ProjectAsset[]) {
  return [...assets].sort((left, right) => left.uploadIndex - right.uploadIndex || left.uploadedAt.localeCompare(right.uploadedAt))
}

function responseFromAssets(assets: ProjectAsset[]): ProjectAssets {
  return {
    photos: sortAssets(assets.filter((asset) => asset.kind === "photo")),
    music: sortAssets(assets.filter((asset) => asset.kind === "music")),
    limits: { photoMaxBytes: PHOTO_MAX_BYTES, musicMaxBytes: MUSIC_MAX_BYTES },
  }
}

async function syncProjectMusic(projectManifest: string, assets: ProjectAsset[]) {
  const project = JSON.parse(await readFile(projectManifest, "utf8")) as Record<string, unknown>
  project.music = sortAssets(assets.filter((asset) => asset.kind === "music")).map((asset) => `music/${asset.storedName}`)
  await writeJsonAtomic(projectManifest, project)
}

export async function listProjectAssets(projectId: string, engineRoot = process.cwd()): Promise<ProjectAssets> {
  const paths = projectPaths(projectId, engineRoot)
  await ensureProject(paths.projectManifest)
  return responseFromAssets((await readUploads(paths.uploadManifest)).assets)
}

export async function getProjectAssetFile(projectId: string, assetId: string, engineRoot = process.cwd()): Promise<ProjectAssetFile> {
  const paths = projectPaths(projectId, engineRoot)
  await ensureProject(paths.projectManifest)
  const asset = (await readUploads(paths.uploadManifest)).assets.find((item) => item.id === assetId)
  if (!asset) throw new AssetRequestError(404, "ASSET_NOT_FOUND", "Uploaded asset not found")
  const directory = allowedFiles[asset.kind].directory
  const absolutePath = path.resolve(paths.projectDir, directory, asset.storedName)
  if (path.dirname(absolutePath) !== path.resolve(paths.projectDir, directory)) throw new AssetRequestError(500, "INVALID_UPLOAD_MANIFEST", "Uploaded asset path is invalid")
  try {
    const metadata = await stat(absolutePath)
    if (!metadata.isFile()) throw new Error("not a file")
    return { ...asset, absolutePath }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AssetRequestError(404, "ASSET_FILE_NOT_FOUND", "Uploaded asset file is missing")
    throw error
  }
}

export async function uploadProjectAsset(input: UploadAssetInput, engineRoot = process.cwd()): Promise<ProjectAsset> {
  return withProjectLock(input.projectId, async () => {
    const paths = projectPaths(input.projectId, engineRoot)
    await ensureProject(paths.projectManifest)
    const kind = assetKindSchema.safeParse(input.kind)
    if (!kind.success) throw new AssetRequestError(400, "INVALID_ASSET_KIND", "Asset kind must be photo or music")
    if (!Number.isSafeInteger(input.uploadIndex) || input.uploadIndex < 0) throw new AssetRequestError(400, "INVALID_UPLOAD_INDEX", "uploadIndex must be a non-negative integer")

    const rules = allowedFiles[kind.data]
    const { extension, safeName } = cleanFilename(input.filename)
    const mimeType = input.mimeType.split(";", 1)[0].trim().toLowerCase()
    if (!rules.extensions.has(extension as never) || !rules.mimeTypes.has(mimeType as never)) {
      throw new AssetRequestError(415, "UNSUPPORTED_ASSET_TYPE", `Unsupported ${kind.data} file type`)
    }
    if (input.contentLength !== undefined && (!Number.isSafeInteger(input.contentLength) || input.contentLength <= 0 || input.contentLength > rules.maxBytes)) {
      throw new AssetRequestError(input.contentLength > rules.maxBytes ? 413 : 400, input.contentLength > rules.maxBytes ? "ASSET_TOO_LARGE" : "EMPTY_ASSET", `File must contain 1 to ${rules.maxBytes} bytes`)
    }

    const manifest = await readUploads(paths.uploadManifest)
    if (manifest.assets.some((asset) => asset.kind === kind.data && asset.originalName.toLowerCase() === input.filename.toLowerCase())) {
      throw new AssetRequestError(409, "ASSET_EXISTS", `A ${kind.data} named ${input.filename} is already uploaded`)
    }
    if (manifest.assets.some((asset) => asset.kind === kind.data && asset.uploadIndex === input.uploadIndex)) {
      throw new AssetRequestError(409, "UPLOAD_INDEX_EXISTS", `uploadIndex ${input.uploadIndex} is already used for ${kind.data}`)
    }

    const id = randomUUID()
    const storedName = `${String(input.uploadIndex).padStart(6, "0")}-${id}-${safeName}`
    const assetDir = path.join(paths.projectDir, rules.directory)
    const target = path.join(assetDir, storedName)
    const temporary = path.join(assetDir, `.${id}.uploading`)
    const handle = await open(temporary, "wx")
    let size = 0
    try {
      for await (const chunk of input.body) {
        const buffer = Buffer.from(chunk)
        size += buffer.length
        if (size > rules.maxBytes) throw new AssetRequestError(413, "ASSET_TOO_LARGE", `File exceeds the ${rules.maxBytes}-byte limit`)
        await handle.write(buffer)
      }
    } catch (error) {
      await handle.close()
      await rm(temporary, { force: true })
      throw error
    }
    await handle.close()
    if (size === 0) {
      await rm(temporary, { force: true })
      throw new AssetRequestError(400, "EMPTY_ASSET", "Uploaded file is empty")
    }

    const asset = assetSchema.parse({ id, kind: kind.data, originalName: input.filename, storedName, uploadIndex: input.uploadIndex, mimeType, size, uploadedAt: new Date().toISOString() })
    let manifestWritten = false
    try {
      await rename(temporary, target)
      const assets = [...manifest.assets, asset]
      await writeJsonAtomic(paths.uploadManifest, { version: 1, assets })
      manifestWritten = true
      if (kind.data === "music") await syncProjectMusic(paths.projectManifest, assets)
      return asset
    } catch (error) {
      if (manifestWritten) await writeJsonAtomic(paths.uploadManifest, manifest).catch(() => undefined)
      await rm(temporary, { force: true })
      await rm(target, { force: true })
      throw error
    }
  })
}

export async function deleteProjectAsset(projectId: string, assetId: string, engineRoot = process.cwd()): Promise<ProjectAssets> {
  return withProjectLock(projectId, async () => {
    const paths = projectPaths(projectId, engineRoot)
    await ensureProject(paths.projectManifest)
    const manifest = await readUploads(paths.uploadManifest)
    const asset = manifest.assets.find((item) => item.id === assetId)
    if (!asset) throw new AssetRequestError(404, "ASSET_NOT_FOUND", "Uploaded asset not found")
    const assets = manifest.assets.filter((item) => item.id !== assetId)
    const directory = allowedFiles[asset.kind].directory
    const target = path.resolve(paths.projectDir, directory, asset.storedName)
    const expectedDir = path.resolve(paths.projectDir, directory)
    if (path.dirname(target) !== expectedDir) throw new AssetRequestError(500, "INVALID_UPLOAD_MANIFEST", "Uploaded asset path is invalid")
    try {
      await writeJsonAtomic(paths.uploadManifest, { version: 1, assets })
      if (asset.kind === "music") await syncProjectMusic(paths.projectManifest, assets)
      await unlink(target).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error
      })
    } catch (error) {
      await writeJsonAtomic(paths.uploadManifest, manifest).catch(() => undefined)
      if (asset.kind === "music") await syncProjectMusic(paths.projectManifest, manifest.assets).catch(() => undefined)
      throw error
    }
    return responseFromAssets(assets)
  })
}
