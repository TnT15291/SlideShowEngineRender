import fs from "node:fs";
import path from "node:path";
import { arg, root, slug } from "./lib/project.mjs";

const name = arg("--name", arg("--id", ""));
const id = slug(arg("--id", name));
if (!id) throw new Error("Usage: node scripts/createProject.mjs --id <id> [--name <title>] [--prompt <text>] [--input <dir>] [--music <file>]");

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
};
if (!["lite", "premium"].includes(manifest.tier)) throw new Error(`--tier must be lite|premium, got "${manifest.tier}"`);
fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(manifest, null, 2) + "\n");
console.log(`Created ${path.relative(root, dir)} (${music.length} music track(s)).`);
