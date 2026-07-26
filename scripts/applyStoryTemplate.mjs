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
import { applyStoryArc } from "./lib/tier1Editorial.mjs";
import { retimeSlidesToMusic } from "./lib/musicRetime.mjs";
import { createTransitionGrammar } from "./lib/transitionGrammar.mjs";
import { buildDiversityReport } from "./lib/diversityPlanner.mjs";
import { createMotionPlanner } from "./lib/motionPlanner.mjs";
import { averageAdjustments, buildColorNormalization } from "./lib/colorNormalizer.mjs";
import { loadLedger, active, applyToStoryboard, applyToTimeline } from "./lib/directives.mjs";
import { fitScale, describeFit } from "./lib/pacing.mjs";
import { scenePhotoCount } from "./lib/scenePhotoCount.mjs";
import { validateMusicAnalysis } from "./lib/musicAnalysis.mjs";
import { hashSeed, pickVariant as pickVariantFor } from "./lib/copyVariants.mjs";
import { createTemplateTheme } from "./lib/templateTheme.mjs";
import {
  buildPhotoAssignmentRequests,
  principalSlotId,
} from "./lib/templatePhotoRequests.mjs";
import { createLayerSceneBuilder } from "./lib/layerSceneBuilder.mjs";
import { planTemplateMusic } from "./lib/templateMusicPlan.mjs";
import { planTemplateShotList } from "./lib/templateShotList.mjs";
import {
  SINGLE_PHOTO_EFFECTS, MONTAGE_MAX, EASING_EFFECTS,
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
const language = arg("--language", "vi");
const languageEnforced = process.argv.includes("--language");
const sequenceMode = arg("--sequence-mode", "editorial");
// The second track for "playlist" mode (nối sang bài khác). Absent → playlist degrades to
// loop (the engine's own -stream_loop already repeats a single track to cover any video
// length; see buildAudioMuxArgs), and we say so rather than fail.
const extraMusicPath = arg("--extra-music", "");
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
  // scenePhotoCount knows what each LAYOUT consumes — which is the only way a montage
  // can absorb its neighbours without over-drawing the photo budget the storyboard was
  // solved against. Without it the directive layer would be guessing.
  for (const id of applyToStoryboard(template, orders, {
    availablePhotos: photosDoc.photos?.length ?? 0,
    photoDemand: (scene) => scenePhotoCount(scene, { library, direction }),
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

// Two couples buying the same recipe must not receive byte-identical wording.
// A scene may author `text`/`captionPattern` as an ARRAY of 2-3 equivalent lines;
// which one ships is picked deterministically off the couple's own identity (see
// lib/copyVariants.mjs) — stable across re-renders of the SAME brief, different
// across different couples. A plain string/object value (every scene authored
// before this existed) passes through unchanged.
const customerSeed = hashSeed(`${tokens.bride}|${tokens.groom}|${tokens.date}`);
function pickVariant(value, key = "") {
  return pickVariantFor(value, customerSeed, key);
}

const contentFile = path.resolve(root, `${analysisDir}/photo_content.json`);
const contentDoc = fs.existsSync(contentFile) ? JSON.parse(fs.readFileSync(contentFile, "utf8")) : { photos: [] };
const contentByFile = new Map((contentDoc.photos || []).map((p) => [p.file, p]));

// `moment` directives ("phải có cảnh trao nhẫn") are matched by CONTENT TAG, not
// filename — the customer cannot name a file they have not seen yet. Resolve them here,
// into the SAME must-use/exclude locks a hand-typed brief.mustUsePhotos/excludePhotos
// already drives (mustUse below, and audit() reads the same evidence either way), so
// this is one enforcement mechanism, not a second one that could drift from the first.
const momentOrders = orders.filter((d) => d.kind === "moment");
const momentForbidFiles = [];
for (const d of momentOrders) {
  if (d.op !== "forbid") continue;
  const matches = [...contentByFile.entries()].filter(([, p]) => (p.tags || []).includes(d.target)).map(([f]) => f);
  if (matches.length) { momentForbidFiles.push(...matches); appliedIds.add(d.id); }
}

const excluded = new Set([...(brief.excludePhotos || []), ...momentForbidFiles]);
const photos = (photosDoc.photos || []).filter((p) => !excluded.has(p.file))
  .map((p) => ({ ...p, ...contentByFile.get(p.file), file: p.file }));
if (photos.length === 0) throw new Error(`${photosPath} has no photos`);

// `require` picks the single BEST matching photo (highest heroScore) so "phải có cảnh
// trao nhẫn" does not lock in the blurriest ring shot in the set — same reasoning as
// mustUsePhotos, just resolved from a tag instead of typed by hand. No match → nothing
// is locked, and audit() reports the miss honestly rather than this failing silently.
const momentRequireFiles = momentOrders
  .filter((d) => d.op === "require")
  .map((d) => {
    const matches = photos.filter((p) => (p.tags || []).includes(d.target));
    if (!matches.length) return null;
    appliedIds.add(d.id);
    return [...matches].sort((a, b) => (b.heroScore ?? 0) - (a.heroScore ?? 0))[0].file;
  })
  .filter(Boolean);

// Below the recipe's floor the film still ships — the solver substitutes what the pool
// cannot afford — but layouts WILL recur, and that is worth a line in the log and a
// field in the timeline instead of a surprise on the contact sheet.
const capacityLimited = direction?.pacing?.capacityLimited
  || (photos.length < (template.fit?.minPhotos || 0)
    ? { availablePhotos: photos.length, recipeMinPhotos: template.fit.minPhotos,
        reason: "photo set is below the recipe's floor; expensive scenes will be substituted" }
    : null);
if (capacityLimited) {
  console.warn(
    `[applyStoryTemplate] WARNING — ${capacityLimited.availablePhotos} photos is below ${template.id}'s floor of ` +
      `${capacityLimited.recipeMinPhotos}: expensive scenes will be substituted and layouts will recur. ` +
      `The film ships, but more photos would give it more variety.`
  );
}
const {
  requestedMusicMode,
  musicModeOrderId,
  musicEdit: initialMusicEdit,
  music: initialMusic,
} = planTemplateMusic({
  orders,
  musicModeArg,
  brief,
  sourceMusic,
  photoCount: photos.length,
  acceptMisfit,
  extraMusicPath,
  musicPath,
});
if (musicModeOrderId) appliedIds.add(musicModeOrderId);
let musicEdit = initialMusicEdit;
let music = initialMusic;
const availableFiles = new Set(photos.map((p) => p.file));
for (const file of [...(brief.mustUsePhotos || []), brief.openingPhoto, brief.endingPhoto].filter(Boolean)) {
  if (!availableFiles.has(file)) throw new Error(`brief requires unavailable/excluded photo: ${file}`);
}

const byFile = new Map(photos.map((p) => [p.file, p]));

/** Constrain a normalized face box to the unit square the way analyzePhotos.mjs's own
 *  clampBox does — but applied HERE too, at the chokepoint where analysis data becomes
 *  timeline JSON. An external face-detection merge in analyzePhotos.mjs writes
 *  faceBoxEstimate straight from a supplied detector's box without running it back
 *  through clampBox, so a box whose edge sits a pixel past the frame (a real detector
 *  result, not a typo) reaches here at x+width = 1.008 — and validateTimeline's schema
 *  rejects the WHOLE render over a sub-1% overflow. Re-clamping on the way out is the
 *  one place guaranteed to see every faceBox this file emits, regardless of which
 *  analyzer produced it or whether that analyzer remembered to clamp. */
function clampFaceBox(box) {
  if (!box) return box;
  const cx = Math.min(Math.max(box.x, 0), 1), cy = Math.min(Math.max(box.y, 0), 1);
  return {
    x: +cx.toFixed(4), y: +cy.toFixed(4),
    width: +Math.min(Math.max(box.width, 0), 1 - cx).toFixed(4),
    height: +Math.min(Math.max(box.height, 0), 1 - cy).toFixed(4),
  };
}

/** The analyzer's face-derived focus for a photo, as slide fields.
 *
 *  A single-photo slide cover-crops to the frame, and without a focus that crop is dead
 *  centre — which decapitates a portrait in a 16:9 frame, because heads are at the top and
 *  the top is precisely what a centre crop discards. layer_scene images have carried focus
 *  for a while (buildLayerImage does it); plain slides never did, so the same album was
 *  face-safe in a card and beheaded in a zoom.
 *
 *  Omitted rather than defaulted when the analyzer has no answer: absent means "centre" to
 *  the renderer anyway, and writing a made-up 0.5 would make an unanalysed photo
 *  indistinguishable from one whose subject really is centred. */
const focusOf = (file) => {
  const p = byFile.get(file);
  return {
    ...(Number.isFinite(p?.focusX) ? { focusX: p.focusX } : {}),
    ...(Number.isFinite(p?.focusY) ? { focusY: p.focusY } : {}),
    ...(p?.faceBoxEstimate ? { faceBox: clampFaceBox(p.faceBoxEstimate) } : {}),
  };
};

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
    ...(p.faceBoxEstimate ? { faceBox: clampFaceBox(p.faceBoxEstimate) } : {}),
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

const {
  themeRef,
  libTheme,
  resolveColor,
  resolveFont,
  resolveFrame,
  defaultTextColor,
  photoStart,
  textStart,
} = createTemplateTheme({ library, template, customerPrompt, direction });
const buildLayerSceneFromLayout = createLayerSceneBuilder({
  library,
  libraryPath,
  endingPhoto,
  heroPhoto,
  getExpandedScenes: () => expandedScenes,
  getGlobalAssignments: () => globalAssignments,
  take,
  claimPhoto: (file, selected) => { used.add(file); lastPhoto = selected; },
  pic,
  rect,
  libTheme,
  resolveColor,
  resolveFrame,
  photoStart,
  copyMap,
  pickVariant,
  fill,
  resolveFont,
  defaultTextColor,
  textStart,
  txt,
});
// Emit a caption only when the scene actually supplies copy — recipes that want
// "photos only" montage beats just omit captionPattern.
const capsFor = (pattern, role = "caption", key = "") => {
  const t = fill(pickVariant(pattern, key ? `${key}:captionPattern` : ""));
  return t ? [cap(t, role)] : [];
};

// Which effect takes one photo, which takes many, how many a montage may hold, and which
// accept `easing` — all of it now comes from lib/engineCapabilities.mjs. It used to be
// four hand-maintained tables in this file and two more in recipeShotList, and they did
// not agree: a film_roll held 12 photos according to one and 8 according to another, and
// which you got depended on which code path reached the scene first.

function buildScene(scene) {
  // A signature hybrid scene (scripts/composeStoryboard.mjs / hand-authored recipe): the
  // photo it takes was requested and assigned through the exact same path as any other
  // single-photo scene (photoSlotsFor gave it a "hero" slot, scene.effect is the harmless
  // "still" placeholder the schema still requires) — only the render backend differs.
  if (scene.renderer && scene.template) {
    const needsPair = scene.template === "gl_transition";
    const hybridAssets = needsPair
      ? photosFor("pair", scene, 2)
      : [scene === expandedScenes?.[0] ? heroPhoto.file : photo("hero", scene)];
    if (!needsPair && scene === expandedScenes?.[0]) { used.add(hybridAssets[0]); lastPhoto = heroPhoto; }
    return {
      effect: "still",
      renderer: scene.renderer,
      template: scene.template,
      assets: hybridAssets,
      params: scene.params || {},
      captions: capsFor(scene.captionPattern, "caption", scene.id),
    };
  }
  if (scene.effect === "layer_scene") return buildLayerSceneFromLayout(scene);
  if (scene.effect === "memory_wall") {
    return { effect: "memory_wall", images: photosFor("memories", scene, 5), params: scene.params || {}, captions: capsFor(scene.captionPattern, "caption", scene.id) };
  }
  if (scene.effect === "collage_grid") {
    return { effect: "collage_grid", images: photosFor("grid", scene, 6), params: scene.params || {}, captions: capsFor(scene.captionPattern, "caption", scene.id) };
  }
  if (["film_roll_left", "film_roll_up", "film_roll_right", "photo_strip_up", "photo_strip_left", "photo_strip_right"].includes(scene.effect)) {
    return { effect: scene.effect, images: photosFor("film_roll", scene, 8), params: scene.params || {}, captions: capsFor(scene.captionPattern, "caption", scene.id) };
  }
  if (scene.effect === "double_exposure") {
    return { effect: "double_exposure", images: photosFor("pair", scene, 2), captions: capsFor(scene.captionPattern, "caption", scene.id) };
  }
  if (scene.effect === "video_background") {
    if (!scene.background) throw new Error(`Scene ${scene.id}: video_background needs a 'background' video path`);
    return { effect: "video_background", background: scene.background, captions: capsFor(scene.captionPattern, "caption", scene.id) };
  }
  if (scene.effect === "mask_reveal") {
    const isOpening = scene === expandedScenes?.[0];
    if (isOpening) { used.add(heroPhoto.file); lastPhoto = heroPhoto; }
    const maskImage = isOpening ? heroPhoto.file : photo("hero", scene);
    return {
      effect: "mask_reveal",
      image: maskImage,
      mask: scene.mask || "assets/masks/particle_gather.mp4",
      params: scene.params || {},
      captions: capsFor(scene.captionPattern, "caption", scene.id),
      ...focusOf(maskImage),
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
    const slide = { effect: scene.effect, image, captions: capsFor(scene.captionPattern, role, scene.id), ...focusOf(image) };
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
const shotListPlan = planTemplateShotList({
  template,
  photos,
  heroPhoto,
  endingPhoto,
  library,
  direction,
  durationFor,
  sourceMusic,
  requestedMusicMode,
  initialMusic: music,
  initialMusicEdit: musicEdit,
});
const { shotList, reservedPhotos } = shotListPlan;
music = shotListPlan.music;
musicEdit = shotListPlan.musicEdit;
const expandedScenes = applyStoryArc(shotList.scenes, template.storyArc);
console.log(
  `[applyStoryTemplate] shot list: ${shotList.fit.sceneCount} scenes, ${shotList.fit.photosUsed}/${shotList.fit.photoCount} photos ` +
    `(bound by ${shotList.fit.boundBy}, budget ${shotList.fit.budgetSecondsPerPhoto}s/photo) — ${shotList.fit.message}`
);

const requests = buildPhotoAssignmentRequests({ scenes: expandedScenes, library, direction });
const mustUse = [...new Set([...(brief.mustUsePhotos || []), ...momentRequireFiles])].filter((f) => f !== heroPhoto.file && f !== endingPhoto.file);
const flexibleRequests = requests.filter((r) => !r.hero);
if (mustUse.length > flexibleRequests.length) throw new Error(`brief has ${mustUse.length} must-use photos but only ${flexibleRequests.length} assignable slots`);
mustUse.forEach((file, i) => { flexibleRequests[i].preferred = file; });
// The same reservation the budget was solved against — not a second, independently
// derived one. Two places computing "which photos are held back" is how they drift.
const reserved = [...reservedPhotos];
const lockedForAssignment = new Set([...reserved, ...mustUse]);
const representativeByGroup = new Map();
for (const photo of photos) {
  if (!photo.duplicateGroup || lockedForAssignment.has(photo.file)) continue;
  const current = representativeByGroup.get(photo.duplicateGroup);
  if (!current || photo.duplicateRepresentative) representativeByGroup.set(photo.duplicateGroup, photo.file);
}
const assignmentPhotos = photos.filter((photo) =>
  !photo.duplicateGroup || lockedForAssignment.has(photo.file) ||
  representativeByGroup.get(photo.duplicateGroup) === photo.file
);
const assignmentPlan = assignPhotos({ photos: assignmentPhotos, requests, reserved, sequenceMode });
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
    ...(scene.signature ? { signature: true } : {}),
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
const musicRetiming = retimeSlidesToMusic(slides, music);
slides = musicRetiming.slides;
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
  language,
  languageEnforced,
  sequenceMode,
  project: {
    name: projectName,
    ...template.defaults.project,
    ...(qualityOverride ? { quality: qualityOverride } : {}),
  },
  // loop: a single track, no start/end trim — the engine already repeats a track shorter
  // than the video (-stream_loop -1 in buildAudioMuxArgs) to cover it, so nothing else is
  // needed here. playlist: a second track appended; the engine's playlist path joins them
  // with acrossfade and repeats the WHOLE pair until it covers the video.
  music: musicEdit.mode === "playlist"
    ? [{ path: musicPath, volume: 0.82 }, { path: extraMusicPath, volume: 0.82 }]
    : [{ path: musicPath, volume: 0.82,
        ...(musicEdit.mode === "highlight" ? { start: musicEdit.start, end: musicEdit.end } : {}) }],
  audio: musicEdit.mode === "playlist"
    ? { ...template.defaults.audio, crossfade: Math.max(2, template.defaults.audio?.crossfade || 0) }
    : template.defaults.audio,
  color: timelineColor,
  overlays: selectedOverlays,
  output: { path: videoOut },
  slides,
  recipeDecisions: { recipeId: template.id, pacingVariant: selectedPacing.id, theme: themeRef, heroPhoto: heroPhoto.file, endingPhoto: endingPhoto.file,
    storyArc: expandedScenes.map((s) => ({ sceneId: s.id, beat: s.arcBeat })), phraseSnaps: musicRetiming.sync.snappedBoundaries,
    musicSync: musicRetiming.sync,
    musicEdit,
    transitionGrammar: { vocabulary: transitionGrammar.vocabulary, decisions: transitionGrammar.decisions },
    motionPlan: motionPlanner.decisions,
    colorNormalization: colorPath,
    ...(capacityLimited ? { capacityLimited } : {}),
    ...(directionPath ? { source: directionPath.replace(/\\/g, "/") } : {}) },
  photoAssignment: {
    strategy: sequenceMode === "chronological" ? "chronological" : "global_hard_slots_first",
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
  phraseSnaps: musicRetiming.sync.snappedBoundaries,
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
