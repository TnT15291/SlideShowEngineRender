import { spawn } from "node:child_process"
import { readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"

import { z } from "zod"

import { acquireProjectOperation, ProjectOperationBusyError } from "./projectOperations.js"

export const directorGenerateSchema = z.object({ brief: z.string().trim().min(1).max(10_000) })
export const directorStoryChoiceSchema = z.object({ choice: z.enum(["A", "B", "C", "D"]) })
export const directorMusicChoiceSchema = z.object({ mode: z.enum(["highlight", "full_song"]) })
export type DirectorGenerateInput = z.infer<typeof directorGenerateSchema>
export type DirectorStoryChoiceInput = z.infer<typeof directorStoryChoiceSchema>
export type DirectorMusicChoiceInput = z.infer<typeof directorMusicChoiceSchema>
export type DirectorState = {
  projectId: string; tier: "lite" | "premium"; brief: string; ready: boolean
  liteStory: unknown | null; storyOptions: unknown | null; selectedStory: unknown | null; storyWindow: unknown | null
  selectedMusic: unknown | null; musicWindow: unknown | null; directorNotes: unknown | null; storyPlan: unknown | null
}

const projectSchema = z.object({
  id: z.string(), tier: z.enum(["template", "lite", "premium"]), analysisDir: z.string().min(1), promptFile: z.string().optional(),
  selectedPhotos: z.string().optional(), story: z.string().optional(), music: z.array(z.string()).default([]), language: z.enum(["vi", "en"]).optional(),
}).passthrough()

export class DirectorRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly details?: unknown) { super(message) }
}

