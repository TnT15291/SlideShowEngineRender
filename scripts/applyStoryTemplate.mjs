// Apply a reusable story template to the current analyzed photos/music and emit
// a render-engine timeline. This is the Smart Lite path: template-driven story,
// no hardcoded narrative.
//
// Geometry is NOT computed here. Every layer_scene scene names a layout in
// layouts/library.json; this script only resolves photoSlots -> image paths,
// fills {{tokens}} into the layout's text slots, picks durations from music
// energy, then emits valid timeline JSON. Adding a new template = writing a new
// JSON recipe (which layouts, in what order, with what copy) -- no code change.
//
// Usage:
//   node scripts/applyStoryTemplate.mjs --music "music/a thousand years.mp3"
//     [--template story-templates/warm-film-01.json]
//     [--photos analysis/photos.json]
//     [--library layouts/library.json]
//     [--brief jobs/demo/brief.json]
//     [--out timeline/<template-id>.json]
import fs from "node:fs";
import path from "node:path";
import { assignPhotos } from "./lib/photoAssignment.mjs";
import { applyStoryArc, editorialRole, snapScenesToPhrases } from "./lib/tier1Editorial.mjs";
import { createTransitionGrammar } from "./lib/transitionGrammar.mjs";
import { buildDiversityReport } from "./lib/diversityPlanner.mjs";
import { createMotionPlanner } from "./lib/motionPlanner.mjs";
import { averageAdjustments, buildColorNormalization } from "./lib/colorNormalizer.mjs";
import { loadLedger, active, applyToStoryboard, applyToTimeline } from "./lib/directives.mjs";
import { fitScale, describeFit } from "./lib/pacing.mjs";
import { solveRecipeShotList } from "./lib/recipeShotList.mjs";
import { resolveMusicWindow, sliceMusicAnalysis } from "./lib/musicHighlight.mjs";
import { validateMusicAnalysis } from "./lib/musicAnalysis.mjs";
import {
  SINGLE_PHOTO_EFFECTS, MONTAGE_EFFECTS, MONTAGE_MAX, EASING_EFFECTS,
} from "./lib/engineCapabilities.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const templatePath = arg("--template", "story-templates/warm-film-01.json");
const photosPath = arg("--photos", "analysis/photos.json");
// No default track. A hardcoded one meant that a caller passing --music "" (a
// project with no music configured) silently scored ANOTHER customer's song and
// read the root analysis for it — the wrong film, delivered without a warning.
const musicPath = arg("--music", "");
if (!musicPath) {
  console.error(`[applyStoryTemplate] FAILED: --music is required (this recipe times its scenes to the track).`);
  process.exit(1);
}
const libraryPath = arg("--library", "layouts/library.json");
const briefPath = arg("--brief", "");
const promptPath = arg("--prompt", "");
const directivesPath = arg("--directives", "");
const directionPath = arg("--direction", "");
const musicModeArg = arg("--music-mode", "");
// How far the finished film may drift from the track before we refuse to write it.
// 10%: the phrase snap and the closing card own the last few seconds, and nobody hears
// a 10s difference on a 200s song. A THIRD of the song missing is a different thing.
const MISFIT_TOLERANCE = 0.1;
const acceptMisfit = process.argv.includes("--accept-misfit");
// A project run redirects these so two customers on the same recipe never share a
// music analysis, an output file or a project name. Defaults are the old root paths.
const analysisDir = arg("--analysis-dir", "analysis").replace(/\\/g, "/").replace(/\/$/, "");

const template = JSON.parse(fs.readFileSync(path.resolve(root, templatePath), "utf8"));
const library = JSON.parse(fs.readFileSync(path.resolve(root, libraryPath), "utf8"));
const photosDoc = JSON.parse(fs.readFileSync(path.resolve(root, photosPath), "utf8"));
const musicName = path.basename(musicPath).replace(/\.[^.]+$/, "");
const sourceMusic = JSON.parse(fs.readFileSync(path.resolve(root, `${analysisDir}/music/${musicName}.json`), "utf8"));
const musicContract = validateMusicAnalysis(sourceMusic);
if (!musicContract.ok) {
  throw new Error(`music analysis is stale or incomplete (${musicContract.missing.join(", ")}). ` +
    `Re-run: node scripts/analyzeMusic.mjs "${musicPath}" --out "${analysisDir}/music/${musicName}.json"`);
}
const videoOut = arg("--output", `output/${template.id}.mp4`);
const projectName = arg("--name", template.id);
const qualityOverride = arg("--quality", "");
const brief = briefPath && fs.existsSync(path.resolve(root, briefPath))
  ? JSON.parse(fs.readFileSync(path.resolve(root, briefPath), "utf8"))
  : {};
const customerPrompt = promptPath && fs.existsSync(path.resolve(root, promptPath))
  ? fs.readFileSync(path.resolve(root, promptPath), "utf8").trim().toLowerCase()
  : "";
const direction = directionPath && fs.existsSync(path.resolve(root, directionPath))
  ? JSON.parse(fs.readFileSync(path.resolve(root, directionPath), "utf8")) : null;
if (direction && direction.recipeId !== template.id) throw new Error(`${directionPath} belongs to recipe ${direction.recipeId}, not ${template.id}`);

