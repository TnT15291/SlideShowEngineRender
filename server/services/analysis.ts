import { spawn, type ChildProcessByStdio } from "node:child_process"
import { createHash, randomUUID } from "node:crypto"
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"
import type { Readable } from "node:stream"

import { z } from "zod"

import { listProjectAssets } from "./assets.js"
import { acquireProjectOperation, ProjectOperationBusyError } from "./projectOperations.js"

const projectSchema = z.object({
  id: z.string(), tier: z.enum(["template", "lite", "premium"]), analysisDir: z.string(), inputDir: z.string(),
  music: z.array(z.string()), selectedPhotos: z.string().optional(), selectionPolicy: z.string().optional(),
}).passthrough()
const analysisRunSchema = z.object({
  version: z.literal(1), status: z.enum(["running", "completed", "failed"]), kind: z.enum(["technical", "vision"]),
  startedAt: z.string(), updatedAt: z.string(), error: z.string().nullable(), probeErrors: z.array(z.string()), logs: z.array(z.string()),
})
const cullSuggestionSchema = z.object({
  generatedBy: z.literal("cull-advisor"), generatedAt: z.string(), sourceHash: z.string().length(64).optional(),
  keep: z.number().int().positive(), sourceCount: z.number().int().positive(), shortfall: z.number().int().positive().optional(), note: z.string().optional(),
  drop: z.array(z.object({ file: z.string(), reason: z.string(), qualityNorm: z.number().nullable().optional(), duplicateGroup: z.string().optional() })),
  locked: z.array(z.object({ file: z.string(), reason: z.string() })),
})

export const startAnalysisInputSchema = z.object({ kind: z.enum(["technical", "vision"]) })
export const cullInputSchema = z.object({ keep: z.number().int().positive() })
export type StartAnalysisInput = z.infer<typeof startAnalysisInputSchema>
export type AnalysisRun = z.infer<typeof analysisRunSchema> | null
export type CullSuggestion = z.infer<typeof cullSuggestionSchema>
export type VisionEstimate = {
  model: string
  provider: string
  configured: boolean
  photoCount: number
  requests: number
  imageInputTokens: number | null
  estimatedUsd: { low: number; high: number } | null
  pricingNote: string
}
export type AnalysisSnapshot = {
  projectId: string
  run: AnalysisRun
  photos: { uploaded: number; technical: number; semantic: number; generatedBy: string | null }
  music: Array<{ file: string; status: "pending" | "completed" | "invalid"; duration: number | null; bpm: number | null; error: string | null }>
  vision: VisionEstimate
  cull: CullSuggestion | null
  appliedCull: { appliedAt: string; keep: number; sourceCount: number } | null
}

type ActiveAnalysis = {
  child: ChildProcessByStdio<null, Readable, Readable>
  run: z.infer<typeof analysisRunSchema>
  release: () => void
}

const OPENAI_RATES: Record<string, { input: number; output: number }> = {
  "gpt-5.5": { input: 5, output: 30 },
  "gpt-5.6": { input: 5, output: 30 },
  "gpt-5.6-sol": { input: 5, output: 30 },
  "gpt-5.6-terra": { input: 2.5, output: 15 },
  "gpt-5.6-luna": { input: 1, output: 6 },
}

export class AnalysisRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
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

function messageOf(error: unknown) { return error instanceof Error ? error.message : String(error) }
function roundCost(value: number) { return Math.round(value * 10_000) / 10_000 }

