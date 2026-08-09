import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { arg, loadProject } from "./lib/project.mjs";
import { adaptLiteStory } from "./lib/liteStoryAdapter.mjs";
import { LITE_STYLE_PROFILES } from "./lib/liteStyleProfiles.mjs";
import { placeStoryCopy } from "./lib/liteStoryPlacement.mjs";
import { nudgeGrade } from "./lib/composedLooks.mjs";

const root = process.cwd();
const projectArg = arg("--project");
const project = loadProject(projectArg);
const read = (relative) => JSON.parse(fs.readFileSync(project.abs(relative), "utf8"));
const write = (relative, value) => {
  const absolute = project.abs(relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, JSON.stringify(value, null, 2) + "\n");
};
const run = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || `${script} exited ${result.status}`);
  if (result.stdout.trim()) console.log(result.stdout.trim());
};

const analysisDir = project.manifest.analysisDir;
const analysisRel = project.rel(analysisDir);
const selected = project.manifest.selectedPhotos || `${analysisDir}/photos.selected.json`;
const selectedProjectPath = fs.existsSync(project.abs(selected)) ? selected : `${analysisDir}/photos.json`;
const selectedRel = project.rel(selectedProjectPath);
const storyRel = project.manifest.story || `${analysisDir}/story-template.generated.json`;
const story = read(storyRel);
const promptRel = project.manifest.promptFile || "prompt.txt";
const prompt = fs.existsSync(project.abs(promptRel)) ? fs.readFileSync(project.abs(promptRel), "utf8") : "";
const adapter = adaptLiteStory({ story, prompt, requestedStyle: project.manifest.styleProfile });
const adapterRel = project.rel(`${analysisDir}/lite-story-adapter.json`);
const storyboardRel = project.rel(`${analysisDir}/lite-storyboard.json`);
const styleDirectionRel = project.rel(`${analysisDir}/lite-style-direction.json`);
write(`${analysisDir}/lite-story-adapter.json`, adapter);

const music = (project.manifest.music || []).map((track) => project.rel(track));
const targetDuration = Math.max(15, (read(selectedProjectPath).photos || []).length * 5);
const selectedProfile = LITE_STYLE_PROFILES[adapter.styleProfile];
write(`${analysisDir}/lite-style-direction.json`, { version: 1, profile: selectedProfile.id, provenance: adapter.styleProvenance,
  director_notes: {
    libraryTheme: selectedProfile.libraryTheme,
    singlePhotoEffects: selectedProfile.singlePhotoEffects,
    montageEffects: selectedProfile.montageEffects,
    transitionPalette: selectedProfile.transitionPalette,
    layoutMix: selectedProfile.layoutMix,
  } });
const composeArgs = [
  "--photos", selectedRel,
  "--analysis-dir", analysisRel,
  "--plan", adapterRel,
  "--director", styleDirectionRel,
  "--theme", LITE_STYLE_PROFILES[adapter.styleProfile].libraryTheme,
  "--name", `${project.manifest.id}-lite-v2`,
  "--out", storyboardRel,
  "--max-reuse", "1",
  ...(music.length ? ["--music", music[0], ...music.slice(1).flatMap((track) => ["--extra-music", track])]
    : ["--target-duration", String(targetDuration)]),
  ...(project.manifest.musicMode ? ["--music-mode", project.manifest.musicMode] : []),
  ...(fs.existsSync(project.abs("brief.json")) ? ["--brief", project.rel("brief.json")] : []),
  ...(fs.existsSync(project.abs("directives.json")) ? ["--directives", project.rel("directives.json")] : []),
];
run("scripts/composeStoryboard.mjs", composeArgs);

const recipe = JSON.parse(fs.readFileSync(path.resolve(root, storyboardRel), "utf8"));
const profile = LITE_STYLE_PROFILES[adapter.styleProfile];
// Group the scenes by act, then let lib/liteStoryPlacement.mjs put each act's
// words somewhere that can actually show them — see that file for what used to
// go wrong here and why the placement is act-wide rather than first-scene-only.
const byAct = new Map(adapter.acts.map((act) => [act.id, act]));
const groups = new Map();
for (const [index, scene] of recipe.scenes.entries()) {
  if (scene.id === "s99_closing") continue;
  const act = byAct.get(scene.act) || adapter.acts[Math.min(adapter.acts.length - 1,
    Math.floor(index * adapter.acts.length / Math.max(1, recipe.scenes.length - 1)))];
  if (!act) continue;
  scene.act = act.id;
  scene.photoHints = act.photoHints;
  if (!groups.has(act.id)) groups.set(act.id, { act, scenes: [], firstIndex: index });
  groups.get(act.id).scenes.push(scene);
}
const placements = placeStoryCopy([...groups.values()], { title: story.title });
// Say it out loud. A chapter that never reaches the screen is invisible in the
// render, in the QA report and in every gate — the only place it can show up is
// here, so this line is the whole early warning.
const toldChapters = placements.filter((row) => !row.hasBody || row.bodyAt).length;
console.log(`[story] ${toldChapters}/${placements.length} chapter(s) placed: ${placements
  .map((row) => `${row.act}→${row.bodyAt || (row.hasBody ? "LOST" : "—")}`).join(" ")}`);
