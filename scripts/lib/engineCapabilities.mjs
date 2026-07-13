// WHAT THE ENGINE CAN ACTUALLY DO — one table, derived from the schema.
//
// This file exists because the answer used to be scattered across four copies that
// disagreed. applyStoryTemplate carried SINGLE_IMAGE_EFFECTS, EASING_EFFECTS,
// MONTAGE_EFFECTS and TWO separate `maxByEffect` tables; recipeShotList carried
// VARIABLE_SLOT and VARIABLE_MAX; and nothing carried the list to the AI at all. A
// film_roll could hold 12 photos in one table and 8 in another, and which number you
// got depended on which code path reached the scene first.
//
// Worse than the drift: composeStoryboard — the one node that DECIDES what a premium
// film is made of — knew about exactly two effects. The engine has 24. So premium
// rendered 100% layer_scene, three layouts on rotation, and looked cheaper than the
// template tier it was supposed to beat.
//
// THE CONTRACT. The effect list is read from schema/timeline.schema.json, never typed
// here. Every effect in that enum must be classified below or this module throws at
// import. So adding an effect to the engine without telling the director layer about
// it is a loud failure, not a silent omission — which is the only way a "single source
// of truth" is worth anything.
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

const schema = JSON.parse(
  fs.readFileSync(path.resolve(root, "schema/timeline.schema.json"), "utf8")
);

export const ALL_EFFECTS = schema.$defs.effect.enum;
export const ALL_TRANSITIONS = schema.$defs.transitionType.enum;
export const ALL_CURVES = schema.$defs.curvesPreset.enum;

/** Whole-slide effects that show ONE photograph, full frame.
 *
 * `motion` is what makes a long hold watchable: on a photo-poor job every photo has to
 * carry 8+ seconds, and 8 seconds of a static card is dead air while 8 seconds of a slow
 * push-in is cinema. The director is told this, because it is the single most useful
 * thing to know when the photo budget is tight. */
const SINGLE = {
  still: { motion: false, hint: "static hold; use sparingly, it reads as dead air past ~4s" },
  slow_zoom_in: { motion: true, hint: "slow push in; the default for an emotional hold" },
  slow_zoom_out: { motion: true, hint: "slow pull back; reveals context, good for openings" },
  pan_left: { motion: true, hint: "lateral drift; good on wide landscape frames" },
  pan_right: { motion: true, hint: "lateral drift; good on wide landscape frames" },
  pan_up: { motion: true, hint: "vertical drift; good on tall portrait frames" },
  pan_down: { motion: true, hint: "vertical drift; good on tall portrait frames" },
  kenburns_tl: { motion: true, hint: "diagonal ken-burns; classic documentary feel" },
  kenburns_tr: { motion: true, hint: "diagonal ken-burns; classic documentary feel" },
  kenburns_bl: { motion: true, hint: "diagonal ken-burns; classic documentary feel" },
  kenburns_br: { motion: true, hint: "diagonal ken-burns; classic documentary feel" },
  portrait_blur_background: { motion: false, hint: "subject sharp, background blurred; made for portraits" },
  polaroid: { motion: false, hint: "photo as a physical print; nostalgic, keepsake feel" },
  circle_focus: { motion: false, hint: "vignette to a circle; intimate, draws to a detail" },
  dark_feather: { motion: false, hint: "feathered dark vignette; cinematic, good under a subtitle" },
};

/** Effects that consume MANY photographs. `slot` is the photoSlots key applyStoryTemplate
 *  reads; `max` is the engine's hard clamp. These are the budget's shock absorbers: on a
 *  photo-rich job they soak up the surplus, on a photo-poor one they shrink away. */
const MONTAGE = {
  memory_wall: { slot: "memories", min: 3, max: 5, hint: "photos settle onto a wall; warm, collective" },
  collage_grid: { slot: "grid", min: 4, max: 6, hint: "grid of frames; energetic, good for group/party beats" },
  film_roll_up: { slot: "film_roll", min: 4, max: 12, hint: "strip of frames scrolling up; a montage sweep" },
  film_roll_left: { slot: "film_roll", min: 4, max: 12, hint: "strip scrolling left; a montage sweep" },
  film_roll_right: { slot: "film_roll", min: 4, max: 12, hint: "strip scrolling right; a montage sweep" },
  double_exposure: { slot: "pair", min: 2, max: 2, hint: "two frames blended; dreamlike, use once or twice" },
};

/** Effects that are neither: they need an asset or a layout, so the composer treats them
 *  specially rather than drawing them from a palette. */
const SPECIAL = {
  layer_scene: { photos: "layout", hint: "a designed card: photos + text in a layout from layouts/library.json" },
  mask_reveal: { photos: 1, asset: "assets/masks/particle_gather.mp4", hint: "one photo revealed through a moving mask" },
  video_background: { photos: 0, asset: "scene.background", hint: "a stock video interlude; shows no photograph" },
};