// --- the customer's orders, applied to the recipe before anything reads it -----
// Both tiers land here — a hand-written recipe and a composed storyboard are the
// same shape — so this is the single place where an instruction becomes a scene.
// It runs BEFORE expandScenes() because retargeting a scene changes how many photos
// it demands, and the photo budget is solved downstream of that number.
const ledger = directivesPath ? loadLedger(directivesPath) : { directives: [] };
const orders = active(ledger);
const appliedIds = new Set();
if (orders.length) {
  // scenePhotoCount is hoisted and knows what each LAYOUT consumes — which is the only
  // way a montage can absorb its neighbours without over-drawing the photo budget the
  // storyboard was solved against. Without it the directive layer would be guessing.
  for (const id of applyToStoryboard(template, orders, {
    availablePhotos: photosDoc.photos?.length ?? 0,
    photoDemand: scenePhotoCount,
  })) appliedIds.add(id);
}
// Optional AI-written copy (scripts/writeRecipeCopy.mjs). Absent → the recipe's
// own words, byte for byte, so the template tier stays a zero-AI tier.
const copyPath = arg("--copy", "");
const copyMap = copyPath && fs.existsSync(path.resolve(root, copyPath))
  ? JSON.parse(fs.readFileSync(path.resolve(root, copyPath), "utf8")).scenes ?? {}
  : {};

const outPath = arg("--out", `timeline/${template.id}.json`);

const tokens = {
  bride: brief.bride || "Bride",
  groom: brief.groom || "Groom",
  date: brief.date || "Our Wedding Day",
  location: brief.location || "Together",
  meetingPlace: brief.meetingPlace || "",
  yearsTogether: brief.yearsTogether || "",
  thankYouLine: brief.thankYouLine || "Thank you for being part of our story",
};

function fill(text = "") {
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, key) => tokens[key] || "");
}

const excluded = new Set(brief.excludePhotos || []);
const contentFile = path.resolve(root, `${analysisDir}/photo_content.json`);
const contentDoc = fs.existsSync(contentFile) ? JSON.parse(fs.readFileSync(contentFile, "utf8")) : { photos: [] };
const contentByFile = new Map((contentDoc.photos || []).map((p) => [p.file, p]));
const photos = (photosDoc.photos || []).filter((p) => !excluded.has(p.file))
  .map((p) => ({ ...p, ...contentByFile.get(p.file), file: p.file }));
if (photos.length === 0) throw new Error(`${photosPath} has no photos`);
const requestedMusicMode = orders.find((d) => d.kind === "music_mode" && d.op === "set")?.target
  || musicModeArg || brief.musicMode || "auto";
const musicModeOrder = orders.find((d) => d.kind === "music_mode" && d.op === "set");
if (requestedMusicMode === "full_song" && sourceMusic.duration / photos.length >= 7.2 && !acceptMisfit) {
  throw new Error(
    `full-song was requested, but ${photos.length} photos cannot carry the ${sourceMusic.duration}s track naturally. ` +
    `Add at least ${Math.ceil(sourceMusic.duration / 7.2) - photos.length} photo(s), choose highlight/auto, or pass --accept-misfit.`
  );
}
// The same window composeStoryboard solved its shot list against — same function, same
// inputs. When these two disagreed, premium built a 219s film for a 93s excerpt.
const musicEdit = resolveMusicWindow({
  music: sourceMusic,
  photoCount: photos.length,
  orders,
  brief,
  musicMode: musicModeArg,
});
if (musicModeOrder) appliedIds.add(musicModeOrder.id);
const music = sliceMusicAnalysis(sourceMusic, musicEdit);
if (musicEdit.mode === "highlight") {
  console.log(`[applyStoryTemplate] highlight: ${musicEdit.start}s–${musicEdit.end}s (${musicEdit.duration}s) ` +
    `because ${photos.length} photos cannot carry the ${musicEdit.sourceDuration}s full song naturally`);
}
const availableFiles = new Set(photos.map((p) => p.file));
for (const file of [...(brief.mustUsePhotos || []), brief.openingPhoto, brief.endingPhoto].filter(Boolean)) {
  if (!availableFiles.has(file)) throw new Error(`brief requires unavailable/excluded photo: ${file}`);
}

const byFile = new Map(photos.map((p) => [p.file, p]));
const used = new Set();
const byQuality = [...photos].sort((a, b) =>
  (b.heroScore ?? b.qualityNorm ?? 0) - (a.heroScore ?? a.qualityNorm ?? 0) ||
  (b.qualityNorm ?? 0) - (a.qualityNorm ?? 0) ||
  (b.sharpness ?? 0) - (a.sharpness ?? 0)
);
const heroPhoto = byFile.get(brief.openingPhoto) || byQuality[0];
const endingPhoto = byFile.get(brief.endingPhoto) || heroPhoto;
let lastPhoto = null;
let seq = 0;
let globalAssignments = new Map();
const motionPlanner = createMotionPlanner();
const colorReport = buildColorNormalization(photos);
const colorByFile = new Map(colorReport.decisions.map((d) => [d.file, d]));

function scorePhoto(p, slot) {
  let score = (p.qualityNorm ?? 0) * 10 + (p.sharpness ?? 0) * 0.02;
  if (slot.orient && slot.orient !== "any" && p.orient === slot.orient) score += 5;
  if ((p.meanLuma ?? 128) < (template.timelineRules?.photoSelection?.darkPhotoMaxMeanLuma ?? 75)) score -= 5;
  // Adjacent files are commonly burst shots. Keep them apart even when no
  // perceptual hash is available in the technical photo manifest.
  if (lastPhoto) {
    const number = (f) => Number(path.basename(f).match(/\d+/)?.[0]);
    const a = number(lastPhoto.file), b = number(p.file);
    if (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= 1) score -= 8;
    if (p.duplicateGroup && p.duplicateGroup === lastPhoto.duplicateGroup) score -= 20;
  }
  return score;
}

function take(slot = {}, count = 1) {
  const picked = [];
  for (let i = 0; i < count; i++) {
    const candidates = byQuality
      .filter((p) => !used.has(p.file))
      .filter((p) => !slot.orient || slot.orient === "any" || p.orient === slot.orient)
      .sort((a, b) => scorePhoto(b, slot) - scorePhoto(a, slot));
    const fallback = byQuality.find((p) => !used.has(p.file)) || photos[seq++ % photos.length];
    const chosen = candidates[0] || fallback;
    used.add(chosen.file);
    lastPhoto = chosen;
    picked.push(chosen.file);
  }
  return count === 1 ? picked[0] : picked;
}

