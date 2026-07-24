import assert from "node:assert/strict"
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createDirectorService, DirectorRequestError } from "./director.js"

async function fixture(tier: "template" | "lite" | "premium") {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-director-"))
  const project = path.join(root, "projects", "sample")
  const analysis = path.join(project, "analysis")
  await mkdir(path.join(analysis, "music"), { recursive: true })
  await writeFile(path.join(project, "project.json"), JSON.stringify({ id: "sample", tier, analysisDir: "analysis", promptFile: "prompt.txt", story: "analysis/story-template.generated.json", selectedPhotos: "analysis/photos.json", music: ["music/song.mp3"], language: "en" }))
  await writeFile(path.join(project, "prompt.txt"), "Old brief")
  await writeFile(path.join(analysis, "photo_content.json"), JSON.stringify({ photos: [{ file: "a.jpg" }] }))
  await writeFile(path.join(analysis, "photos.json"), JSON.stringify({ photos: [{ file: "a.jpg" }] }))
  await writeFile(path.join(analysis, "music", "song.json"), JSON.stringify({ duration: 120 }))
  const runner = async (args: string[]) => {
    const script = args[0], value = (flag: string) => args[args.indexOf(flag) + 1]
    const save = async (relative: string, data: unknown) => writeFile(path.resolve(root, relative), JSON.stringify(data))
    if (script.endsWith("generateProjectStory.mjs")) await save("projects/sample/analysis/story-template.generated.json", { title: "Lite story", beats: [{ heading: "Open", body: "Begin", emotion: "calm", sceneKind: "single" }] })
    if (script.endsWith("generateStoryOptions.mjs")) await save(value("--out"), { recommended: "A", options: ["A", "B", "C", "D"].map((id) => ({ id, title: `Option ${id}`, mood: "warm", pacing: "medium", emotionalArc: "rise", summary: "story" })) })
    if (script.endsWith("selectStoryOption.mjs") && args.includes("--send")) await save("projects/sample/analysis/story_choice_window.json", { status: "open", openedAt: "2026-01-01", deadlineAt: "2026-01-02", timeoutHours: 24 })
    if (script.endsWith("selectStoryOption.mjs") && args.includes("--choice")) await save(value("--out"), { choice: value("--choice"), source: "user", selected: { id: value("--choice"), title: "Chosen" }, decisionWindow: { openedAt: "2026-01-01", deadlineAt: "2026-01-02", timeoutHours: 24 } })
    if (script.endsWith("generateDirectorNotes.mjs")) await save(value("--out"), { storyTitle: "Chosen", creative_brief: { style: "warm" }, director_notes: { heroEffect: "slow_zoom_in" } })
    if (script.endsWith("generateStoryPlan.mjs")) await save(value("--out"), { segments: [{ segment: "opening", goal: "Welcome" }] })
    if (script.endsWith("selectMusicEdit.mjs")) await save(value("--out"), { mode: value("--choice"), source: "user", reason: "chosen", sourceDuration: 120 })
    return "ok"
  }
  return { root, project, service: createDirectorService(root, runner) }
}

test("Lite director saves the brief and creates one story", async (context) => {
  const { root, project, service } = await fixture("lite"); context.after(() => rm(root, { recursive: true, force: true }))
  const state = await service.generate("sample", { brief: "A quiet family story" })
  assert.equal(state.liteStory && (state.liteStory as { title: string }).title, "Lite story")
  assert.equal((await readFile(path.join(project, "prompt.txt"), "utf8")).trim(), "A quiet family story")
})

test("Premium director keeps decision gates before producing notes and plan", async (context) => {
  const { root, service } = await fixture("premium"); context.after(() => rm(root, { recursive: true, force: true }))
  const proposed = await service.generate("sample", { brief: "Tell our full journey" })
  assert.equal((proposed.storyOptions as { options: unknown[] }).options.length, 4)
  assert.equal((proposed.storyWindow as { status: string }).status, "open")
  const chosen = await service.chooseStory("sample", { choice: "C" })
  assert.equal((chosen.selectedStory as { choice: string }).choice, "C"); assert.ok(chosen.directorNotes); assert.ok(chosen.storyPlan)
  const music = await service.chooseMusic("sample", { mode: "highlight" })
  assert.equal((music.selectedMusic as { mode: string }).mode, "highlight")
})

test("Template projects cannot enter the AI Director workflow", async (context) => {
  const { root, service } = await fixture("template"); context.after(() => rm(root, { recursive: true, force: true }))
  await assert.rejects(() => service.get("sample"), (error: unknown) => error instanceof DirectorRequestError && error.code === "DIRECTOR_NOT_AVAILABLE")
})
