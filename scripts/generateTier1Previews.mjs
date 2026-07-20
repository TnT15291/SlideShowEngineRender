import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { arg, loadProject, root } from "./lib/project.mjs";
import { makePreviewCut } from "./lib/previewCut.mjs";
const { fingerprintFiles } = createRequire(import.meta.url)("./lib/approvalFingerprint.cjs");

const projectArg = arg("--project");
const project = loadProject(projectArg);
const recipe = arg("--recipe", project.manifest.recipe || "");
if (!recipe) throw new Error("Tier 1 previews need --recipe or project.json recipe");
if (!project.manifest.music[0]) throw new Error("Tier 1 previews need music");
const dryRun = process.argv.includes("--dry-run");
const duration = Math.max(15, Math.min(25, Number(arg("--duration", "20")) || 20));
const analysis = project.rel(project.manifest.analysisDir);
const photos = fs.existsSync(project.abs(project.manifest.selectedPhotos || ""))
  ? project.rel(project.manifest.selectedPhotos) : `${analysis}/photos.json`;
const music = project.rel(project.manifest.music[0]);
const musicAnalysis = `${analysis}/music/${path.parse(project.manifest.music[0]).name}.json`;
for (const required of [photos, musicAnalysis]) if (!fs.existsSync(path.resolve(root, required))) throw new Error(`Missing ${required}; run project analysis first`);
const outDir = project.rel("output/previews");
const timelineDir = project.rel("timeline/previews");
const directionDir = `${analysis}/previews`;
for (const dir of [outDir, timelineDir, directionDir]) fs.mkdirSync(path.resolve(root, dir), { recursive: true });

function run(args, label) {
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${label} failed:\n${r.stderr || r.stdout}`);
}
const descriptions = {
  gentle: "more breathing room, softer transitions, fewer montage photos",
  balanced: "the recipe's middle rhythm and visual density",
  lively: "shorter scenes, tighter transitions, denser montage beats",
};
const variants = [];
for (const pacing of ["gentle", "balanced", "lively"]) {
  const direction = `${directionDir}/${pacing}.json`;
  const fullTimeline = `${timelineDir}/${pacing}.full.json`;
  const previewTimeline = `${timelineDir}/${pacing}.json`;
  const video = `${outDir}/${pacing}.mp4`;
  // A previous preview must not make pre-flight QA inspect stale rendered frames.
  fs.rmSync(path.resolve(root, video), { force: true });
  // The capacity clamp (photo set below the recipe's floor) lives in
  // chooseTier1Direction itself now, so previews and straight renders share it.
  run(["scripts/chooseTier1Direction.mjs", "--recipe", recipe, "--prompt", project.rel(project.manifest.promptFile || "prompt.txt"), "--photos", photos, "--music", musicAnalysis, "--pacing", pacing, "--out", direction], `direction ${pacing}`);
  run(["scripts/applyStoryTemplate.mjs", "--template", recipe, "--photos", photos, "--music", music, "--analysis-dir", analysis, "--direction", direction, "--out", fullTimeline, "--output", video, "--name", `${project.manifest.name} — ${pacing}`, "--quality", "draft", "--prompt", project.rel(project.manifest.promptFile || "prompt.txt")], `timeline ${pacing}`);
  run(["scripts/qaLoop.mjs", "--timeline", fullTimeline, "--analysis-dir", analysis, "--job-dir", project.relDir,
    "--tier", "template", "--max-revisions", "1", "--skip-render", "--strict"], `pre-flight QA ${pacing}`);
  const full = JSON.parse(fs.readFileSync(path.resolve(root, fullTimeline), "utf8"));
  const cut = makePreviewCut(full, { duration, output: video });
  fs.writeFileSync(path.resolve(root, previewTimeline), JSON.stringify(cut, null, 2) + "\n");
  run(["scripts/fitTextInTimeline.mjs", previewTimeline], `fit text ${pacing}`);
  run(["--import", "tsx", "src/index.ts", "--timeline", previewTimeline, "--job-dir", project.relDir, ...(dryRun ? ["--dry-run"] : [])], `render ${pacing}`);
  if (!dryRun) run(["scripts/generateContactSheet.mjs", previewTimeline, "--analysis-dir", analysis,
    "--out", `${outDir}/${pacing}.contact.jpg`, "--json", `${outDir}/${pacing}.contact.json`], `contact sheet ${pacing}`);
  const doc = JSON.parse(fs.readFileSync(path.resolve(root, direction), "utf8"));
  const photoFiles = (JSON.parse(fs.readFileSync(path.resolve(root, photos), "utf8")).photos || []).map((p) => p.file);
  const approvalInputs = [recipe, project.rel(project.manifest.promptFile || "prompt.txt"), photos, ...photoFiles, music, musicAnalysis, direction];
  variants.push({ id: pacing, description: descriptions[pacing], direction, timeline: previewTimeline, video: dryRun ? null : video,
    contactSheet: dryRun ? null : `${outDir}/${pacing}.contact.jpg`,
    duration, recipeId: doc.recipeId, themeId: doc.style.themeId, pacing: doc.pacing, sourceSceneIds: cut.preview.sourceSceneIds,
    approvalInputs, fingerprint: fingerprintFiles(root, approvalInputs),
    fullRenderArgs: ["node", "scripts/runProject.mjs", "--project", projectArg, "--tier", "template", "--recipe", recipe, "--direction", direction, "--deliver"] });
}
const manifest = { version: 1, generatedAt: new Date().toISOString(), project: project.manifest.id, dryRun, variants };
fs.writeFileSync(path.resolve(root, `${outDir}/directions.json`), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Tier 1 previews: ${variants.length} direction(s) -> ${outDir}`);
