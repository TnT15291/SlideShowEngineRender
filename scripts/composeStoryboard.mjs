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
//   CODE decides   how many scenes, what SHAPE each one is (a single photograph held
//                  full-frame, a designed card, a montage), how many photos each
//                  spends, how long each runs, and that no two neighbours look alike
//   AI decides     what every scene SAYS   (scripts/writeRecipeCopy.mjs --copy)
//                  and the VOCABULARY it is made from (director_notes: which effects,
//                  which transitions, how much of the film is designed cards)
//
// The AI's half used to be ONE FIELD WIDE. director_notes carried twelve decisions and
// this file read exactly one of them — montageEffect — so the engine's 24 effects reached
// the screen as 1, and premium rendered 23 text cards on a three-layout rotation that
// looked cheaper than the template tier it is supposed to beat. The menu both halves now
// read is scripts/lib/engineCapabilities.mjs.
//
// Usage:
//   node scripts/composeStoryboard.mjs --photos <photos.json> --music <music.mp3>
//     [--analysis-dir analysis] [--plan analysis/story_plan.json]
//     [--director analysis/director_notes.json] [--theme <id>] [--max-reuse 1]
//     [--brief <brief.json>] [--directives <directives.json>] [--music-mode auto]
//     [--out analysis/storyboard.json]
import fs from "node:fs";
import path from "node:path";
import { makeEnergy } from "./lib/pacing.mjs";
import { composeStoryboard, DEFAULT_GRAMMAR, applySignatureHybridScene } from "./lib/storyboard.mjs";
import { resolveMusicWindow, sliceMusicAnalysis } from "./lib/musicHighlight.mjs";
import { loadLedger, active } from "./lib/directives.mjs";
import {
  SINGLE_PHOTO_EFFECTS, MONTAGE_EFFECTS, MONTAGE_SLOT, MOTION_EFFECTS, ALL_TRANSITIONS,
  HYBRID_SIGNATURE_TEMPLATES, HYBRID_RENDERER,
} from "./lib/engineCapabilities.mjs";

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
const briefPath = arg("--brief", "");
const directivesPath = arg("--directives", "");
const musicModeArg = arg("--music-mode", "");
const outPath = arg("--out", `${analysisDir}/storyboard.json`);
const maxReuse = Number(arg("--max-reuse", "1"));
const strict = process.argv.includes("--strict");

if (!musicPath) die("--music is required (the shot list is solved against the track's length)");
if (!Number.isFinite(maxReuse) || maxReuse < 1) die(`--max-reuse must be >= 1, got "${maxReuse}"`);

const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const exists = (p) => p && fs.existsSync(path.resolve(root, p));

const library = readJson(libraryPath);
const brief = exists(briefPath) ? readJson(briefPath) : {};

// The SAME pool applyStoryTemplate will render from. It drops the brief's excluded photos
// before it counts anything, and that count is what the music window and the entire photo
// budget are solved against — so composing from the unfiltered set solves the wrong job by
// however many frames the customer struck out.
const excluded = new Set(brief.excludePhotos || []);
const photos = (readJson(photosPath).photos ?? []).filter((p) => !excluded.has(p.file));
if (!photos.length) die(`${photosPath} has no photos`);

const musicName = path.basename(musicPath).replace(/\.[^.]+$/, "");
const musicJson = `${analysisDir}/music/${musicName}.json`;
if (!exists(musicJson)) die(`music analysis not found: ${musicJson} — run analyzeMusic first`);
const sourceMusic = readJson(musicJson);

// WHICH SONG ARE WE MAKING? The two halves of premium used to answer differently. This
// file solved the shot list against the FULL track; applyStoryTemplate, reading the same
// job, cut a highlight whenever a photo would have to carry more than 7.2 seconds — which
// is most photo-poor weddings. On the job that prompted this fix (23 photos, a 203s song)
// that meant composing 219 seconds of film for a 93-second excerpt. Same function, same
// inputs, one answer.
const ledger = directivesPath ? loadLedger(directivesPath) : { directives: [] };
const orders = active(ledger);
const musicEdit = resolveMusicWindow({
  music: sourceMusic,
  photoCount: photos.length,
  orders,
  brief,
  musicMode: musicModeArg,
});
const music = sliceMusicAnalysis(sourceMusic, musicEdit);
if (musicEdit.mode === "highlight") {
  console.log(
    `[composeStoryboard] highlight: ${musicEdit.start}s–${musicEdit.end}s (${musicEdit.duration}s of ` +
      `${musicEdit.sourceDuration}s) — ${photos.length} photos cannot carry the full song naturally`
  );
}