function isInside(parent: string, child: string) {
  const relative = path.relative(parent, child)
  return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

async function atomicText(file: string, value: string) {
  const temporary = `${file}.${randomUUID()}.tmp`
  try { await writeFile(temporary, value, { encoding: "utf8", flag: "wx" }); await rename(temporary, file) }
  finally { await rm(temporary, { force: true }) }
}

export function createDirectorService(engineRoot = process.cwd(), commandRunner?: (args: string[]) => Promise<string>) {
  const projectsRoot = path.resolve(engineRoot, "projects")

  async function load(projectId: string) {
    const projectDir = path.resolve(projectsRoot, projectId)
    if (path.dirname(projectDir) !== projectsRoot) throw new DirectorRequestError(400, "INVALID_PROJECT_ID", "Project id resolves outside the projects directory")
    try {
      const manifest = projectSchema.parse(JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8")))
      if (manifest.id !== projectId) throw new DirectorRequestError(409, "PROJECT_ID_MISMATCH", "Project directory and manifest ids do not match")
      if (manifest.tier === "template") throw new DirectorRequestError(409, "DIRECTOR_NOT_AVAILABLE", "AI Director is available only for Lite and Premium projects")
      const analysisDir = path.resolve(projectDir, manifest.analysisDir)
      const prompt = path.resolve(projectDir, manifest.promptFile || "prompt.txt")
      if (!isInside(projectDir, analysisDir) || !isInside(projectDir, prompt)) throw new DirectorRequestError(500, "INVALID_PROJECT_MANIFEST", "A director path escapes the project directory")
      const rel = (file: string) => path.relative(engineRoot, path.join(analysisDir, file)).replace(/\\/g, "/")
      return { projectDir, manifest, analysisDir, prompt, rel, projectRel: path.relative(engineRoot, projectDir).replace(/\\/g, "/") }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new DirectorRequestError(404, "PROJECT_NOT_FOUND", `Project not found: ${projectId}`)
      if (error instanceof DirectorRequestError) throw error
      throw new DirectorRequestError(500, "INVALID_PROJECT_MANIFEST", "Project manifest is invalid")
    }
  }

  async function optionalJson(file: string) {
    try { return JSON.parse(await readFile(file, "utf8")) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new DirectorRequestError(500, "INVALID_DIRECTOR_DATA", `Cannot read ${path.basename(file)}`) }
  }

  async function get(projectId: string): Promise<DirectorState> {
    const project = await load(projectId)
    let brief = ""
    try { brief = await readFile(project.prompt, "utf8") } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
    const read = (name: string) => optionalJson(path.join(project.analysisDir, name))
    const [liteStory, storyOptions, selectedStory, storyWindow, selectedMusic, musicWindow, directorNotes, storyPlan] = await Promise.all([
      optionalJson(path.resolve(project.projectDir, project.manifest.story || "analysis/story-template.generated.json")),
      read("story_options.json"), read("selected_story.json"), read("story_choice_window.json"), read("selected_music.json"), read("music_choice_window.json"), read("director_notes.json"), read("story_plan.json"),
    ])
    const tier = project.manifest.tier as "lite" | "premium"
    return { projectId, tier, brief, ready: tier === "lite" ? Boolean(liteStory) : Boolean(storyPlan), liteStory, storyOptions, selectedStory, storyWindow, selectedMusic, musicWindow, directorNotes, storyPlan }
  }

  function run(args: string[], textCacheDir?: string) {
    if (commandRunner) return commandRunner(args)
    return new Promise<string>((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: engineRoot, windowsHide: true, env: { ...process.env, ...(textCacheDir ? { TEXT_CACHE_DIR: textCacheDir } : {}) } })
      let output = ""
      child.stdout.on("data", (chunk) => { output += String(chunk) }); child.stderr.on("data", (chunk) => { output += String(chunk) })
      child.once("error", reject); child.once("close", (code) => code === 0 ? resolve(output.trim()) : reject(new DirectorRequestError(code === 3 ? 409 : 400, code === 3 ? "DIRECTOR_DECISION_PENDING" : "DIRECTOR_COMMAND_FAILED", output.trim() || `Director command exited with ${code}`)))
    })
  }

  async function locked<T>(projectId: string, action: () => Promise<T>) {
    let release: (() => void) | undefined
    try { release = acquireProjectOperation(engineRoot, projectId, "director") } catch (error) {
      if (error instanceof ProjectOperationBusyError) throw new DirectorRequestError(409, "PROJECT_BUSY", error.message)
      throw error
    }
    try { return await action() } finally { release() }
  }

  async function invalidatePlan(project: Awaited<ReturnType<typeof load>>) {
    const file = path.join(project.analysisDir, "job-manifest.json")
    try {
      const value = JSON.parse(await readFile(file, "utf8")); const phases = ["plan", "build", "render", "qa", "deliver"]
      for (const phase of phases) if (value.phases?.[phase]) value.phases[phase] = { status: "pending", reason: "AI Director changed" }
      value.status = "paused"; value.currentPhase = "plan"; value.updatedAt = new Date().toISOString()
      await atomicText(file, `${JSON.stringify(value, null, 2)}\n`)
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error }
  }

  async function generate(projectId: string, input: DirectorGenerateInput) {
    return locked(projectId, async () => {
      const project = await load(projectId)
      await atomicText(project.prompt, `${input.brief.trim()}\n`)
      await run(["scripts/parseBrief.mjs", "--prompt", path.relative(engineRoot, project.prompt), "--out", path.relative(engineRoot, path.join(project.projectDir, "directives.json"))])
      if (project.manifest.tier === "lite") {
        await run(["scripts/generateProjectStory.mjs", "--project", project.projectRel], project.analysisDir)
      } else {
        const content = project.rel("photo_content.json")
        try { await readFile(path.resolve(engineRoot, content)) } catch { throw new DirectorRequestError(409, "PHOTO_CONTENT_REQUIRED", "Run Vision analysis before generating Premium story directions") }
        await Promise.all(["selected_story.json", "director_notes.json", "story_plan.json"].map((name) => rm(path.join(project.analysisDir, name), { force: true })))
        await run(["scripts/generateStoryOptions.mjs", "--content", content, "--brief", input.brief, "--directives", path.relative(engineRoot, path.join(project.projectDir, "directives.json")), "--out", project.rel("story_options.json"), "--language", project.manifest.language || "vi"], project.analysisDir)
        await run(["scripts/selectStoryOption.mjs", "--send", "--force", "--channel", "file", "--options", project.rel("story_options.json"), "--out", project.rel("selected_story.json")])
      }
      await invalidatePlan(project)
      return get(projectId)
    })
  }

  async function chooseStory(projectId: string, input: DirectorStoryChoiceInput) {
    return locked(projectId, async () => {
      const project = await load(projectId)
      if (project.manifest.tier !== "premium") throw new DirectorRequestError(409, "PREMIUM_REQUIRED", "Story direction choices require Premium")
      const directives = path.relative(engineRoot, path.join(project.projectDir, "directives.json"))
      await run(["scripts/selectStoryOption.mjs", "--choice", input.choice, "--force", "--options", project.rel("story_options.json"), "--out", project.rel("selected_story.json")])
      const music = project.manifest.music[0]
      await run(["scripts/generateDirectorNotes.mjs", "--options", project.rel("story_options.json"), "--selection", project.rel("selected_story.json"), ...(music ? ["--music", path.relative(engineRoot, path.join(project.projectDir, music))] : []), "--analysis-dir", path.relative(engineRoot, project.analysisDir), "--directives", directives, "--out", project.rel("director_notes.json"), "--language", project.manifest.language || "vi"], project.analysisDir)
      await run(["scripts/generateStoryPlan.mjs", "--notes", project.rel("director_notes.json"), "--content", project.rel("photo_content.json"), "--directives", directives, "--out", project.rel("story_plan.json"), "--language", project.manifest.language || "vi"], project.analysisDir)
      await invalidatePlan(project)
      return get(projectId)
    })
  }

  async function chooseMusic(projectId: string, input: DirectorMusicChoiceInput) {
    return locked(projectId, async () => {
      const project = await load(projectId)
      if (project.manifest.tier !== "premium") throw new DirectorRequestError(409, "PREMIUM_REQUIRED", "Music choice requires Premium")
      const music = project.manifest.music[0]
      if (!music) throw new DirectorRequestError(409, "MUSIC_REQUIRED", "Add and analyze a soundtrack before choosing its edit")
      const musicAnalysis = project.rel(`music/${path.parse(music).name}.json`)
      const photos = project.manifest.selectedPhotos ? path.relative(engineRoot, path.join(project.projectDir, project.manifest.selectedPhotos)) : project.rel("photos.json")
      await run(["scripts/selectMusicEdit.mjs", "--music-analysis", musicAnalysis, "--photos", photos, "--choice", input.mode, "--force", "--directives", path.relative(engineRoot, path.join(project.projectDir, "directives.json")), "--out", project.rel("selected_music.json")])
      await invalidatePlan(project)
      return get(projectId)
    })
  }

  return { get, generate, chooseStory, chooseMusic }
}

export const directorService = createDirectorService()