function photo(slotName, scene, fallback = {}) {
  const slot = (scene.photoSlots || []).find((s) => s.slot === slotName) || fallback;
  return globalAssignments.get(`${scene.id}:${slotName}`)?.[0] || take(slot, 1);
}

function photosFor(slotName, scene, defaultCount) {
  const slot = (scene.photoSlots || []).find((s) => s.slot === slotName) || { count: defaultCount };
  const baseCount = slot.count || defaultCount;
  const count = Math.min(MONTAGE_MAX[scene.effect] ?? Infinity, Math.max(1, Math.round(baseCount * (direction?.pacing?.controls?.montagePhotoMultiplier ?? 1))));
  return globalAssignments.get(`${scene.id}:${slotName}`) || take(slot, count);
}

function pic(file, x, y, width, height, extra = {}, scene = null, intent = {}) {
  const p = byFile.get(file) || {};
  const plan = scene ? motionPlanner.plan(p, scene, intent) : null;
  return {
    type: "image",
    path: file,
    x, y, width, height,
    fit: "cover",
    focusX: p.focusX ?? 0.5,
    focusY: p.focusY ?? 0.45,
    technicalColor: colorByFile.get(file),
    ...(plan?.motion && plan.motion !== "none" ? { motion: plan.motion, motionStrength: plan.strength, easing: plan.easing } : {}),
    ...extra,
  };
}

const rect = (x, y, width, height, color, opacity, extra = {}) =>
  ({ type: "rect", x, y, width, height, color, opacity, ...extra });
const txt = (text, font, x, y, width, height, size, color, align = "center", extra = {}) =>
  ({ type: "text", text, font, x, y, width, height, size, color, align, wrap: true, ...extra });
const cap = (text, role = "caption") => ({
  text,
  role,
  position: "bottom_center",
  start: 0.6,
  duration: 3.8,
  color: "white",
  shadow: true,
  animation: "fade",
});

function energyAt(t) {
  const env = music.envelope || [];
  return env.length ? env[Math.min(env.length - 1, Math.round(t / 0.5))] ?? 0.5 : 0.5;
}

function durationFor(role, t) {
  const d = template.timelineRules.durationStrategy;
  const mult = direction?.pacing?.controls?.durationMultiplier ?? selectedPacing.durationMultiplier ?? 1;
  const e = energyAt(t);
  if (role === "calm") return +(d.calmSceneSec * mult).toFixed(2);
  if (role === "build") return +(Math.max(d.buildSceneSec, d.baseSceneSec - e) * mult).toFixed(2);
  if (role === "montage") return +(d.montageSec * mult).toFixed(2);
  if (role === "closing") return +(d.closingSec * mult).toFixed(2);
  return +(d.baseSceneSec * mult).toFixed(2);
}

const transitionGrammar = createTransitionGrammar(template.timelineRules.transitionStrategy, template.transitionGrammar);
function transitionFor(role, isLast) {
  const selected = transitionGrammar.select(role, isLast);
  return { ...selected, duration: +Math.min(2, selected.duration * (direction?.pacing?.controls?.transitionMultiplier ?? 1)).toFixed(2) };
}

function scenePhotoCount(scene) {
  if (scene.effect === "video_background") return 0;
  if (scene.effect === "layer_scene") {
    const layout = (library.layouts || []).find((l) => l.id === scene.layout);
    return layout?.photoSlots?.length || 0;
  }
  const multiplier = direction?.pacing?.controls?.montagePhotoMultiplier ?? 1;
  return (scene.photoSlots || []).reduce((sum, slot) => sum + Math.max(1, Math.round((slot.count || 1) * multiplier)), 0);
}

// expandScenes() used to live here: it repeated the scenes an author had marked
// `repeatable` until the photos ran out or a cap was hit, and never once looked at how
// long the song was. Three of the four recipes marked NO scene repeatable, so it returned
// their fixed nine scenes unchanged and the film came out 41–65 seconds long no matter
// what the customer sent. lib/recipeShotList.mjs replaces it: the count is now solved
// against the photo budget, which is what it always should have been.

// ---------- library-driven layer_scene builder ----------
// The story-template scene names a layout id; the layout owns all pixel
// geometry. The scene only refines photo selection per slot (orient/quality/
// motion/frame) and supplies copy keyed by the layout's text-slot ids.

const pacingOptions = template.pacingVariants || [
  { id: "gentle", maxEnergy: 0.38, durationMultiplier: 1.12 },
  { id: "balanced", maxEnergy: 0.66, durationMultiplier: 1 },
  { id: "lively", maxEnergy: 1, durationMultiplier: 0.86 },
];
const meanEnergy = (music.envelope || []).length
  ? music.envelope.reduce((a, b) => a + b, 0) / music.envelope.length
  : 0.5;
const pacingVariant = pacingOptions.find((v) => meanEnergy <= (v.maxEnergy ?? 1)) || pacingOptions.at(-1);
const selectedPacing = direction
  ? pacingOptions.find((v) => v.id === direction.pacing?.variantId) || pacingVariant
  : pacingVariant;

const styleRules = [
  { match: /editorial|tạp chí|thời trang|fashion/, theme: "editorial_bold" },
  { match: /hiện đại|modern|minimal|tối giản|teal/, theme: "modern_teal" },
  { match: /điện ảnh|cinematic|moody|trầm|dark/, theme: "dark_film" },
  { match: /hoài niệm|vintage|film|ấm|warm|mộc/, theme: "warm_film" },
];
const requestedTheme = styleRules.find((r) => r.match.test(customerPrompt))?.theme;
const themeRef = direction?.style?.themeId || (requestedTheme && library.designTokens?.themes?.[requestedTheme]
  ? requestedTheme
  : (template.libraryTheme || "white_weddings"));
