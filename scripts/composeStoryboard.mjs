// Premium node 8 — compose the shot list, as a recipe.
//
// This replaces the hardcoded heart of generateStoryClipV2: 16 fixed scenes and 12
// fixed lines of text, written for one wedding in Quảng Trị and then handed to
// every customer who came after. Nothing about that shot list was a function of
// the job. It asked for 42 photo slots whether you brought 23 photos or 200, and
// it ran 113 seconds whether your song was 90 or 300.
//
// What comes out here is an ordinary RECIPE — the same JSON applyStoryTemplate
// already renders for the template tier. So premium stops maintaining a private,
// hardcoded twin of the recipe engine and simply uses it, with the AI upgraded
// from "may pick the colour grade" to "writes the film".
//
//   CODE decides   how many scenes, which layouts, how many photos each,
//                  how long each runs (music energy x photo budget)
//   AI decides     what every scene SAYS   (scripts/writeRecipeCopy.mjs --copy)
//                  and how it looks        (director_notes: effects, grade, overlay)
//
// Usage:
//   node scripts/composeStoryboard.mjs --photos <photos.json> --music <music.mp3>
//     [--analysis-dir analysis] [--plan analysis/story_plan.json]
//     [--director analysis/director_notes.json] [--theme <id>] [--max-reuse 1]
//     [--out analysis/storyboard.json]
import fs from "node:fs";
import path from "node:path";
import { makeEnergy } from "./lib/pacing.mjs";
import { composeStoryboard } from "./lib/storyboard.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const die = (msg) => {
  console.error(`[composeStoryboard] FAILED: ${msg}`);
  process.exit(1);
};

const photosPath = arg("--photos", "analysis/photos.json");
const musicPath = arg("--music", "");
const analysisDir = arg("--analysis-dir", "analysis").replace(/\\/g, "/").replace(/\/$/, "");
const libraryPath = arg("--library", "layouts/library.json");
const planPath = arg("--plan", `${analysisDir}/story_plan.json`);
const directorPath = arg("--director", `${analysisDir}/director_notes.json`);
const outPath = arg("--out", `${analysisDir}/storyboard.json`);
const maxReuse = Number(arg("--max-reuse", "1"));
const strict = process.argv.includes("--strict");

if (!musicPath) die("--music is required (the shot list is solved against the track's length)");
if (!Number.isFinite(maxReuse) || maxReuse < 1) die(`--max-reuse must be >= 1, got "${maxReuse}"`);

const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const exists = (p) => p && fs.existsSync(path.resolve(root, p));

const library = readJson(libraryPath);
const photos = readJson(photosPath).photos ?? [];
if (!photos.length) die(`${photosPath} has no photos`);

const musicName = path.basename(musicPath).replace(/\.[^.]+$/, "");
const musicJson = `${analysisDir}/music/${musicName}.json`;
if (!exists(musicJson)) die(`music analysis not found: ${musicJson} — run analyzeMusic first`);
const music = readJson(musicJson);

const plan = exists(planPath) ? readJson(planPath) : null;
const director = exists(directorPath) ? readJson(directorPath) : null;
const notes = director?.director_notes ?? {};

const acts = (plan?.segments ?? []).map((s) => s.segment);
const theme = arg("--theme", notes.libraryTheme || "white_weddings");

const { scenes, fit } = composeStoryboard({
  photoCount: photos.length,
  musicDuration: music.duration,
  energy: makeEnergy(music),
  library,
  acts,
  maxReuse,
  montageEffect: notes.montageEffect || "film_roll_up",
});

// --- emit a recipe -----------------------------------------------------------
// Text slots are DECLARED (from the layout the code chose) but left empty. That is
// the contract writeRecipeCopy fills: it may only write into slots that already
// exist. Empty is also the honest fallback — a wordless film beats a film wearing
// someone else's words.
const layoutById = new Map((library.layouts || []).map((l) => [l.id, l]));
function textSlotsFor(scene) {
  const layout = layoutById.get(scene.layout);
  const out = {};
  for (const slot of layout?.textSlots ?? []) out[slot.id] = "";
  // The closing card is the one place with a sane default: tokens the brief fills,
  // never a name borrowed from another couple. Groom first, as Vietnamese wedding
  // films conventionally read.
  if (scene.id === "s99_closing") {
    if ("names" in out) out.names = "{{groom}} & {{bride}}";
    if ("date" in out) out.date = "{{date}}";
  }
  return out;
}

const recipe = {
  id: arg("--name", "storyboard"),
  version: 1,
  name: "Composed storyboard",
  libraryTheme: theme,
  generatedBy: "code:composeStoryboard",
  generatedAt: new Date().toISOString(),
  fit,
  source: { origin: "composed", notes: `Solved against ${photos.length} photos and a ${music.duration.toFixed(0)}s track.` },
  defaults: {
    project: { width: 1920, height: 1080, fps: 30, quality: arg("--quality", "share") },
    audio: { fade_in: 1.5, fade_out: 3.5, crossfade: 0 },
    color: {
      temperature: 5600, saturation: 1.05, contrast: 1.03, glow: 0.12,
      ...(notes.colorCurves ? { curves: notes.colorCurves } : {}),
    },
    ...(overlayFor(notes.overlayVariant) ?? {}),
  },
  timelineRules: {
    // Kept for schema-compatibility with hand-written recipes; every scene below
    // carries an explicit durationSec, so this table is never consulted.
    durationStrategy: { baseSceneSec: 5.5, calmSceneSec: 7, buildSceneSec: 4.5, montageSec: 12, closingSec: 8 },
    transitionStrategy: {
      default: { type: notes.defaultTransition || "crossfade", duration: 0.8 },
      final: { type: notes.endingTransition || "fade_slow", duration: 1.2 },
    },
    photoSelection: { darkPhotoMaxMeanLuma: 75 },
  },
  scenes: scenes.map((s) => ({
    id: s.id,
    effect: s.effect,
    ...(s.layout ? { layout: s.layout } : {}),
    ...(s.act ? { act: s.act } : {}),
    durationSec: s.duration,
    ...(s.photos > 0 && !s.layout ? { photoSlots: [{ slot: "film_roll", count: s.photos }] } : {}),
    text: textSlotsFor(s),
  })),
};

function overlayFor(variant) {
  if (!variant) return null;
  const asset = path.resolve(root, `overlays/light_leak_${variant}.mp4`);
  if (!fs.existsSync(asset)) {
    console.warn(`[composeStoryboard] overlay '${variant}' skipped — overlays/light_leak_${variant}.mp4 missing`);
    return null;
  }
  return { overlays: [{ variant, blend: "screen", opacity: 0.45 }] };
}

fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(recipe, null, 2) + "\n");

const film = scenes.reduce((n, s) => n + s.duration, 0) - scenes.slice(0, -1).reduce((n, s) => n + (s.xfade || 0), 0);
console.log(
  `[composeStoryboard] ${scenes.length} scenes, ${fit.photosUsed}/${fit.photoCount} photos (max ${maxReuse}x each), ` +
    `${film.toFixed(0)}s of a ${music.duration.toFixed(0)}s track -> ${outPath}\n` +
    `  budget ${fit.budgetSecondsPerPhoto}s/photo, bound by ${fit.boundBy}, ${fit.message}`
);

// A film that leaves a third of the song playing over nothing, or shows one photo
// eight times, is not a warning — it is a broken deliverable. Let a caller opt in
// to treating it as one.
if (strict && fit.verdict !== "ok") {
  console.error(`[composeStoryboard] --strict: ${fit.verdict}`);
  process.exit(1);
}