const plan = exists(planPath) ? readJson(planPath) : null;
const director = exists(directorPath) ? readJson(directorPath) : null;
const notes = director?.director_notes ?? {};

const acts = (plan?.segments ?? []).map((s) => s.segment);
const theme = arg("--theme", notes.libraryTheme || "white_weddings");

// --- the director's vocabulary ------------------------------------------------
// Clamped again here — not because generateDirectorNotes failed to clamp it, but because
// this file has to be safe to run against a hand-edited director_notes.json, and because
// an effect can be valid in the schema yet unusable HERE (it needs an asset, or a layout).
// An unusable name is dropped, never rendered.
const keep = (xs, allowed) => (Array.isArray(xs) ? xs.filter((x) => allowed.has(x)) : []);
const grammar = {
  singlePhotoEffects: keep(notes.singlePhotoEffects, SINGLE_PHOTO_EFFECTS),
  montageEffects: keep(notes.montageEffects, MONTAGE_EFFECTS),
  transitionPalette: keep(notes.transitionPalette, new Set(ALL_TRANSITIONS)),
  layoutMix: Number.isFinite(notes.layoutMix) ? notes.layoutMix : DEFAULT_GRAMMAR.layoutMix,
  easingCalm: notes.easingCalm || DEFAULT_GRAMMAR.easingCalm,
  easingEnergetic: notes.easingEnergetic || DEFAULT_GRAMMAR.easingEnergetic,
};
// The director's per-role picks are a palette too. They were computed, guardrailed, written
// to disk — and then read by nothing at all. Fold them in rather than leave them there.
for (const role of ["openingEffect", "heroEffect", "portraitEffect", "detailEffect"]) {
  const e = notes[role];
  if (SINGLE_PHOTO_EFFECTS.has(e) && !grammar.singlePhotoEffects.includes(e)) grammar.singlePhotoEffects.push(e);
}
if (MONTAGE_EFFECTS.has(notes.groupEffect) && !grammar.montageEffects.includes(notes.groupEffect)) {
  grammar.montageEffects.push(notes.groupEffect);
}
// TOP UP THE PALETTE — on COUNT, and on MOTION.
//
// An old director_notes.json carries four role picks (opening/hero/portrait/detail) and no
// palette, and the house defaults for three of those four roles are STATIC effects
// (dark_feather, portrait_blur_background, circle_focus). So folding the roles in gives a
// palette of four that barely moves — and a photo-poor job holds each of those frames for
// eight seconds. Four names is not the problem; four names that all stand still is.
//
// Count is the same argument one step down: a palette of three cannot avoid a neighbour
// when one is excluded, so the rotation starts repeating.
const topUp = (key, house, want, accept = () => true) => {
  for (const id of house) {
    if (grammar[key].filter(accept).length >= want) break;
    if (!grammar[key].includes(id)) grammar[key].push(id);
  }
};
topUp("singlePhotoEffects", DEFAULT_GRAMMAR.singlePhotoEffects, 3, (e) => MOTION_EFFECTS.includes(e));
topUp("singlePhotoEffects", DEFAULT_GRAMMAR.singlePhotoEffects, 5);
topUp("montageEffects", DEFAULT_GRAMMAR.montageEffects, 2);
topUp("transitionPalette", DEFAULT_GRAMMAR.transitionPalette, 3);

const { scenes: composedScenes, fit } = composeStoryboard({
  photoCount: photos.length,
  musicDuration: music.duration,
  energy: makeEnergy(music),
  library,
  acts,
  maxReuse,
  grammar,
  montageEffect: notes.montageEffect,
});

// Clamped again here, same reason as the palettes above: this file has to be safe to run
// against a hand-edited director_notes.json, not just one generateDirectorNotes wrote.
const hybridTemplate = notes.signatureHybridScene && HYBRID_SIGNATURE_TEMPLATES.has(notes.signatureHybridScene)
  ? notes.signatureHybridScene
  : null;
if (notes.signatureHybridScene && !hybridTemplate) {
  console.warn(`[composeStoryboard] signatureHybridScene "${notes.signatureHybridScene}" is not a single-photo hybrid template — ignored`);
}
const scenes = applySignatureHybridScene(
  composedScenes,
  hybridTemplate ? { template: hybridTemplate, renderer: HYBRID_RENDERER[hybridTemplate] } : {}
);
if (hybridTemplate) {
  const swapped = scenes.find((s) => s.template === hybridTemplate);
  console.log(
    swapped
      ? `[composeStoryboard] signature scene: ${swapped.id} -> ${HYBRID_RENDERER[hybridTemplate]}/${hybridTemplate}`
      : `[composeStoryboard] signatureHybridScene "${hybridTemplate}" requested but no single-photo scene was available to carry it — skipped`
  );
}

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

