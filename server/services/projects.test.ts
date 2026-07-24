import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createProject, createProjectInputSchema, listProjects, listSharedProjects, setProjectShared, UnknownRecipeError } from "./projects.js"

test("project service reports real status, progress, paused state, and invalid manifests", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-projects-"))
  context.after(() => rm(root, { recursive: true, force: true }))

  const projectDir = path.join(root, "projects", "linh-nam")
  await mkdir(path.join(projectDir, "analysis"), { recursive: true })
  await writeFile(path.join(projectDir, "project.json"), JSON.stringify({
    version: 1,
    id: "linh-nam",
    name: "Linh & Nam",
    tier: "template",
    recipe: "warm-film-01",
    inputDir: "input",
    music: ["music/song.mp3"],
    analysisDir: "analysis",
    timeline: "timeline/final.json",
    output: "output/final.mp4",
    quality: "share",
    createdAt: "2026-07-20T10:00:00.000Z",
  }))
  const phase = (status: string) => ({ status })
  await writeFile(path.join(projectDir, "analysis", "job-manifest.json"), JSON.stringify({
    schemaVersion: 1,
    projectId: "linh-nam",
    status: "paused",
    startedAt: "2026-07-20T10:00:00.000Z",
    updatedAt: "2026-07-21T10:00:00.000Z",
    currentPhase: "plan",
    phases: {
      validate: phase("completed"), analyze: phase("completed"), plan: phase("running"),
      build: phase("pending"), render: phase("pending"), qa: phase("pending"), deliver: phase("pending"),
    },
    artifacts: {},
  }))

  const invalidDir = path.join(root, "projects", "broken")
  await mkdir(invalidDir, { recursive: true })
  await writeFile(path.join(invalidDir, "project.json"), "{")

  const result = await listProjects(root)
  assert.equal(result.projects.length, 1)
  assert.equal(result.projects[0].status, "paused")
  assert.equal(result.projects[0].currentPhase, "plan")
  assert.equal(result.projects[0].progress, 29)
  assert.equal(result.issues.length, 1)
  assert.equal(result.issues[0].projectId, "broken")
})

test("project creation writes a complete template workspace and rejects duplicates", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-create-"))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, "story-templates"), { recursive: true })
  await mkdir(path.join(root, "layouts"), { recursive: true })
  await writeFile(path.join(root, "layouts", "library.json"), JSON.stringify({ designTokens: { themes: { warm_film: { background: "#fff", palette: { accent: "#a65" } } } } }))
  await writeFile(path.join(root, "story-templates", "warm-film-01.json"), JSON.stringify({ id: "warm-film-01", name: "Warm Film", libraryTheme: "warm_film", scenes: [] }))

  const input = {
    name: "Linh & Nam Wedding Film", bride: "Linh", groom: "Nam", language: "vi" as const,
    sequenceMode: "editorial" as const, tier: "template" as const, recipe: "warm-film-01",
    quality: "share" as const, musicMode: "auto" as const, creativeBrief: "",
  }
  await assert.rejects(createProject({ ...input, recipe: "missing-recipe" }, undefined, root), UnknownRecipeError)
  const created = await createProject(input, "owner-1", root)
  assert.equal(created.id, "linh-nam-wedding-film")
  assert.equal(created.status, "not_started")
  assert.equal(created.ownerId, "owner-1")
  const projectDir = path.join(root, "projects", created.id)
  const manifest = JSON.parse(await readFile(path.join(projectDir, "project.json"), "utf8"))
  const brief = JSON.parse(await readFile(path.join(projectDir, "brief.json"), "utf8"))
  assert.equal(manifest.recipe, "warm-film-01")
  assert.equal(manifest.ownerId, "owner-1")
  assert.equal(brief.bride, "Linh")
  assert.equal(brief.groom, "Nam")
  await stat(path.join(projectDir, "input"))
  await stat(path.join(projectDir, "analysis", "qa"))

  // Different owners can reuse the same display name — the second create
  // must succeed with a disambiguated id instead of rejecting.
  const again = await createProject(input, "owner-2", root)
  assert.notEqual(again.id, created.id)
  assert.match(again.id, /^linh-nam-wedding-film-[0-9a-f]{4}$/)
  assert.equal(again.ownerId, "owner-2")
})

test("setProjectShared toggles visibility and listSharedProjects only surfaces shared projects", async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-share-"))
  context.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(path.join(root, "story-templates"), { recursive: true })
  await mkdir(path.join(root, "layouts"), { recursive: true })
  await writeFile(path.join(root, "layouts", "library.json"), JSON.stringify({ designTokens: { themes: { warm_film: { background: "#fff", palette: { accent: "#a65" } } } } }))
  await writeFile(path.join(root, "story-templates", "warm-film-01.json"), JSON.stringify({ id: "warm-film-01", name: "Warm Film", libraryTheme: "warm_film", scenes: [] }))

  const input = {
    name: "Linh & Nam Wedding Film", bride: "Linh", groom: "Nam", language: "vi" as const,
    sequenceMode: "editorial" as const, tier: "template" as const, recipe: "warm-film-01",
    quality: "share" as const, musicMode: "auto" as const, creativeBrief: "",
  }
  const created = await createProject(input, "owner-1", root)
  assert.equal(created.shared, false)
  assert.deepEqual(await listSharedProjects(root), [])

  const shared = await setProjectShared(created.id, true, root)
  assert.equal(shared.shared, true)
  const sharedList = await listSharedProjects(root)
  assert.equal(sharedList.length, 1)
  assert.equal(sharedList[0].id, created.id)

  const unshared = await setProjectShared(created.id, false, root)
  assert.equal(unshared.shared, false)
  assert.deepEqual(await listSharedProjects(root), [])
})

test("template creation contract requires a recipe and rejects recipes on other tiers", () => {
  assert.equal(createProjectInputSchema.safeParse({
    name: "Missing recipe", bride: "A", groom: "B", language: "vi", sequenceMode: "editorial",
    tier: "template", quality: "share", musicMode: "auto", creativeBrief: "",
  }).success, false)
  assert.equal(createProjectInputSchema.safeParse({
    name: "Lite film", bride: "A", groom: "B", language: "vi", sequenceMode: "editorial",
    tier: "lite", recipe: "warm-film-01", quality: "share", musicMode: "auto", creativeBrief: "A story",
  }).success, false)
})
