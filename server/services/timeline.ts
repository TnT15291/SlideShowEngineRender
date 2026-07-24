import { randomUUID } from "node:crypto"
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js"
import { z } from "zod"

import { listProjectAssets } from "./assets.js"
import { acquireProjectOperation, ProjectOperationBusyError } from "./projectOperations.js"

const projectSchema = z.object({
  id: z.string(), analysisDir: z.string().min(1), timeline: z.string().min(1), output: z.string().min(1),
}).passthrough()
const imageLayerSchema = z.object({ type: z.literal("image"), path: z.string().min(1) }).passthrough()
const slideSchema = z.object({
  id: z.string().min(1), duration: z.number().positive(), effect: z.string().min(1), renderer: z.string().optional(), template: z.string().optional(),
  transition: z.object({ type: z.string(), duration: z.number().nonnegative() }), captions: z.array(z.object({ text: z.string() }).passthrough()),
  image: z.string().optional(), images: z.array(z.string()).optional(), assets: z.array(z.string()).optional(), layers: z.array(z.record(z.unknown())).optional(),
}).passthrough()
const timelineSchema = z.object({
  project: z.object({ name: z.string(), width: z.number(), height: z.number(), fps: z.number() }).passthrough(),
  output: z.object({ path: z.string() }).passthrough(), slides: z.array(slideSchema).min(1),
}).passthrough()

export const replaceTimelineImageSchema = z.object({
  sceneId: z.string().min(1).max(200),
  slotId: z.string().regex(/^(image|images-\d+|layer-\d+|asset-\d+)$/),
  assetId: z.string().uuid(),
})

export type ReplaceTimelineImageInput = z.infer<typeof replaceTimelineImageSchema>
export type TimelineImageSlot = { id: string; label: string; path: string; url: string | null }
export type TimelineScene = {
  id: string; index: number; start: number; end: number; duration: number; effect: string; renderer: string; layout: string | null
  transition: { type: string; duration: number }; captions: string[]; images: TimelineImageSlot[]
}
export type TimelineSnapshot = {
  projectId: string; ready: boolean; path: string; project: { name: string; width: number; height: number; fps: number } | null
  totalDuration: number; scenes: TimelineScene[]; renderUrl: string | null; updatedAt: string | null
}
export type TimelineImageFile = { absolutePath: string; filename: string; mimeType: string; size: number }

export class TimelineRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message) }
}

const imageMime = new Map([
  [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".png", "image/png"], [".webp", "image/webp"],
  [".heic", "image/heic"], [".heif", "image/heif"],
])

function isInside(parent: string, target: string) {
  const relative = path.relative(parent, target)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function writeJsonAtomic(file: string, value: unknown) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
    await rename(temporary, file)
  } finally { await rm(temporary, { force: true }) }
}

function slotsOf(slide: z.infer<typeof slideSchema>): TimelineImageSlot[] {
  const slots: TimelineImageSlot[] = []
  if (slide.image) slots.push({ id: "image", label: "Hero image", path: slide.image, url: null })
  slide.images?.forEach((value, index) => slots.push({ id: `images-${index}`, label: `Image ${index + 1}`, path: value, url: null }))
  slide.layers?.forEach((value, index) => {
    const layer = imageLayerSchema.safeParse(value)
    if (layer.success) slots.push({ id: `layer-${index}`, label: `Layer ${index + 1}`, path: layer.data.path, url: null })
  })
  slide.assets?.forEach((value, index) => {
    if (imageMime.has(path.extname(value).toLowerCase())) slots.push({ id: `asset-${index}`, label: `Asset ${index + 1}`, path: value, url: null })
  })
  return slots
}

function replaceSlot(slide: z.infer<typeof slideSchema>, slotId: string, value: string) {
  if (slotId === "image" && slide.image) { slide.image = value; return }
  const match = /^(images|layer|asset)-(\d+)$/.exec(slotId)
  if (!match) throw new TimelineRequestError(404, "TIMELINE_SLOT_NOT_FOUND", `Image slot not found: ${slotId}`)
  const index = Number(match[2])
  if (match[1] === "images" && slide.images?.[index]) { slide.images[index] = value; return }
  if (match[1] === "asset" && slide.assets?.[index]) { slide.assets[index] = value; return }
  if (match[1] === "layer" && slide.layers?.[index]) {
    const layer = imageLayerSchema.safeParse(slide.layers[index])
    if (layer.success) { slide.layers[index] = { ...slide.layers[index], path: value }; return }
  }
  throw new TimelineRequestError(404, "TIMELINE_SLOT_NOT_FOUND", `Image slot not found: ${slotId}`)
}