const libTheme = () => (library.designTokens?.themes || {})[themeRef] || {};

function resolveColor(spec) {
  if (typeof spec !== "string") return "#000000";
  if (spec.startsWith("theme.")) {
    const th = libTheme();
    return th.palette?.[spec.slice(6)] || th.background || "#000000";
  }
  return spec;
}

function resolveFont(role) {
  const th = libTheme();
  return th.fonts?.[role]
    || template.defaults?.fonts?.[role]
    || template.defaults?.fonts?.body
    || "fonts/BeVietnamPro-Regular.ttf";
}

function resolveFrame(name) {
  if (!name) return undefined;
  if (typeof name === "object") return name;
  return template.layoutPresets?.[name] || library.designTokens?.framePreset?.[name] || undefined;
}

function hexLuma(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 255; // named colors: assume light
  const v = parseInt(m[1], 16);
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
}

function themeInk() {
  const pal = libTheme().palette || {};
  return pal.text || pal.warm_brown || pal.ink_dark || template.defaults?.palette?.brown || "#2D2D33";
}

// Over a full-bleed photo, text is white unless a LIGHT panel backs it; over a
// dark scrim panel it stays white. On solid theme backgrounds use theme ink.
function defaultTextColor(slot, layout) {
  if (layout.background?.type !== "photo_full_bleed") return themeInk();
  const cx = slot.x + slot.width / 2;
  const cy = slot.y + slot.height / 2;
  const backing = (layout.panels || []).find(
    (p) => cx >= p.x && cx <= p.x + p.width && cy >= p.y && cy <= p.y + p.height
  );
  if (!backing || hexLuma(resolveColor(backing.color)) < 140) return "#FFFFFF";
  return themeInk();
}

const stagger = () => library.designTokens?.motionPresets?.staggerSeconds || {};
function photoStart(idx) {
  const s = stagger();
  return +(((s.photoBase ?? 0.15) + idx * (s.photoStep ?? 0.1))).toFixed(2);
}
function textStart(role) {
  const s = stagger();
  return ["heading", "eyebrow", "display", "names"].includes(role) ? (s.heading ?? 0.2) : (s.body ?? 0.5);
}

/** The slot that carries a layer_scene's PRINCIPAL photo.
 *
 * The opening scene's principal photo is the reserved hero, and it is withheld from the
 * general pool so no other scene can take it. That only worked when the opening layout
 * had a full-bleed photo background: with a cream-background layout (which the composer
 * picks freely) the principal photo is an ordinary `hero` slot, so the opening ASKED the
 * pool for a photo while the hero sat reserved and unclaimed — one request more than the
 * pool could serve, and the build died with "could not fill" on an unrelated scene.
 *
 * Naming the principal slot ONCE, and using the same answer where photos are requested
 * and where they are handed out, is what keeps those two from disagreeing. */
function principalSlotId(layout) {
  return layout?.background?.type === "photo_full_bleed"
    ? layout.background.slot
    : layout?.photoSlots?.[0]?.id ?? null;
}