export function createAnalysisService(engineRoot = process.cwd()) {
  const active = new Map<string, ActiveAnalysis>()

  function projectPaths(projectId: string) {
    const projectsDir = path.resolve(engineRoot, "projects")
    const projectDir = path.resolve(projectsDir, projectId)
    if (path.dirname(projectDir) !== projectsDir) throw new AnalysisRequestError(400, "INVALID_PROJECT_ID", "Project id resolves outside the projects directory")
    return { projectDir, projectManifest: path.join(projectDir, "project.json") }
  }

  async function loadProject(projectId: string) {
    const resolved = projectPaths(projectId)
    try {
      const manifest = projectSchema.parse(JSON.parse(await readFile(resolved.projectManifest, "utf8")))
      if (manifest.id !== projectId) throw new AnalysisRequestError(409, "PROJECT_ID_MISMATCH", "Project directory and manifest ids do not match")
      const analysisDir = path.resolve(resolved.projectDir, manifest.analysisDir)
      if (path.relative(resolved.projectDir, analysisDir).startsWith("..")) throw new AnalysisRequestError(500, "INVALID_PROJECT_MANIFEST", "Analysis directory escapes the project")
      return {
        ...resolved, manifest, analysisDir,
        photos: path.join(analysisDir, "photos.json"), content: path.join(analysisDir, "photo_content.json"),
        runManifest: path.join(analysisDir, "web-analysis.json"), cull: path.join(analysisDir, "cull_suggestion.json"),
        approval: path.join(analysisDir, "cull_approval.json"),
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new AnalysisRequestError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`)
      if (error instanceof AnalysisRequestError) throw error
      throw new AnalysisRequestError(500, "INVALID_PROJECT_MANIFEST", "Project manifest is invalid")
    }
  }

  async function optionalJson(file: string): Promise<unknown | null> {
    try { return JSON.parse(await readFile(file, "utf8")) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
      return { invalid: messageOf(error) }
    }
  }

  function estimateVision(photosDoc: unknown, uploaded: number): VisionEstimate {
    const model = process.env.VISION_MODEL || "gpt-5.5"
    const baseUrl = (process.env.VISION_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "")
    let provider = baseUrl
    try { provider = new URL(baseUrl).hostname } catch { /* status reports the configured value */ }
    const configured = Boolean(process.env.VISION_API_KEY || process.env.OPENAI_API_KEY) && !/(^|\.)deepseek\.com$/i.test(provider)
    const photos = z.object({ photos: z.array(z.object({ w: z.number().positive(), h: z.number().positive() }).passthrough()) }).safeParse(photosDoc)
    const photoCount = photos.success ? photos.data.photos.length : uploaded
    const requests = Math.ceil(photoCount / 12)
    let imageInputTokens: number | null = null
    if (photos.success) {
      imageInputTokens = photos.data.photos.reduce((total, photo) => {
        const scale = Math.min(1, 512 / Math.max(photo.w, photo.h))
        return total + Math.ceil(photo.w * scale / 32) * Math.ceil(photo.h * scale / 32)
      }, 0)
    }
    const configuredInput = Number(process.env.VISION_INPUT_USD_PER_MILLION)
    const configuredOutput = Number(process.env.VISION_OUTPUT_USD_PER_MILLION)
    const knownRate = provider === "api.openai.com" ? OPENAI_RATES[model] : undefined
    const inputRate = Number.isFinite(configuredInput) && configuredInput > 0 ? configuredInput : knownRate?.input
    const outputRate = Number.isFinite(configuredOutput) && configuredOutput > 0 ? configuredOutput : knownRate?.output
    let estimatedUsd: VisionEstimate["estimatedUsd"] = null
    if (imageInputTokens !== null && inputRate && outputRate) {
      const estimatedInputTokens = imageInputTokens + requests * 700 + photoCount * 10
      const estimatedOutputTokens = photoCount * 110
      const midpoint = estimatedInputTokens / 1_000_000 * inputRate + estimatedOutputTokens / 1_000_000 * outputRate
      estimatedUsd = { low: roundCost(midpoint * 0.75), high: roundCost(midpoint * 1.5) }
    }
    return {
      model, provider, configured, photoCount, requests, imageInputTokens, estimatedUsd,
      pricingNote: knownRate && !process.env.VISION_INPUT_USD_PER_MILLION
        ? "Planning range from OpenAI public token rates checked 2026-07-21; actual usage is authoritative."
        : inputRate && outputRate ? "Planning range from configured provider token rates; actual usage is authoritative." : "Set provider input/output rates to estimate USD.",
    }
  }

  async function get(projectId: string): Promise<AnalysisSnapshot> {
    const project = await loadProject(projectId)
    const assets = await listProjectAssets(projectId, engineRoot)
    const [photosValue, contentValue, cullValue, approvalValue, persistedRun] = await Promise.all([
      optionalJson(project.photos), optionalJson(project.content), optionalJson(project.cull), optionalJson(project.approval), optionalJson(project.runManifest),
    ])
    const photosDoc = z.object({ count: z.number().int(), photos: z.array(z.unknown()) }).safeParse(photosValue)
    const contentDoc = z.object({ count: z.number().int(), generatedBy: z.string() }).safeParse(contentValue)
    const cull = cullSuggestionSchema.safeParse(cullValue)
    const approval = z.object({ appliedAt: z.string(), keep: z.number().int(), sourceCount: z.number().int() }).safeParse(approvalValue)
    const activeRun = active.get(projectId)?.run
    const diskRun = analysisRunSchema.safeParse(persistedRun)
    const music = await Promise.all(project.manifest.music.map(async (file) => {
      const target = path.join(project.analysisDir, "music", `${path.parse(file).name}.json`)
      const value = await optionalJson(target)
      if (value === null) return { file, status: "pending" as const, duration: null, bpm: null, error: null }
      const parsed = z.object({ duration: z.number().positive(), bpmEstimate: z.number().nonnegative() }).safeParse(value)
      return parsed.success
        ? { file, status: "completed" as const, duration: parsed.data.duration, bpm: parsed.data.bpmEstimate, error: null }
        : { file, status: "invalid" as const, duration: null, bpm: null, error: "Music analysis JSON is invalid or incomplete" }
    }))
    return {
      projectId,
      run: activeRun || (diskRun.success ? diskRun.data : null),
      photos: { uploaded: assets.photos.length, technical: photosDoc.success ? photosDoc.data.count : 0, semantic: contentDoc.success ? contentDoc.data.count : 0, generatedBy: contentDoc.success ? contentDoc.data.generatedBy : null },
      music,
      vision: estimateVision(photosValue, assets.photos.length),
      cull: cull.success ? cull.data : null,
      appliedCull: approval.success ? approval.data : null,
    }
  }

  function capture(child: ChildProcessByStdio<null, Readable, Readable>, run: z.infer<typeof analysisRunSchema>, stream: "stdout" | "stderr") {
    let remainder = ""
    child[stream].on("data", (chunk: Buffer) => {
      const lines = (remainder + chunk.toString("utf8")).split(/\r?\n/)
      remainder = lines.pop() || ""
      for (const line of lines.filter(Boolean)) {
        run.logs = [...run.logs.slice(-199), `${stream === "stderr" ? "!" : ">"} ${line}`]
        if (/ffprobe|ffmpeg|probe|decode failed|could not analyze/i.test(line)) run.probeErrors = [...run.probeErrors, line].slice(-20)
      }
    })
    child[stream].on("end", () => { if (remainder) run.logs = [...run.logs.slice(-199), `${stream === "stderr" ? "!" : ">"} ${remainder}`] })
  }

  async function start(projectId: string, rawInput: StartAnalysisInput) {
    const input = startAnalysisInputSchema.parse(rawInput)
    if (active.has(projectId)) throw new AnalysisRequestError(409, "ANALYSIS_ALREADY_RUNNING", "Analysis is already running for this project")
    const project = await loadProject(projectId)
    if (input.kind === "vision") {
      try { await stat(project.photos) } catch { throw new AnalysisRequestError(409, "TECHNICAL_ANALYSIS_REQUIRED", "Run technical photo analysis before vision") }
      const estimate = (await get(projectId)).vision
      if (!estimate.configured) throw new AnalysisRequestError(409, "VISION_NOT_CONFIGURED", "Vision requires a compatible provider and VISION_API_KEY or OPENAI_API_KEY")
    }
    let release: () => void
    try { release = acquireProjectOperation(engineRoot, projectId, "analysis") } catch (error) {
      if (error instanceof ProjectOperationBusyError) throw new AnalysisRequestError(409, "PROJECT_BUSY", error.message)
      throw error
    }
    const args = input.kind === "technical"
      ? ["scripts/analyzeProject.mjs", "--project", `projects/${projectId}`, "--skip-vision"]
      : ["scripts/analyzePhotoContent.mjs", "--photos", `projects/${projectId}/${project.manifest.analysisDir}/photos.json`, "--out", `projects/${projectId}/${project.manifest.analysisDir}/photo_content.json`, "--require-vision"]
    const startedAt = new Date().toISOString()
    const run = analysisRunSchema.parse({ version: 1, status: "running", kind: input.kind, startedAt, updatedAt: startedAt, error: null, probeErrors: [], logs: [] })
    await writeJsonAtomic(project.runManifest, run)
    let child: ChildProcessByStdio<null, Readable, Readable>
    try {
      child = spawn(process.execPath, args, { cwd: engineRoot, env: process.env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] })
    } catch (error) {
      release()
      throw error
    }
    active.set(projectId, { child, run, release })
    capture(child, run, "stdout")
    capture(child, run, "stderr")
    child.once("close", async (code) => {
      run.status = code === 0 ? "completed" : "failed"
      run.updatedAt = new Date().toISOString()
      run.error = code === 0 ? null : run.probeErrors.at(-1) || run.logs.filter((line) => line.startsWith("!")).at(-1)?.slice(2) || `Analysis process exited with code ${code ?? 1}`
      await writeJsonAtomic(project.runManifest, run).catch(() => undefined)
      active.delete(projectId)
      release()
    })
    child.once("error", (error) => { run.error = error.message })
    return get(projectId)
  }

  async function runCullCommand(projectId: string, keep: number) {
    const project = await loadProject(projectId)
    const photosRaw = await readFile(project.photos, "utf8").catch(() => { throw new AnalysisRequestError(409, "TECHNICAL_ANALYSIS_REQUIRED", "Run technical photo analysis before creating a cull suggestion") })
    let release: () => void
    try { release = acquireProjectOperation(engineRoot, projectId, "cull") } catch (error) {
      if (error instanceof ProjectOperationBusyError) throw new AnalysisRequestError(409, "PROJECT_BUSY", error.message)
      throw error
    }
    try {
      const args = ["scripts/suggestCull.mjs", "--photos", `projects/${projectId}/${project.manifest.analysisDir}/photos.json`, "--keep", String(keep), "--out", `projects/${projectId}/${project.manifest.analysisDir}/cull_suggestion.json`]
      try { await stat(path.join(project.projectDir, "brief.json")); args.push("--brief", `projects/${projectId}/brief.json`) } catch { /* brief is optional */ }
      const result = await new Promise<{ code: number; error: string }>((resolve) => {
        const child = spawn(process.execPath, args, { cwd: engineRoot, env: process.env, windowsHide: true, stdio: ["ignore", "ignore", "pipe"] })
        let error = ""
        child.stderr.on("data", (chunk: Buffer) => { error += chunk.toString("utf8") })
        child.once("error", (reason) => resolve({ code: 1, error: reason.message }))
        child.once("close", (code) => resolve({ code: code ?? 1, error }))
      })
      if (result.code !== 0) throw new AnalysisRequestError(400, "CULL_SUGGESTION_FAILED", result.error.trim() || "Cull suggestion failed")
      const suggestion = cullSuggestionSchema.parse(JSON.parse(await readFile(project.cull, "utf8")))
      const enriched = { ...suggestion, sourceHash: createHash("sha256").update(photosRaw).digest("hex") }
      await writeJsonAtomic(project.cull, enriched)
      return get(projectId)
    } finally { release() }
  }

  async function suggestCull(projectId: string, rawInput: { keep: number }) {
    const input = cullInputSchema.parse(rawInput)
    return runCullCommand(projectId, input.keep)
  }

  async function applyCull(projectId: string) {
    const project = await loadProject(projectId)
    let release: () => void
    try { release = acquireProjectOperation(engineRoot, projectId, "cull") } catch (error) {
      if (error instanceof ProjectOperationBusyError) throw new AnalysisRequestError(409, "PROJECT_BUSY", error.message)
      throw error
    }
    try {
      const photosRaw = await readFile(project.photos, "utf8").catch(() => { throw new AnalysisRequestError(409, "TECHNICAL_ANALYSIS_REQUIRED", "Technical photo analysis is missing") })
      const photosDoc = z.object({ dir: z.string(), photos: z.array(z.object({ file: z.string() }).passthrough()) }).parse(JSON.parse(photosRaw))
      const suggestion = cullSuggestionSchema.parse(JSON.parse(await readFile(project.cull, "utf8")))
      const sourceHash = createHash("sha256").update(photosRaw).digest("hex")
      if (!suggestion.sourceHash || suggestion.sourceHash !== sourceHash || suggestion.sourceCount !== photosDoc.photos.length) {
        throw new AnalysisRequestError(409, "STALE_CULL_SUGGESTION", "Photo analysis changed; generate a new cull suggestion before applying")
      }
      const drop = new Set(suggestion.drop.map((item) => item.file))
      if ([...drop].some((file) => !photosDoc.photos.some((photo) => photo.file === file))) throw new AnalysisRequestError(409, "INVALID_CULL_SUGGESTION", "Cull suggestion references an unknown photo")
      const selected = photosDoc.photos.filter((photo) => !drop.has(photo.file))
      const appliedAt = new Date().toISOString()
      const approval = { version: 1, appliedAt, suggestionGeneratedAt: suggestion.generatedAt, sourceHash, keep: selected.length, sourceCount: photosDoc.photos.length, drop: suggestion.drop }
      const selectedPath = path.resolve(project.projectDir, project.manifest.selectedPhotos || `${project.manifest.analysisDir}/photos.selected.json`)
      if (path.relative(project.projectDir, selectedPath).startsWith("..")) throw new AnalysisRequestError(500, "INVALID_PROJECT_MANIFEST", "Selected photos path escapes the project")
      await writeJsonAtomic(project.approval, approval)
      await writeJsonAtomic(selectedPath, { dir: photosDoc.dir, count: selected.length, sourceCount: photosDoc.photos.length, policy: "cull_approved", removed: [...drop], photos: selected })
      return get(projectId)
    } finally { release() }
  }

  async function shutdown() {
    for (const running of active.values()) running.child.kill("SIGTERM")
  }

  return { get, start, suggestCull, applyCull, shutdown }
}

export const analysisService = createAnalysisService()