export function createTimelineService(engineRoot = process.cwd()) {
  const projectsRoot = path.resolve(engineRoot, "projects")
  let validateDocument: ValidateFunction | null = null

  async function validator() {
    if (validateDocument) return validateDocument
    const schema = JSON.parse(await readFile(path.join(engineRoot, "schema", "timeline.schema.json"), "utf8"))
    const compiled = new Ajv2020({ strict: false, allErrors: true }).compile(schema)
    validateDocument = compiled
    return compiled
  }

  async function loadProject(projectId: string) {
    const projectDir = path.resolve(projectsRoot, projectId)
    if (path.dirname(projectDir) !== projectsRoot) throw new TimelineRequestError(400, "INVALID_PROJECT_ID", "Project id resolves outside the projects directory")
    try {
      const manifest = projectSchema.parse(JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")))
      if (manifest.id !== projectId) throw new TimelineRequestError(409, "PROJECT_ID_MISMATCH", "Project directory and manifest ids do not match")
      const timelineFile = path.resolve(projectDir, manifest.timeline)
      const jobFile = path.resolve(projectDir, manifest.analysisDir, "job-manifest.json")
      const outputFile = path.resolve(projectDir, manifest.output)
      if (!isInside(projectDir, timelineFile) || !isInside(projectDir, jobFile) || !isInside(projectDir, outputFile)) throw new TimelineRequestError(500, "INVALID_PROJECT_MANIFEST", "A project artifact path escapes the project directory")
      return { projectDir, manifest, timelineFile, jobFile, outputFile }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TimelineRequestError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`)
      if (error instanceof TimelineRequestError) throw error
      throw new TimelineRequestError(500, "INVALID_PROJECT_MANIFEST", "Project manifest is invalid")
    }
  }

  async function readTimeline(projectId: string) {
    const project = await loadProject(projectId)
    let raw: unknown
    try { raw = JSON.parse(await readFile(project.timelineFile, "utf8")) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { project, document: null, metadata: null }
      throw new TimelineRequestError(500, "INVALID_TIMELINE", "Timeline JSON cannot be read")
    }
    const validate = await validator()
    if (!validate(raw)) throw new TimelineRequestError(409, "INVALID_TIMELINE", "Timeline failed schema validation", validate.errors)
    const document = timelineSchema.parse(raw)
    const ids = new Set<string>()
    for (const slide of document.slides) {
      if (ids.has(slide.id)) throw new TimelineRequestError(409, "INVALID_TIMELINE", `Duplicate scene id: ${slide.id}`)
      if (slide.transition.duration >= slide.duration) throw new TimelineRequestError(409, "INVALID_TIMELINE", `Transition must be shorter than scene ${slide.id}`)
      ids.add(slide.id)
    }
    return { project, document, metadata: await stat(project.timelineFile) }
  }

  function safeImageUrl(projectId: string, projectDir: string, sceneIndex: number, slot: TimelineImageSlot) {
    const absolute = path.resolve(engineRoot, slot.path)
    return isInside(projectDir, absolute) && imageMime.has(path.extname(absolute).toLowerCase())
      ? `/projects/${projectId}/timeline/images/${sceneIndex}/${slot.id}` : null
  }

  async function get(projectId: string): Promise<TimelineSnapshot> {
    const { project, document, metadata } = await readTimeline(projectId)
    if (!document || !metadata) return { projectId, ready: false, path: project.manifest.timeline, project: null, totalDuration: 0, scenes: [], renderUrl: null, updatedAt: null }
    let cursor = 0
    const scenes = document.slides.map((slide, index) => {
      const start = cursor
      const end = start + slide.duration
      cursor = end - (index < document.slides.length - 1 ? slide.transition.duration : 0)
      const images = slotsOf(slide).map((slot) => ({ ...slot, url: safeImageUrl(projectId, project.projectDir, index, slot) }))
      return {
        id: slide.id, index, start, end, duration: slide.duration, effect: slide.effect, renderer: slide.renderer || "ffmpeg",
        layout: slide.template || null, transition: slide.transition, captions: slide.captions.map((caption) => caption.text), images,
      }
    })
    let renderUrl: string | null = null
    try { if ((await stat(project.outputFile)).mtimeMs >= metadata.mtimeMs) renderUrl = `/projects/${projectId}/artifacts/render` } catch { /* render is optional */ }
    return {
      projectId, ready: true, path: project.manifest.timeline, project: document.project,
      totalDuration: scenes.at(-1)?.end || 0, scenes, renderUrl, updatedAt: metadata.mtime.toISOString(),
    }
  }

  async function image(projectId: string, sceneIndex: number, slotId: string): Promise<TimelineImageFile> {
    const { project, document } = await readTimeline(projectId)
    if (!document) throw new TimelineRequestError(404, "TIMELINE_NOT_READY", "Timeline has not been generated")
    const slide = document.slides[sceneIndex]
    const slot = slide && slotsOf(slide).find((candidate) => candidate.id === slotId)
    if (!slot) throw new TimelineRequestError(404, "TIMELINE_SLOT_NOT_FOUND", "Timeline image slot not found")
    const absolutePath = path.resolve(engineRoot, slot.path)
    const mimeType = imageMime.get(path.extname(absolutePath).toLowerCase())
    if (!isInside(project.projectDir, absolutePath) || !mimeType) throw new TimelineRequestError(404, "TIMELINE_IMAGE_UNAVAILABLE", "Timeline image is outside the project or unsupported")
    try {
      const metadata = await stat(absolutePath)
      if (!metadata.isFile()) throw new Error("not a file")
      return { absolutePath, filename: path.basename(absolutePath), mimeType, size: metadata.size }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new TimelineRequestError(404, "TIMELINE_IMAGE_UNAVAILABLE", "Timeline image is missing")
      throw error
    }
  }

  async function replaceImage(projectId: string, rawInput: ReplaceTimelineImageInput) {
    const input = replaceTimelineImageSchema.parse(rawInput)
    let release: () => void
    try { release = acquireProjectOperation(engineRoot, projectId, "timeline") } catch (error) {
      if (error instanceof ProjectOperationBusyError) throw new TimelineRequestError(409, "PROJECT_BUSY", error.message)
      throw error
    }
    try {
      const { project, document } = await readTimeline(projectId)
      if (!document) throw new TimelineRequestError(409, "TIMELINE_NOT_READY", "Generate the timeline before replacing an image")
      const assets = await listProjectAssets(projectId, engineRoot)
      const asset = assets.photos.find((candidate) => candidate.id === input.assetId)
      if (!asset) throw new TimelineRequestError(404, "PHOTO_ASSET_NOT_FOUND", "Replacement photo is not part of this project")
      if (path.basename(asset.storedName) !== asset.storedName) throw new TimelineRequestError(500, "INVALID_UPLOAD_MANIFEST", "Replacement photo path is invalid")
      const slide = document.slides.find((candidate) => candidate.id === input.sceneId)
      if (!slide) throw new TimelineRequestError(404, "TIMELINE_SCENE_NOT_FOUND", `Scene not found: ${input.sceneId}`)
      if (!slotsOf(slide).some((slot) => slot.id === input.slotId)) throw new TimelineRequestError(404, "TIMELINE_SLOT_NOT_FOUND", `Image slot not found: ${input.slotId}`)
      const replacement = path.posix.join("projects", projectId, "input", asset.storedName)
      replaceSlot(slide, input.slotId, replacement)
      const validate = await validator()
      if (!validate(document)) throw new TimelineRequestError(409, "INVALID_TIMELINE_UPDATE", "Replacement would make the timeline invalid", validate.errors)

      const now = new Date().toISOString()
      let job: Record<string, unknown> | null = null
      try {
        job = JSON.parse(await readFile(project.jobFile, "utf8")) as Record<string, unknown>
        if (!job.phases || typeof job.phases !== "object") throw new Error("missing phases")
        const phases = job.phases as Record<string, Record<string, unknown>>
        for (const phase of ["render", "qa", "deliver"]) phases[phase] = { status: "pending", reason: `Timeline image changed at ${now}` }
        job.status = "paused"; job.currentPhase = "render"; job.updatedAt = now; delete job.error
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new TimelineRequestError(500, "INVALID_JOB_MANIFEST", "Job manifest is invalid; timeline was not changed")
      }

      const approvalFile = path.join(project.projectDir, project.manifest.analysisDir, "previews", "selection.json")
      let approval: Record<string, unknown> | null = null
      try {
        approval = JSON.parse(await readFile(approvalFile, "utf8")) as Record<string, unknown>
        approval.status = "invalidated"; approval.invalidatedAt = now; approval.invalidationReason = "timeline_image_changed"
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new TimelineRequestError(500, "INVALID_PREVIEW_APPROVAL", "Preview approval is invalid; timeline was not changed")
      }

      await writeJsonAtomic(project.timelineFile, document)
      if (job) await writeJsonAtomic(project.jobFile, job)
      if (approval) await writeJsonAtomic(approvalFile, approval)
      return get(projectId)
    } finally { release() }
  }

  return { get, image, replaceImage }
}

export const timelineService = createTimelineService()
