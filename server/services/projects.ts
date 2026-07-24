import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"

import { z } from "zod"

import { getRecipe } from "./recipes.js"

const phaseNames = ["validate", "analyze", "plan", "build", "render", "qa", "deliver"] as const
const phaseStatusSchema = z.enum(["pending", "running", "completed", "failed", "skipped"])
const projectStatusSchema = z.enum(["not_started", "running", "completed", "completed_with_warning", "failed", "paused", "invalid"])

const projectSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  name: z.string().min(1),
  tier: z.enum(["template", "lite", "premium"]).optional(),
  recipe: z.string().optional(),
  quality: z.enum(["draft", "share", "high", "master"]),
  language: z.enum(["vi", "en"]).optional(),
  sequenceMode: z.enum(["editorial", "chronological"]).optional(),
  createdAt: z.string().optional(),
  analysisDir: z.string().min(1),
  // Optional so pre-existing project directories created before multi-tenant
  // support (no owner recorded) keep parsing instead of becoming unreadable.
  ownerId: z.string().optional(),
  // Whether the owner has published this project's delivered video to the
  // public gallery. Optional for the same backward-compat reason as ownerId.
  shared: z.boolean().optional(),
}).passthrough()

const phaseSchema = z.object({
  status: phaseStatusSchema,
  startedAt: z.string().optional(),
  completedAt: z.string().optional(),
  reason: z.string().optional(),
})

const jobSchema = z.object({
  status: z.enum(["running", "completed", "completed_with_warning", "failed", "paused"]),
  updatedAt: z.string().min(1),
  currentPhase: z.enum(phaseNames).optional(),
  error: z.object({ phase: z.enum(phaseNames), message: z.string(), exitCode: z.number().int().optional() }).optional(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).passthrough()).optional(),
  phases: z.object(Object.fromEntries(phaseNames.map((name) => [name, phaseSchema])) as Record<(typeof phaseNames)[number], typeof phaseSchema>),
}).passthrough()

export const projectSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  tier: z.enum(["template", "lite", "premium", "unknown"]),
  recipe: z.string().nullable(),
  quality: z.enum(["draft", "share", "high", "master"]),
  language: z.enum(["vi", "en"]).nullable(),
  sequenceMode: z.enum(["editorial", "chronological"]).nullable(),
  status: projectStatusSchema,
  currentPhase: z.enum(phaseNames).nullable(),
  progress: z.number().min(0).max(100),
  updatedAt: z.string(),
  createdAt: z.string().nullable(),
  error: z.string().nullable(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() }).passthrough()).optional(),
  phases: z.record(phaseStatusSchema),
  // null = pre-existing project directory with no recorded owner (created
  // before multi-tenant support); such projects are invisible through the
  // owner-scoped API but remain readable by id for internal/CLI use.
  ownerId: z.string().nullable(),
  shared: z.boolean(),
})

export type ProjectSummary = z.infer<typeof projectSummarySchema>
export type ProjectIssue = { projectId: string; message: string }
export type ProjectListResult = { projects: ProjectSummary[]; issues: ProjectIssue[] }

export const createProjectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  bride: z.string().trim().min(1).max(100),
  groom: z.string().trim().min(1).max(100),
  language: z.enum(["vi", "en"]),
  sequenceMode: z.enum(["editorial", "chronological"]),
  tier: z.enum(["template", "lite", "premium"]),
  recipe: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
  quality: z.enum(["draft", "share", "high", "master"]),
  musicMode: z.enum(["auto", "highlight", "full_song"]),
  creativeBrief: z.string().trim().max(10000),
}).superRefine((input, context) => {
  if (input.tier === "template" && !input.recipe) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recipe"], message: "Template tier requires a recipe" })
  if (input.tier !== "template" && input.recipe) context.addIssue({ code: z.ZodIssueCode.custom, path: ["recipe"], message: "Recipe is only available for template tier" })
})

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>

export class ProjectAlreadyExistsError extends Error {}
export class UnknownRecipeError extends Error {}

function slug(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
}

async function parseJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"))
}

function progressFromJob(job: z.infer<typeof jobSchema>) {
  if (job.status === "completed" || job.status === "completed_with_warning") return 100
  const finished = phaseNames.filter((name) => ["completed", "skipped"].includes(job.phases[name].status)).length
  return Math.round((finished / phaseNames.length) * 100)
}