if (toldChapters < placements.length) console.warn(`[story] WARNING: ${placements.length - toldChapters} chapter(s) of the customer's story have nowhere to appear.`);
// The style profile decides the LOOK of the grade; the job decides where inside it this
// particular film sits. Assigning the profile's numbers flat meant every couple who landed
// on white_wedding_gentle got the same four values to three decimal places.
recipe.defaults.color = nudgeGrade(profile.grade, project.manifest.id);
// No `defaults.fonts` here on purpose: resolveFont() reads defaults.fonts BEFORE the
// library theme, so writing one pins every slot and throws away the theme's display
// face and script accent. `recipe.libraryTheme` (set by composeStoryboard from --theme)
// carries the typography instead — see liteStyleProfiles.mjs.
recipe.pipelineVersion = "lite-v2";
recipe.styleProfile = adapter.styleProfile;
recipe.storyAdapter = adapterRel;
recipe.openingPhotoHint = adapter.acts[0]?.photoHints?.[0] || null;
fs.writeFileSync(path.resolve(root, storyboardRel), JSON.stringify(recipe, null, 2) + "\n");

// The same gate premium runs (renderWithRetry node 8b'), at the same point in the flow:
// after the words are in the storyboard, before it is built. Lite writes its own copy in
// the loop above rather than through writeRecipeCopy, so there is no --copy to pass.
//
// Strict, and it throws: lite has no director layer to drop and no second composition to
// fall back to, so a finding that survives the repair is a film we should not be shipping.
// Measured on a real 41-scene job: the repair clears every finding this raises today.
run("scripts/lintComposedFilm.mjs", ["--storyboard", storyboardRel, "--repair", "--strict"]);

// And what it is MADE of, next to the corpus a person art-directed. Never fails a build —
// a photo-poor album legitimately scores lower than a rich one on half of these — but it is
// written down per job, because the whole argument for this pass was that a number nobody
// records is not a standard.
const scorecardRel = project.rel(`${analysisDir}/film-scorecard.json`);
run("scripts/gradeComposedFilm.mjs", ["--storyboard", storyboardRel, "--out", scorecardRel]);

const applyArgs = [
  "--template", storyboardRel,
  "--photos", selectedRel,
  "--analysis-dir", analysisRel,
  "--out", project.rel(project.manifest.timeline),
  "--output", project.rel(project.manifest.output),
  "--name", project.manifest.id,
  "--quality", project.manifest.quality || "share",
  "--tier", "lite",
  "--prompt", project.rel(promptRel),
  "--language", project.manifest.language || "vi",
  "--sequence-mode", project.manifest.sequenceMode || "editorial",
  "--allow-legacy-music-analysis",
  ...(music.length ? ["--music", music[0], ...music.slice(1).flatMap((track) => ["--extra-music", track])]
    : ["--target-duration", String(targetDuration)]),
  ...(project.manifest.musicMode ? ["--music-mode", project.manifest.musicMode] : []),
  ...(fs.existsSync(project.abs("brief.json")) ? ["--brief", project.rel("brief.json")] : []),
  ...(fs.existsSync(project.abs("directives.json")) ? ["--directives", project.rel("directives.json")] : []),
];
run("scripts/applyStoryTemplate.mjs", applyArgs);

const timeline = read(project.manifest.timeline);
timeline.metadata = {
  ...(timeline.metadata || {}),
  pipelineVersion: "lite-v2",
  qualityPolicyVersion: 2,
  storyTemplate: project.rel(storyRel),
  storyAdapter: adapterRel,
  storyboard: storyboardRel,
  scorecard: scorecardRel,
  styleProfile: adapter.styleProfile,
  styleProvenance: adapter.styleProvenance,
  targetDuration: timeline.recipeDecisions?.musicEdit?.duration,
  musicSync: timeline.recipeDecisions?.musicSync,
};
write(project.manifest.timeline, timeline);
write(`${analysisDir}/music-fit.json`, {
  version: 1,
  allocatorVersion: timeline.metadata.musicSync?.allocatorVersion || null,
  targetDuration: timeline.metadata.targetDuration,
  drift: timeline.metadata.musicSync?.drift ?? null,
  musicEdit: timeline.recipeDecisions?.musicEdit || null,
});
console.log(`Wrote ${project.rel(project.manifest.timeline)} through common composer + global assignment (${timeline.slides.length} scenes).`);