function buildLayerSceneFromLayout(scene) {
  const layout = (library.layouts || []).find((l) => l.id === scene.layout);
  if (!layout) throw new Error(`Scene ${scene.id}: unknown layout '${scene.layout}' (not in ${libraryPath})`);
  const canvas = library.meta?.canvas || { width: 1920, height: 1080 };
  const isClosing = scene.durationRole === "closing";
  const bg = isClosing ? { type: "photo_full_bleed", slot: "__bookend" } : (layout.background || { type: "cream" });
  const bgSlotId = bg.type === "photo_full_bleed" ? bg.slot : null;
  const defOf = (id) => (scene.photoSlots || []).find((s) => s.slot === id) || {};
  const layers = [];

  // 1) background: full-bleed photo or a solid theme fill.
  if (bg.type === "photo_full_bleed") {
    const slot = (layout.photoSlots || []).find((s) => s.id === bgSlotId)
      || { x: 0, y: 0, width: canvas.width, height: canvas.height };
    const def = defOf(bgSlotId);
    const file = isClosing ? endingPhoto.file : (scene === expandedScenes?.[0] ? heroPhoto.file
      : globalAssignments.get(`${scene.id}:${bgSlotId}`)?.[0] || take({ orient: def.orient }, 1));
    if (!isClosing && file === heroPhoto.file) { used.add(file); lastPhoto = heroPhoto; }
    layers.push(pic(file, slot.x, slot.y, slot.width, slot.height, {
      fit: def.fit || slot.fit || "cover",
      ...(def.motion ? { motion: def.motion } : {}),
    }, scene, { isHero: true, isBackground: true }));
    if (isClosing) layers.push(rect(0, 0, canvas.width, canvas.height, "#000000", 0.42));
  } else {
    const bgColor = bg.type === "cream"
      ? (libTheme().background || "#FBF6ED")
      : resolveColor(bg.color || "#000000");
    layers.push(rect(0, 0, canvas.width, canvas.height, bgColor, 1));
  }

  // 2) panels (scrims / title pills), drawn above the background. Panels with
  //    z:"over_photos" wait until after the photo layers (e.g. a scrim that
  //    must darken foreground photos so text stays legible).
  const allPanels = layout.panels || [];
  for (const p of allPanels.filter((p) => p.z !== "over_photos")) {
    layers.push(rect(p.x, p.y, p.width, p.height, resolveColor(p.color), p.opacity ?? 1));
  }

  // 3) photo slots: the layout drives how many + where; the scene refines
  //    which photo lands in each (orientation, quality, motion, frame).
  let pIdx = 0;
  const isOpening = scene === expandedScenes?.[0];
  for (const slot of layout.photoSlots || []) {
    if (slot.id === bgSlotId) continue;
    const def = defOf(slot.id);
    // The opening's principal photo is the hero — reserved out of the pool precisely so
    // it lands here. Claim it, or the reservation strands a photo the pool needs.
    const file = (isOpening && slot.id === principalSlotId(layout))
      ? heroPhoto.file
      : globalAssignments.get(`${scene.id}:${slot.id}`)?.[0] || take({ orient: def.orient }, 1);
    if (isOpening && file === heroPhoto.file) { used.add(file); lastPhoto = heroPhoto; }
    const frame = resolveFrame(def.frame || slot.frame);
    const anim = def.animation || slot.suggestedAnimation;
    const animated = anim && anim !== "none";
    layers.push(pic(file, slot.x, slot.y, slot.width, slot.height, {
      fit: def.fit || slot.fit || "cover",
      ...(def.motion ? { motion: def.motion } : {}),
      ...(frame ? { frame } : {}),
      ...(slot.rotation != null ? { rotation: slot.rotation } : {}),
      ...(animated ? { animation: anim, start: photoStart(pIdx) } : {}),
    }, scene, { isHero: slot.id === "hero" || def.quality === "best" }));
    pIdx++;
  }

  // 4) panels layered over the photos (text-legibility scrims).
  for (const p of allPanels.filter((p) => p.z === "over_photos")) {
    layers.push(rect(p.x, p.y, p.width, p.height, resolveColor(p.color), p.opacity ?? 1));
  }

  // 5) optional full-frame decor PNG (1920x1080 wedding frame) under the text.
  if (scene.frameOverlay) {
    layers.push({
      type: "image", path: scene.frameOverlay,
      x: 0, y: 0, width: canvas.width, height: canvas.height,
      fit: "stretch",
    });
  }

  // 6) text slots: only render the ones this scene supplies copy for.
  for (const slot of layout.textSlots || []) {
    // An AI-written copy map (node B) may override the recipe's canned line, but
    // ONLY for a slot the layout already has. Keys it does not have are never
    // looked up, so an invented scene or slot cannot conjure a text layer.
    const override = copyMap[scene.id]?.[slot.id];
    const raw = typeof override === "string" && override
      ? override
      : scene.text ? scene.text[slot.id] : undefined;
    const obj = raw && typeof raw === "object" ? raw : null;
    const value = fill(obj ? obj.value : raw);
    if (!value) continue;
    const role = obj?.fontRole || slot.fontRole || "body";
    layers.push(txt(
      value,
      resolveFont(role),
      slot.x, slot.y, slot.width, slot.height,
      obj?.sizePx || slot.sizePx || 40,
      obj?.color || slot.color || (isClosing ? "#FFFFFF" : defaultTextColor(slot, layout)),
      slot.align || "left",
      {
        ...(slot.lineSpacing ? { lineSpacing: slot.lineSpacing } : {}),
        animation: "fade",
        start: textStart(slot.role),
      }
    ));
  }

  return { effect: "layer_scene", captions: [], layers };
}

// Emit a caption only when the scene actually supplies copy — recipes that want
// "photos only" montage beats just omit captionPattern.
const capsFor = (pattern, role = "caption") => {
  const t = fill(pattern);
  return t ? [cap(t, role)] : [];
};

// Which effect takes one photo, which takes many, how many a montage may hold, and which
// accept `easing` — all of it now comes from lib/engineCapabilities.mjs. It used to be
// four hand-maintained tables in this file and two more in recipeShotList, and they did
// not agree: a film_roll held 12 photos according to one and 8 according to another, and
// which you got depended on which code path reached the scene first.

function buildScene(scene) {
  if (scene.effect === "layer_scene") return buildLayerSceneFromLayout(scene);
  if (scene.effect === "memory_wall") {
    return { effect: "memory_wall", images: photosFor("memories", scene, 5), captions: capsFor(scene.captionPattern) };
  }
  if (scene.effect === "collage_grid") {
    return { effect: "collage_grid", images: photosFor("grid", scene, 6), captions: capsFor(scene.captionPattern) };
  }
  if (scene.effect === "film_roll_left" || scene.effect === "film_roll_up" || scene.effect === "film_roll_right") {
    return { effect: scene.effect, images: photosFor("film_roll", scene, 8), captions: capsFor(scene.captionPattern) };
  }
  if (scene.effect === "double_exposure") {
    return { effect: "double_exposure", images: photosFor("pair", scene, 2), captions: capsFor(scene.captionPattern) };
  }
  if (scene.effect === "video_background") {
    if (!scene.background) throw new Error(`Scene ${scene.id}: video_background needs a 'background' video path`);
    return { effect: "video_background", background: scene.background, captions: capsFor(scene.captionPattern) };
  }
  if (scene.effect === "mask_reveal") {
    const isOpening = scene === expandedScenes?.[0];
    if (isOpening) { used.add(heroPhoto.file); lastPhoto = heroPhoto; }
    return {
      effect: "mask_reveal",
      image: isOpening ? heroPhoto.file : photo("hero", scene),
      mask: scene.mask || "assets/masks/particle_gather.mp4",
      captions: capsFor(scene.captionPattern),
    };
  }
  if (SINGLE_PHOTO_EFFECTS.has(scene.effect)) {
    const role = scene.effect === "dark_feather" ? "subtitle" : "caption";
    // The opening claims the reserved hero whatever its effect. The earlier fix taught
    // only the layer_scene opening to do this, so a recipe that opens on dark_feather
    // (cinematic-film-01 does) left the hero reserved and unclaimed — one photo short,
    // and the build died on an unrelated scene. Same bug, second door.
    const image = scene === expandedScenes?.[0] ? heroPhoto.file : photo("hero", scene);
    if (scene === expandedScenes?.[0]) { used.add(image); lastPhoto = heroPhoto; }
    const slide = { effect: scene.effect, image, captions: capsFor(scene.captionPattern, role) };
    if (scene.easing && EASING_EFFECTS.has(scene.effect)) slide.easing = scene.easing;
    return slide;
  }
  throw new Error(`Unsupported template effect ${scene.effect}`);
}