export async function listProjects(engineRoot = process.cwd()): Promise<ProjectListResult> {
  const projectsDir = path.join(engineRoot, "projects")
  let entries
  try {
    entries = await readdir(projectsDir, { withFileTypes: true })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { projects: [], issues: [] }
    throw error
  }

  const projects: ProjectSummary[] = []
  const issues: ProjectIssue[] = []

  for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const manifestPath = path.join(projectsDir, entry.name, "project.json")
    try {
      const project = projectSchema.parse(await parseJson(manifestPath))
      const manifestStat = await stat(manifestPath)
      const jobPath = path.join(projectsDir, entry.name, project.analysisDir, "job-manifest.json")
      let job: z.infer<typeof jobSchema> | null = null
      let jobError: string | null = null
      try {
        job = jobSchema.parse(await parseJson(jobPath))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          jobError = error instanceof Error ? error.message : String(error)
          issues.push({ projectId: project.id, message: `Invalid job manifest: ${jobError}` })
        }
      }

      const phaseStatuses = job
        ? Object.fromEntries(phaseNames.map((name) => [name, job.phases[name].status]))
        : Object.fromEntries(phaseNames.map((name) => [name, "pending"]))
      projects.push(projectSummarySchema.parse({
        id: project.id,
        name: project.name,
        tier: project.tier || "unknown",
        recipe: project.recipe || null,
        quality: project.quality,
        language: project.language || null,
        sequenceMode: project.sequenceMode || null,
        status: jobError ? "invalid" : job?.status || "not_started",
        currentPhase: job?.currentPhase || null,
        progress: job ? progressFromJob(job) : 0,
        updatedAt: job?.updatedAt || project.createdAt || manifestStat.mtime.toISOString(),
        createdAt: project.createdAt || null,
        error: jobError || job?.error?.message || null,
        warnings: job?.warnings || [],
        phases: phaseStatuses,
        ownerId: project.ownerId || null,
        shared: Boolean(project.shared),
      }))
    } catch (error) {
      issues.push({ projectId: entry.name, message: `Invalid project manifest: ${error instanceof Error ? error.message : String(error)}` })
    }
  }

  projects.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
  return { projects, issues }
}

export async function getProject(projectId: string, engineRoot = process.cwd()): Promise<ProjectSummary | null> {
  const result = await listProjects(engineRoot)
  return result.projects.find((project) => project.id === projectId) || null
}

export async function createProject(input: CreateProjectInput, ownerId?: string, engineRoot = process.cwd()): Promise<ProjectSummary> {
  const validated = createProjectInputSchema.parse(input)
  const baseId = slug(validated.name)
  if (!baseId) throw new Error("Project name does not contain any usable characters")
  if (validated.recipe && !await getRecipe(validated.recipe, engineRoot)) throw new UnknownRecipeError(`Recipe not found: ${validated.recipe}`)

  const projectsDir = path.resolve(engineRoot, "projects")
  await mkdir(projectsDir, { recursive: true })

  // Ids are derived from the couple's display name, so different owners can
  // legitimately pick the same name (e.g. two "Linh & Nam" projects). Retry
  // with a short random suffix instead of failing the whole request.
  let id = baseId
  let projectDir = path.resolve(projectsDir, id)
  const maxAttempts = 5
  for (let attempt = 1; ; attempt++) {
    if (path.dirname(projectDir) !== projectsDir) throw new Error("Resolved project path escapes the projects directory")
    try {
      await mkdir(projectDir)
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
      if (attempt >= maxAttempts) throw new ProjectAlreadyExistsError(`Project already exists: ${id}`)
      id = `${baseId}-${randomBytes(2).toString("hex")}`
      projectDir = path.resolve(projectsDir, id)
    }
  }

  try {
    for (const directory of ["input", "music", "analysis/music", "analysis/qa", "timeline", "output", "temp", "logs"]) {
      await mkdir(path.join(projectDir, directory), { recursive: true })
    }
    const createdAt = new Date().toISOString()
    const manifest = {
      version: 1,
      id,
      name: validated.name,
      language: validated.language,
      sequenceMode: validated.sequenceMode,
      createdAt,
      promptFile: "prompt.txt",
      inputDir: "input",
      music: [],
      analysisDir: "analysis",
      selectionPolicy: "analysis/selection_policy.json",
      selectedPhotos: "analysis/photos.selected.json",
      story: "analysis/story-template.generated.json",
      timeline: "timeline/timeline.json",
      output: "output/final.mp4",
      quality: validated.quality,
      tier: validated.tier,
      musicMode: validated.musicMode,
      ...(validated.recipe ? { recipe: validated.recipe } : {}),
      ...(ownerId ? { ownerId } : {}),
    }
    await writeFile(path.join(projectDir, "prompt.txt"), `${validated.creativeBrief}\n`, { encoding: "utf8", flag: "wx" })
    await writeFile(path.join(projectDir, "brief.json"), `${JSON.stringify({ bride: validated.bride, groom: validated.groom, creativeBrief: validated.creativeBrief, musicMode: validated.musicMode }, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
    await writeFile(path.join(projectDir, "project.json"), `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
  } catch (error) {
    await rm(projectDir, { recursive: true, force: true })
    throw error
  }

  const created = await getProject(id, engineRoot)
  if (!created) throw new Error(`Created project could not be read: ${id}`)
  return created
}

export async function setProjectShared(projectId: string, shared: boolean, engineRoot = process.cwd()): Promise<ProjectSummary> {
  const projectsDir = path.resolve(engineRoot, "projects")
  const projectDir = path.resolve(projectsDir, projectId)
  if (path.dirname(projectDir) !== projectsDir) throw new Error("Resolved project path escapes the projects directory")
  const manifestPath = path.join(projectDir, "project.json")
  const manifest = projectSchema.parse(await parseJson(manifestPath))
  const temporary = `${manifestPath}.${randomBytes(4).toString("hex")}.tmp`
  await writeFile(temporary, `${JSON.stringify({ ...manifest, shared }, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
  await rename(temporary, manifestPath)

  const updated = await getProject(projectId, engineRoot)
  if (!updated) throw new Error(`Project could not be read after updating share state: ${projectId}`)
  return updated
}

export async function listSharedProjects(engineRoot = process.cwd()): Promise<ProjectSummary[]> {
  const { projects } = await listProjects(engineRoot)
  return projects.filter((project) => project.shared)
}
