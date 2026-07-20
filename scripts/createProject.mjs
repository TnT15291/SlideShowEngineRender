import fs from "node:fs";
import path from "node:path";
import { arg, root, slug } from "./lib/project.mjs";

const name = arg("--name", arg("--id", ""));
const id = slug(arg("--id", name));
if (!id) throw new Error("Usage: node scripts/createProject.mjs --id <id> [--name <title>] [--prompt <text>] [--input <dir>] [--music <file>] [--music-mode auto|highlight|full_song]");

const dir = path.join(root, "projects", id);
if (fs.existsSync(dir)) throw new Error(`Project already exists: ${dir}`);
for (const p of ["input", "music", "analysis/music", "analysis/qa", "timeline", "output", "temp", "logs"]) {
  fs.mkdirSync(path.join(dir, p), { recursive: true });
}

const copyImages = arg("--input");
if (copyImages) {
  const source = path.resolve(root, copyImages);
  for (const file of fs.readdirSync(source).filter((f) => /\.(jpe?g|png)$/i.test(f))) {
    fs.copyFileSync(path.join(source, file), path.join(dir, "input", file));
  }
}

const musicArg = arg("--music");
const music = [];
if (musicArg) {
  const source = path.resolve(root, musicArg);
  const dest = path.join(dir, "music", path.basename(source));
  fs.copyFileSync(source, dest);
  music.push(`music/${path.basename(dest)}`);
}

fs.writeFileSync(path.join(dir, "prompt.txt"), `${arg("--prompt", "")}\n`, "utf8");
const manifest = {
  version: 1,
  id,
  name: name || id,
  language: arg("--language", "vi"),
  sequenceMode: arg("--sequence-mode", "editorial"),
  createdAt: new Date().toISOString(),
  promptFile: "prompt.txt",
  inputDir: "input",
  music,
  analysisDir: "analysis",
  selectionPolicy: "analysis/selection_policy.json",
  selectedPhotos: "analysis/photos.selected.json",
  story: "analysis/story-template.generated.json",
  timeline: "timeline/timeline.json",
  output: "output/final.mp4",
  quality: arg("--quality", "share"),
  tier: arg("--tier", "lite"),
  musicMode: arg("--music-mode", "auto"),
  ...(arg("--recipe") ? { recipe: arg("--recipe") } : {}),
};
if (!["vi", "en"].includes(manifest.language)) {
  throw new Error(`--language must be vi|en, got "${manifest.language}"`);
}
if (!["editorial", "chronological"].includes(manifest.sequenceMode)) {
  throw new Error(`--sequence-mode must be editorial|chronological, got "${manifest.sequenceMode}"`);
}
if (!["template", "lite", "premium"].includes(manifest.tier)) {
  throw new Error(`--tier must be template|lite|premium, got "${manifest.tier}"`);
}
if (!["auto", "highlight", "full_song"].includes(manifest.musicMode)) {
  throw new Error(`--music-mode must be auto|highlight|full_song, got "${manifest.musicMode}"`);
}
// A template project must know its recipe before it renders — but it may be chosen
// later by `runProject --auto-recipe` rather than pinned here.
if (manifest.tier === "template" && !manifest.recipe) {
  console.log(`  note: no --recipe pinned; run with --auto-recipe, or add "recipe" to project.json.`);
}
fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Created ${path.relative(root, dir)} (${music.length} music track(s)).`);
