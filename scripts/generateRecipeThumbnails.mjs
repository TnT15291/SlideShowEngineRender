// Render one representative, engine-native frame for each recipe card.
//
// The source photographs come from the repository's White Weddings reference media,
// never from a customer project. Each thumbnail is still a real recipe render: the
// normal direction chooser, shot-list solver, layout builder, overlays and FFmpeg path
// all run before the midpoint frame is extracted.
//
// Usage:
//   node scripts/generateRecipeThumbnails.mjs
//   node scripts/generateRecipeThumbnails.mjs --recipes warm-film-01,modern-teal-01
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = process.cwd();
const node = process.execPath;
const arg = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

function run(command, args, label) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  if (result.status !== 0) throw new Error(`${label} failed:\n${result.stderr || result.stdout}`);
}

function imageCount(slide) {
  return (slide.layers || []).filter((layer) => layer.type === "image").length;
}

function textCount(slide) {
  return (slide.layers || []).filter((layer) => layer.type === "text").length;
}

export function selectRepresentativeSlide(timeline, preferredId = "") {
  const preferred = preferredId
    ? (timeline.slides || []).find((slide) => slide.id === preferredId && imageCount(slide) > 0)
    : null;
  if (preferred) return preferred;
  const candidates = (timeline.slides || []).filter((slide) =>
    slide.effect === "layer_scene"
    && imageCount(slide) > 0
    && !/_r\d|_\d+$/.test(slide.id)
    && !/^s8[0-5]_/.test(slide.id)
    && slide.editorialBeat !== "closing");
  if (!candidates.length) return (timeline.slides || []).find((slide) => imageCount(slide) > 0) || null;

  return candidates.reduce((best, slide) => {
    const score = Math.min(4, imageCount(slide)) * 3
      + Math.min(2, textCount(slide)) * 2
      + (slide.signature ? 1 : 0);
    return !best || score > best.score ? { slide, score } : best;
  }, null).slide;
}

function probeSize(file, ffprobe) {
  const result = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", file], { encoding: "utf8" });
  const [width, height] = (result.stdout || "").trim().split("x").map(Number);
  if (result.status !== 0 || !width || !height) throw new Error(`Cannot read demo image dimensions: ${file}`);
  return { width, height };
}

function makePhotoFixture(workDir, ffprobe) {
  const sourceDir = path.join(root, "assets", "white-weddings-theme", "media");
  const sources = fs.readdirSync(sourceDir)
    .filter((file) => /\.(?:jpe?g|png|webp)$/i.test(file))
    .sort()
    .map((file) => path.join(sourceDir, file));
  if (!sources.length) throw new Error(`No reference photographs found in ${sourceDir}`);

  const fixtureDir = path.join(workDir, "photos");
  fs.mkdirSync(fixtureDir, { recursive: true });
  const dimensions = new Map(sources.map((file) => [file, probeSize(file, ffprobe)]));
  const photos = Array.from({ length: 130 }, (_, index) => {
    const source = sources[index % sources.length];
    const extension = path.extname(source).toLowerCase();
    const target = path.join(fixtureDir, `${String(index + 1).padStart(3, "0")}${extension}`);
    fs.linkSync(source, target);
    const { width, height } = dimensions.get(source);
    return {
      file: target,
      w: width,
      h: height,
      orient: width >= height ? "landscape" : "portrait",
      qualityNorm: +(0.95 - index / 2000).toFixed(3),
      sharpness: 30,
      meanLuma: 128,
      focusX: 0.5,
      focusY: 0.45,
    };
  });
  const output = path.join(workDir, "photos.json");
  fs.writeFileSync(output, JSON.stringify({ photos }, null, 2) + "\n");
  return output;
}

export function main() {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_, extension) => `ffprobe${extension || ""}`);
  const outDir = path.resolve(root, arg("--out", "apps/web/public/recipe-previews"));
  const selected = new Set(arg("--recipes").split(",").map((value) => value.trim()).filter(Boolean));
  const templateDir = path.join(root, "story-templates");
  const recipes = fs.readdirSync(templateDir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({ file: path.join(templateDir, file), id: path.basename(file, ".json") }))
    .filter((recipe) => !selected.size || selected.has(recipe.id))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (!recipes.length) throw new Error("No matching recipes");

  fs.mkdirSync(path.join(root, "temp"), { recursive: true });
  const workDir = fs.mkdtempSync(path.join(root, "temp", "recipe-thumbnails-"));
  fs.mkdirSync(outDir, { recursive: true });
  try {
    const photos = makePhotoFixture(workDir, ffprobe);
    const prompt = path.join(workDir, "prompt.txt");
    fs.writeFileSync(prompt, "Ấm áp, thanh lịch, ưu tiên gương mặt và cảm xúc tự nhiên.\n");
    const music = path.join(root, "music", "Perfect.mp3");
    const musicAnalysis = path.join(root, "analysis", "music", "Perfect.json");
    for (const recipe of recipes) {
      const recipeDocument = JSON.parse(fs.readFileSync(recipe.file, "utf8"));
      const recipeDir = path.join(workDir, recipe.id);
      fs.mkdirSync(recipeDir, { recursive: true });
      const direction = path.join(recipeDir, "direction.json");
      const timelinePath = path.join(recipeDir, "full.json");
      const video = path.join(recipeDir, "frame.mp4");
      run(node, ["scripts/chooseTier1Direction.mjs", "--recipe", recipe.file, "--prompt", prompt,
        "--photos", photos, "--music", musicAnalysis, "--pacing", "balanced", "--out", direction], `direction ${recipe.id}`);
      run(node, ["scripts/applyStoryTemplate.mjs", "--template", recipe.file, "--photos", photos,
        "--music", music, "--analysis-dir", "analysis", "--direction", direction, "--out", timelinePath,
        "--output", video, "--name", `${recipe.id} thumbnail`, "--quality", "draft", "--prompt", prompt,
        "--accept-misfit"], `timeline ${recipe.id}`);

      const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
      const representative = selectRepresentativeSlide(timeline, recipeDocument.thumbnailScene);
      if (!representative) throw new Error(`${recipe.id} produced no image slide`);
      timeline.slides = [{ ...representative, duration: 3, transition: { type: "none", duration: 0 } }];
      timeline.music = [];
      timeline.audio = { fade_in: 0, fade_out: 0, crossfade: 0 };
      timeline.output = { path: video };
      const frameTimeline = path.join(recipeDir, "frame.json");
      fs.writeFileSync(frameTimeline, JSON.stringify(timeline, null, 2) + "\n");
      run(node, ["--import", "tsx", "src/index.ts", "--timeline", frameTimeline], `render ${recipe.id}`);
      run(ffmpeg, ["-y", "-v", "error", "-ss", "1.5", "-i", video, "-frames:v", "1",
        "-vf", "scale=960:-2", "-q:v", "3", path.join(outDir, `${recipe.id}.jpg`)], `extract ${recipe.id}`);
      console.log(`[recipe-thumbnail] ${recipe.id}: ${representative.id}`);
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  console.log(`[recipe-thumbnail] ${recipes.length} image(s) -> ${path.relative(root, outDir)}`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try { main(); } catch (error) {
    console.error(`[recipe-thumbnail] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