// The guarantee. An effect the engine accepts but nobody classified would be invisible to
// the director — exactly the failure this file exists to prevent.
const classified = new Set([...Object.keys(SINGLE), ...Object.keys(MONTAGE), ...Object.keys(SPECIAL)]);
const unclassified = ALL_EFFECTS.filter((e) => !classified.has(e));
if (unclassified.length) {
  throw new Error(
    `scripts/lib/engineCapabilities.mjs is out of date: the engine accepts ${unclassified.join(", ")}, ` +
      `but this file does not classify ${unclassified.length === 1 ? "it" : "them"}. ` +
      `Add ${unclassified.length === 1 ? "it" : "them"} to SINGLE, MONTAGE or SPECIAL so the AI director can use ${unclassified.length === 1 ? "it" : "them"}.`
  );
}

export const SINGLE_PHOTO_EFFECTS = new Set(Object.keys(SINGLE));
export const MONTAGE_EFFECTS = new Set(Object.keys(MONTAGE));
/** Photos a montage may hold — the engine's clamp, shared by every caller that sizes one. */
export const MONTAGE_MAX = Object.fromEntries(Object.entries(MONTAGE).map(([id, m]) => [id, m.max]));
export const MONTAGE_MIN = Object.fromEntries(Object.entries(MONTAGE).map(([id, m]) => [id, m.min]));
export const MONTAGE_SLOT = Object.fromEntries(Object.entries(MONTAGE).map(([id, m]) => [id, m.slot]));
/** The engine only accepts `easing` on the effects that actually move the frame. */
export const EASING_EFFECTS = new Set(Object.entries(SINGLE).filter(([, m]) => m.motion).map(([id]) => id));
/** Single-photo effects that MOVE — what a long hold needs so it does not read as dead air. */
export const MOTION_EFFECTS = [...EASING_EFFECTS];

/** How many photographs a scene will take out of the pool. The one function that knows,
 *  so the shot list, the budget and the assignment cannot disagree about it. */
export function photoDemand(scene, library) {
  if (!scene?.effect) return 0;
  if (scene.effect === "video_background") return 0;
  if (scene.effect === "layer_scene") {
    const layout = (library?.layouts || []).find((l) => l.id === scene.layout);
    return layout?.photoSlots?.length || 0;
  }
  if (MONTAGE_EFFECTS.has(scene.effect)) {
    const declared = (scene.photoSlots || []).reduce((n, s) => n + (s.count || 1), 0);
    return Math.min(MONTAGE_MAX[scene.effect], declared || MONTAGE_MIN[scene.effect]);
  }
  return 1; // every single-photo effect, plus mask_reveal
}

/** Layout ids grouped by how many photographs they consume. */
export function layoutsByPhotoCount(library) {
  const buckets = new Map();
  for (const l of library?.layouts || []) {
    const n = (l.photoSlots || []).length;
    if (!buckets.has(n)) buckets.set(n, []);
    buckets.get(n).push(l.id);
  }
  return buckets;
}

/**
 * The engine's vocabulary, written for a reader who has never seen the code — this is
 * what goes into the director's prompt.
 *
 * It is DERIVED, so it cannot describe an engine we do not have. A hand-written capability
 * doc drifts the first time someone adds an effect and forgets the doc; this one throws.
 */
export function describeCapabilities({ library, assets = {} } = {}) {
  const buckets = layoutsByPhotoCount(library);
  const haveMask = fs.existsSync(path.resolve(root, SPECIAL.mask_reveal.asset));

  return {
    singlePhotoEffects: Object.entries(SINGLE).map(([id, m]) => ({
      id,
      photos: 1,
      moves: m.motion,
      note: m.hint,
    })),
    ...(haveMask ? { maskEffect: { id: "mask_reveal", photos: 1, note: SPECIAL.mask_reveal.hint } } : {}),
    montageEffects: Object.entries(MONTAGE).map(([id, m]) => ({
      id,
      photos: `${m.min}-${m.max}`,
      note: m.hint,
    })),
    layoutScenes: {
      effect: "layer_scene",
      note: SPECIAL.layer_scene.hint,
      layouts: (library?.layouts || []).map((l) => ({
        id: l.id,
        photos: (l.photoSlots || []).length,
        textSlots: (l.textSlots || []).map((t) => t.id),
      })),
      photoCountsAvailable: [...buckets.keys()].sort((a, b) => a - b),
    },
    transitions: ALL_TRANSITIONS,
    colorCurves: ALL_CURVES,
    themes: Object.keys(library?.designTokens?.themes || {}),
    ...(assets.overlays ? { overlays: assets.overlays } : {}),
    guidance: [
      "A film that uses one effect and three layouts on rotation looks cheap, however good the photographs are. Vary the treatment.",
      "photoBudget = musicSeconds / photoCount is the number that governs everything. When it is high (>6s), each photograph must carry a long hold — choose effects that MOVE (slow_zoom_in, ken-burns, pans), because a static frame held for 8 seconds is dead air.",
      "When the budget is low (<3s), single-photo scenes waste the set — lean on montages, which spend many photographs in one beat.",
      "layer_scene is the only effect that can show TEXT. Use it for the opening, the closing and a few punctuation beats — not for the whole film.",
    ],
  };
}