/** The photo slots applyStoryTemplate will request from the global assignment.
 *
 *  A layer_scene declares none — its layout already says how many it holds, and how many
 *  is not the scene's to decide. Everything else MUST declare, or assignmentRequests()
 *  passes the scene by and the photograph gets taken straight from the pool, behind the
 *  back of the de-duplication and diversity passes. The slot name is not cosmetic either:
 *  it is the key the assignment is stored under, and buildScene() looks it up by name. */
function photoSlotsFor(scene) {
  if (scene.effect === "layer_scene" || !scene.photos) return {};
  return { photoSlots: [{ slot: MONTAGE_SLOT[scene.effect] ?? "hero", count: scene.photos }] };
}

// A vocabulary the grammar can actually rotate through. createTransitionGrammar REFUSES
// any type outside `vocabulary` and silently resolves it back to the default — so the
// roles and the vocabulary have to be built from the same list, or a "peak" transition
// is chosen, rejected and replaced by a crossfade without anyone being told.
const palette = grammar.transitionPalette?.length ? grammar.transitionPalette : DEFAULT_GRAMMAR.transitionPalette;
const namedTransition = (v, fallback) => (ALL_TRANSITIONS.includes(v) ? v : fallback);
const transitionStrategy = {
  default: { type: namedTransition(notes.defaultTransition, palette[0]), duration: 0.8 },
  chapter: { type: palette[1] ?? palette[0], duration: 1.1 },
  peak: { type: palette[2] ?? palette[palette.length - 1], duration: 0.55 },
  final: { type: namedTransition(notes.endingTransition, "fade_slow"), duration: 1.2 },
};

const recipe = {
  id: arg("--name", "storyboard"),
  version: 1,
  name: "Composed storyboard",
  libraryTheme: theme,
  generatedBy: "code:composeStoryboard",
  generatedAt: new Date().toISOString(),
  fit,
  // applyStoryTemplate reads `origin`. A composed storyboard has ALREADY been solved
  // against the photo budget and the track, so re-solving it there throws this shot list
  // away and rebuilds it off a flat 5.5s-per-scene table — which is what used to happen,
  // and is why every premium scene came out within a tenth of a second of every other.
  source: { origin: "composed", notes: `Solved against ${photos.length} photos and a ${music.duration.toFixed(0)}s track.` },
  musicEdit,
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
    transitionStrategy,
    photoSelection: { darkPhotoMaxMeanLuma: 75 },
  },
  transitionGrammar: {
    vocabulary: [...new Set(Object.values(transitionStrategy).map((t) => t.type))],
    specialRoles: ["peak"],
    limits: { peak: Math.max(2, Math.round(scenes.length / 5)), chapter: 5 },
  },
  scenes: scenes.map((s) => ({
    id: s.id,
    effect: s.effect,
    ...(s.renderer ? { renderer: s.renderer, template: s.template } : {}),
    ...(s.layout ? { layout: s.layout } : {}),
    ...(s.act ? { act: s.act } : {}),
    durationSec: s.duration,
    ...(s.transitionRole ? { transitionRole: s.transitionRole } : {}),
    ...(s.easing ? { easing: s.easing } : {}),
    ...photoSlotsFor(s),
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
const v = fit.variety;
console.log(
  `[composeStoryboard] ${scenes.length} scenes, ${fit.photosUsed}/${fit.photoCount} photos (max ${maxReuse}x each), ` +
    `${film.toFixed(0)}s of a ${music.duration.toFixed(0)}s track -> ${outPath}\n` +
    `  budget ${fit.budgetSecondsPerPhoto}s/photo, bound by ${fit.boundBy}, ${fit.message}\n` +
    `  variety: ${v.distinctEffects} effect(s) [${v.effects.join(", ")}], ${v.distinctLayouts} layout(s), ` +
    `${v.distinctPhotoCounts} scene size(s), ${v.adjacentRepeats} adjacent repeat(s)`
);

// A film that leaves a third of the song playing over nothing, or shows one photo
// eight times, is not a warning — it is a broken deliverable. Let a caller opt in
// to treating it as one.
if (strict && fit.verdict !== "ok") {
  console.error(`[composeStoryboard] --strict: ${fit.verdict}`);
  process.exit(1);
}