let t = 0;

// THE SHOT LIST IS SOLVED, NOT COUNTED. A recipe used to ship however many scenes its
// author happened to type, which meant a fixed-length film: three of the four recipes
// had no repeatable scene at all and emitted 41–65 seconds regardless of which song the
// customer picked. The scene COUNT was never a matter of taste — it is arithmetic
// against the photo budget, and premium has been doing that arithmetic all along.
// The recipe still owns the look; it no longer owns the count. See lib/recipeShotList.mjs.
// THE BODY'S PHOTO BUDGET, computed once, by the only code that knows the answer.
//
// The bookends do not cost what they look like they cost. The opening's principal frame is
// the RESERVED hero — held out of the pool, so it is free to the body — but a layout like
// hero_title_card ALSO shows three strip photos, and those do come out of the pool. The
// closing shows the hero again as a full-bleed background its layout never declares, so
// scenePhotoCount() reads it as 0 when it is really 1.
//
// Get any of that wrong by one and the shot list over-draws the pool — and the failure
// lands on some montage twenty scenes later, nowhere near the bookend that caused it. So
// the reservation, the requests and the budget are all derived from these same two facts,
// in one place, instead of three places agreeing by luck.
const openingSource = template.scenes[0];
const closingSource = template.scenes.find((s) => s.durationRole === "closing");
const openingTakesHero = Boolean(openingSource)
  && openingSource.effect !== "video_background"
  && !MONTAGE_EFFECTS.has(openingSource.effect);
const closingTakesEnding = Boolean(closingSource);

const reservedPhotos = new Set([
  ...(openingTakesHero ? [heroPhoto.file] : []),
  ...(closingTakesEnding ? [endingPhoto.file] : []),
]);
// What the bookends draw FROM THE POOL: their declared slots, minus the one frame each of
// them takes from the reserved set instead.
const bookendPoolCost =
  Math.max(0, (openingSource ? scenePhotoCount(openingSource) : 0) - (openingTakesHero ? 1 : 0)) +
  Math.max(0, (closingSource ? scenePhotoCount(closingSource) : 0) - (closingTakesEnding ? 1 : 0));

// A COMPOSED STORYBOARD IS ALREADY SOLVED. Re-solving it here threw the whole thing away.
//
// solveRecipeShotList exists for HAND-WRITTEN recipes, whose authors typed a fixed list of
// scenes and never knew how long the customer's song would be. A storyboard from
// composeStoryboard is the opposite: its scene count, its photo counts and its per-scene
// durations were all solved against this job's photo budget and this job's track. Running
// the recipe solver over it re-derived every duration from `durationStrategy` — a flat
// table keyed on `durationRole`, which a composed scene does not carry — so every scene
// fell back to the same 5.5s base and came out, after scaling, within a tenth of a second
// of every other scene in the film. The energy-driven pacing the composer had just
// computed was overwritten before anything could render it.
const composed = template.source?.origin === "composed";
const shotList = composed
  ? { scenes: template.scenes.map((s) => ({ ...s })), fit: template.fit ?? { message: "composed", scale: 1 } }
  : solveRecipeShotList({
      recipe: template,
      photoCount: photos.length,
      musicDuration: Number(music.duration) || 0,
      durationOf: (scene, at) => durationFor(scene.durationRole, at),
      photoDemandOf: scenePhotoCount,
      bodyPhotoBudget: photos.length - reservedPhotos.size - bookendPoolCost,
    });
const expandedScenes = applyStoryArc(shotList.scenes, template.storyArc);
console.log(
  `[applyStoryTemplate] shot list: ${shotList.fit.sceneCount} scenes, ${shotList.fit.photosUsed}/${shotList.fit.photoCount} photos ` +
    `(bound by ${shotList.fit.boundBy}, budget ${shotList.fit.budgetSecondsPerPhoto}s/photo) — ${shotList.fit.message}`
);

function assignmentRequests(scenes) {
  const out = [];
  scenes.forEach((scene, order) => {
    if (scene.durationRole === "closing") return; // intentional bookend hero reuse
    if (scene.effect === "video_background") return;
    if (scene.effect === "layer_scene") {
      const layout = (library.layouts || []).find((l) => l.id === scene.layout);
      for (const slot of layout?.photoSlots || []) {
        const def = (scene.photoSlots || []).find((s) => s.slot === slot.id) || {};
        // The opening's principal slot is the reserved hero — it is not requested from
        // the pool, because it has already been taken out of it.
        if (order === 0 && slot.id === principalSlotId(layout)) continue;
        out.push({ key: `${scene.id}:${slot.id}`, sceneId: scene.id, order, count: 1, orient: def.orient || "any", role: editorialRole(scene, def),
          allowSequence: Boolean(scene.allowSequence), cohesionMode: scene.cohesionMode || "auto",
          hero: def.quality === "best" || Boolean(def.motion) });
      }
      return;
    }
    const slot = (scene.photoSlots || [])[0];
    if (!slot) return;
    const multi = MONTAGE_EFFECTS.has(scene.effect);
    // A single-image opening shows the reserved hero (see buildScene), so it must not also
    // ask the pool for a photo — that is one request more than the pool can serve, and the
    // shortfall surfaces on some unrelated scene much later.
    if (order === 0 && !multi) return;
    const base = slot.count || (scene.effect === "double_exposure" ? 2 : 1);
    const count = multi ? Math.min(MONTAGE_MAX[scene.effect] ?? Infinity, Math.max(1, Math.round(base * (direction?.pacing?.controls?.montagePhotoMultiplier ?? 1)))) : 1;
    out.push({ key: `${scene.id}:${slot.slot}`, sceneId: scene.id, order, count, orient: slot.orient || "any", role: editorialRole(scene, slot),
      allowSequence: Boolean(scene.allowSequence), cohesionMode: scene.cohesionMode || "auto",
      hero: slot.quality === "best" || slot.slot === "hero" });
  });
  return out;
}
const requests = assignmentRequests(expandedScenes);
const mustUse = [...new Set(brief.mustUsePhotos || [])].filter((f) => f !== heroPhoto.file && f !== endingPhoto.file);
const flexibleRequests = requests.filter((r) => !r.hero);
if (mustUse.length > flexibleRequests.length) throw new Error(`brief has ${mustUse.length} must-use photos but only ${flexibleRequests.length} assignable slots`);
mustUse.forEach((file, i) => { flexibleRequests[i].preferred = file; });
// The same reservation the budget was solved against — not a second, independently
// derived one. Two places computing "which photos are held back" is how they drift.
const reserved = [...reservedPhotos];
const assignmentPlan = assignPhotos({ photos, requests, reserved });
if (assignmentPlan.unfilled.length) {
  const demanded = requests.reduce((n, r) => n + r.count, 0);
  throw new Error(
    `Global photo assignment could not fill: ${assignmentPlan.unfilled.map((r) => r.key).join(", ")}\n` +
      `  ${requests.length} requests demand ${demanded} photo(s); the pool has ${photos.length}, of which ${reserved.length} are reserved for bookends ` +
      `— leaving ${photos.length - reserved.length}. The shot list is over-drawn by ${Math.max(0, demanded - (photos.length - reserved.length))}.`
  );
}
globalAssignments = assignmentPlan.assignments;
const diversityReport = buildDiversityReport({ scenes: expandedScenes, assignments: globalAssignments, photos });
const diversityPath = `${analysisDir}/tier1_diversity.json`;
fs.mkdirSync(path.dirname(path.resolve(root, diversityPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, diversityPath), JSON.stringify(diversityReport, null, 2) + "\n");
for (const file of assignmentPlan.used) used.add(file);
let slides = expandedScenes.map((scene, i) => {
  const isLast = i === expandedScenes.length - 1;
  // A composed storyboard (scripts/composeStoryboard.mjs) has already solved the
  // durations against the photo budget and the track's length — a hand-written
  // recipe has not, and keeps the role-based table below.
  const duration = typeof scene.durationSec === "number" ? scene.durationSec : durationFor(scene.durationRole, t);
  const transition = transitionFor(scene.transitionRole, isLast);
  const slide = {
    id: scene.id,
    editorialBeat: scene.arcBeat,
    // The act travels with the slide. Without it the finished timeline cannot answer
    // "did the family_friends act actually get the montage they asked for?" — and a
    // directive nobody can check is a promise nobody has to keep.
    ...(scene.act ? { act: scene.act } : {}),
    duration,
    ...buildScene(scene),
    transition,
  };
  t += Math.max(0, duration - transition.duration);
  return slide;
});
const phraseSnap = snapScenesToPhrases(slides, music);
slides = phraseSnap.slides;
for (const slide of slides) {
  if (slide.effect === "layer_scene") continue;
  const files = [slide.image, ...(slide.images || [])].filter(Boolean);
  slide.technicalColor = averageAdjustments(files.map((f) => colorByFile.get(f)).filter(Boolean));
}
const colorPath = `${analysisDir}/tier1_color.json`;
fs.mkdirSync(path.dirname(path.resolve(root, colorPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, colorPath), JSON.stringify(colorReport, null, 2) + "\n");

// Overlay + colour: a directive is an ORDER and outranks both the art direction and
// the keyword guesses below. Those keyword regexes stay only for callers that pass no
// ledger (a bare recipe run); when a ledger exists it has already read the same words
// with far more care — and, unlike a regex, it reports what it could not honour.
const overlayOrder = orders.find((d) => d.kind === "overlay" && d.op === "set");
const colorOrder = orders.find((d) => d.kind === "color" && d.op === "set");

const promptOverlay = /sunset|hoàng hôn/.test(customerPrompt) ? "sunset"
  : /mềm|soft|dịu/.test(customerPrompt) ? "soft"
    : /ấm|warm|golden/.test(customerPrompt) ? "warm" : null;
const selectedOverlays = overlayOrder
  ? (overlayOrder.target === "none" ? [] : [{ variant: overlayOrder.target, position: "fullscreen", opacity: 0.5, blend: "screen" }])
  : direction?.style?.overlays || (/không overlay|no overlay|clean|sạch/.test(customerPrompt)
    ? []
    : promptOverlay ? [{ variant: promptOverlay, position: "fullscreen", opacity: 0.5, blend: "screen" }]
      : template.defaults.overlays);
if (overlayOrder) appliedIds.add(overlayOrder.id);

const timelineColor = { ...template.defaults.color };
if (colorOrder) {
  if (colorOrder.target === "none") delete timelineColor.curves;
  else timelineColor.curves = colorOrder.target;
  appliedIds.add(colorOrder.id);
}

const timeline = {
  project: {
    name: projectName,
    ...template.defaults.project,
    ...(qualityOverride ? { quality: qualityOverride } : {}),
  },
  music: [{ path: musicPath, volume: 0.82,
    ...(musicEdit.mode === "highlight" ? { start: musicEdit.start, end: musicEdit.end } : {}) }],
  audio: template.defaults.audio,
  color: timelineColor,
  overlays: selectedOverlays,
  output: { path: videoOut },
  slides,
  recipeDecisions: { recipeId: template.id, pacingVariant: selectedPacing.id, theme: themeRef, heroPhoto: heroPhoto.file, endingPhoto: endingPhoto.file,
    storyArc: expandedScenes.map((s) => ({ sceneId: s.id, beat: s.arcBeat })), phraseSnaps: phraseSnap.snapped,
    musicEdit,
    transitionGrammar: { vocabulary: transitionGrammar.vocabulary, decisions: transitionGrammar.decisions },
    motionPlan: motionPlanner.decisions,
    colorNormalization: colorPath,
    ...(directionPath ? { source: directionPath.replace(/\\/g, "/") } : {}) },
  photoAssignment: {
    strategy: "global_hard_slots_first",
    customerLocks: { mustUsePhotos: mustUse, excludePhotos: [...excluded], openingPhoto: heroPhoto.file, endingPhoto: endingPhoto.file },
    slots: Object.fromEntries(globalAssignments),
    diversityReport: diversityPath,
  },
};

// Caption orders are the last thing applied, on the finished timeline. They are the
// cheap path for a text revision — patch and re-render, no rebuild, no AI — and they
// are also the last line of enforcement: a "đừng có chữ trên ảnh cưới" that the
// rebuild failed to honour does not get to reach the customer anyway.
for (const id of applyToTimeline(timeline, orders)) appliedIds.add(id);

// ---------------------------------------------------------------------------
// DOES THE FILM ACTUALLY COVER THE SONG?
//
// It did not, and nothing said so. On a real job — 23 photos, a 203s track — this
// recipe produced 72 SECONDS of film: the customer's song was cut off at 1:12 of 3:23,
// and the run exited 0. With a generous 82-photo pool it reached 164s and stopped, out
// of repeats. Even the fixture that test/template-scaling.test.mjs was built around
// covers 82% of its own track. Every one of those runs passed.
//
// The cause is that durationFor() reads an ABSOLUTE table of seconds (base 5.5s, calm
// 7s, montage 12s) scaled by a pacing multiplier that never leaves 0.86–1.12x. Nothing
// in the recipe path ever compares the total against music.duration. Premium does not
// have this bug because composeStoryboard SOLVES the shot count against the photo
// budget; the recipe path counts its scenes by hand.
//
// This check does not fix that — a recipe with a fixed scene list genuinely cannot
// carry every job, and describeFit() says so honestly (k >= 1.8 = "the film will
// crawl. Add photos, or use a shorter track"). What it does is refuse to SHIP the
// mismatch quietly. A film that abandons the song two thirds of the way through is not
// a warning in a log nobody reads; it is the wrong film.
const filmSec = slides.reduce((n, s) => n + s.duration, 0)
  - slides.reduce((n, s) => n + (s.transition?.duration || 0), 0);
// A customer who ORDERED a length is the target; otherwise the track is.
const lengthOrder = orders.find((d) => d.kind === "duration" && d.op === "set");
const targetSec = lengthOrder ? lengthOrder.target : Number(music.duration) || 0;

timeline.recipeDecisions.fit = {
  targetDuration: +targetSec.toFixed(2),
  actualDuration: +filmSec.toFixed(2),
  coverage: targetSec > 0 ? +(filmSec / targetSec).toFixed(4) : null,
  scale: shotList.fit.scale,
  boundBy: shotList.fit.boundBy,
  totalPhotos: photos.length,
  reservedPhotos: reserved.length,
  assignedPhotos: assignmentPlan.used.length,
  unusedPhotos: Math.max(0, photos.length - used.size),
  phraseSnaps: phraseSnap.snapped,
};

if (targetSec > 0) {
  const drift = (filmSec - targetSec) / targetSec;
  if (Math.abs(drift) > MISFIT_TOLERANCE) {
    const k = fitScale({
      baseDurations: slides.map((s) => s.duration),
      transitions: slides.map((s) => s.transition?.duration || 0),
      targetDuration: targetSec,
    });
    const fit = describeFit(k);
    const what = lengthOrder ? `the ${targetSec}s the customer asked for` : `the ${targetSec.toFixed(0)}s track`;
    const detail =
      `${templatePath} produced ${filmSec.toFixed(1)}s of film against ${what} ` +
      `(${(filmSec / targetSec * 100).toFixed(0)}% covered, ${drift > 0 ? "+" : ""}${(drift * 100).toFixed(0)}%).\n` +
      `  ${fit.verdict}: ${fit.message}\n` +
      `  ${photos.length} photo(s), ${slides.length} scene(s). A fixed scene list cannot stretch to every job:\n` +
      `  add photos, pick a shorter track, or use --tier premium, which solves the shot count against the budget.`;
    if (acceptMisfit) {
      console.warn(`[applyStoryTemplate] WARNING — the film does not fit:\n  ${detail}\n  (--accept-misfit: shipping it anyway)`);
    } else {
      throw new Error(
        `the film does not fit the music.\n  ${detail}\n` +
        `  Pass --accept-misfit to ship it anyway — a person deciding this in writing, never a silent default.`
      );
    }
  }
}

fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(timeline, null, 2) + "\n");
console.log(`Wrote ${outPath}: ${slides.length} scenes, ~${Math.round(t)}s, photos used ${used.size}/${photos.length}.`);
if (orders.length) {
  const missed = orders.filter((d) => !appliedIds.has(d.id));
  console.log(`  directives: ${appliedIds.size}/${orders.length} applied${missed.length ? `; not applied here: ${missed.map((d) => `${d.kind}/${d.op}`).join(", ")}` : ""}`);
}
