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
// film is made of — knew about exactly two effects. The engine has 29. So premium
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
export const ALL_REMOTION_TEMPLATES = schema.$defs.remotionTemplate.enum;
export const ALL_BLENDER_TEMPLATES = schema.$defs.blenderTemplate.enum;

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
  portrait_reflection: { motion: false, hint: "bright studio portrait with a soft floor reflection; elegant and face-safe" },
  floating_card_gallery: { motion: true, hint: "three layered photo cards drift at different depths; an airy dimensional gallery" },
  moving_background_echo: { motion: true, hint: "sharp center portrait with blurred copies drifting behind it" },
  panel_flip: { motion: true, hint: "photo panel closes to an edge and opens again like an album leaf" },
  polaroid: { motion: false, hint: "photo as a physical print; nostalgic, keepsake feel" },
  circle_focus: { motion: false, hint: "vignette to a circle; intimate, draws to a detail" },
  dark_feather: { motion: false, hint: "feathered dark vignette; cinematic, good under a subtitle" },
  tilt_shift: { motion: false, hint: "sharp horizontal focus band over a blurred frame; miniature/dreamlike emphasis" },
  dream_glow: { motion: false, hint: "soft Orton-style bloom blended over the original; romantic and luminous" },
  prism_split: { motion: false, hint: "offset red/blue channels; modern prism and chromatic-fringe accent" },
  spotlight_focus: { motion: false, hint: "strong optical vignette centered slightly high; directs attention to a subject" },
  mirror_split: { motion: false, hint: "symmetrical mirrored split; graphic editorial beat for details or dance scenes" },
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
  photo_strip_up: { slot: "film_roll", min: 4, max: 12, hint: "borderless connected photos scroll vertically; position left, center or right beside a hero background" },
  photo_strip_left: { slot: "film_roll", min: 4, max: 12, hint: "borderless connected photos scroll left over a hero background" },
  photo_strip_right: { slot: "film_roll", min: 4, max: 12, hint: "borderless connected photos scroll right over a hero background" },
  double_exposure: { slot: "pair", min: 2, max: 2, hint: "two frames blended; dreamlike, use once or twice" },
};

/** Effects that are neither: they need an asset or a layout, so the composer treats them
 *  specially rather than drawing them from a palette. */
const SPECIAL = {
  layer_scene: { photos: "layout", hint: "a designed card: photos + text in a layout from layouts/library.json" },
  mask_reveal: { photos: 1, asset: "assets/masks/particle_gather.mp4", hint: "one photo revealed through a moving mask" },
  video_background: { photos: 0, asset: "scene.background", hint: "a stock video interlude; shows no photograph" },
};

/** GPU/3D scenes rendered by Remotion or Blender instead of native FFmpeg filters (see
 *  docs/HYBRID-RENDERER.md). They use `renderer`+`template`+`assets`, not `effect` — a
 *  structurally different shape, which is why they get their own table instead of a slot in
 *  SINGLE. `assets` is the minimum photo count the template needs; `cost` is why the director
 *  is told to spend these ONE at a time: Remotion templates render in seconds, but Blender's
 *  EEVEE templates take minutes per scene, not seconds — using several in one film the way a
 *  native effect gets reused would multiply a render job from minutes to hours by accident. */
const HYBRID = {
  // Remotion — renders in seconds, same order of magnitude as a native effect.
  title: { renderer: "remotion", assets: 1, cost: "fast", hint: "title/opening card: blurred full-bleed backdrop behind the sharp photo, caption fades in from params.title" },
  filmstrip: { renderer: "remotion", assets: 1, cost: "fast", hint: "endless scrolling filmstrip on a dashed film-reel background; give several assets for variety, one repeats" },
  page_flip: { renderer: "remotion", assets: 2, cost: "fast", hint: "a page turns to reveal the next photo, like an album leaf" },
  portrait_echo: { renderer: "remotion", assets: 1, cost: "fast", hint: "sharp centered portrait with blurred drifting echoes of itself behind" },
  triptych: { renderer: "remotion", assets: 3, cost: "fast", hint: "three photos side by side, each sliding gently into place" },
  card_gallery: { renderer: "remotion", assets: 3, cost: "fast", hint: "three photos fanned in 3D like cards on a table" },
  paper_peel: { renderer: "remotion", assets: 2, cost: "fast", hint: "the top photo peels away like paper to reveal the one beneath" },
  panel_reveal: { renderer: "remotion", assets: 1, cost: "fast", hint: "two panels slide open from the centre to reveal the photo" },
  floating_frame: { renderer: "remotion", assets: 1, cost: "fast", hint: "a framed photo floats and gently sways over its own blurred backdrop" },
  light_rays: { renderer: "remotion", assets: 1, cost: "fast", hint: "warm conic light rays pulse across the photo, like sun through a window" },
  gl_transition: { renderer: "remotion", assets: 2, cost: "fast", hint: "GPU shader wipe between two photos (heart/kaleidoscope/cube/doorway/circleopen/ripple/windowslice/DreamyZoom/FilmBurn/morph via params.name); needs a pair, not a single hero shot" },
  glass_frame: { renderer: "remotion", assets: 1, cost: "fast", hint: "glassmorphism reveal: frosted glass panel over a blurred backdrop, sharp photo inset, one light sweep" },
  confetti_bloom: { renderer: "remotion", assets: 1, cost: "fast", hint: "blush/ivory/gold/sage petals drift in from the edges and settle around the photo while the camera dollies in" },
  // Blender — a real headless render process per scene. page_flip_3d/camera_gallery_3d use
  // Workbench (fake studio shading, no lighting setup) and are noticeably slower than
  // Remotion but not minutes-slow; ring_spin_reveal/photo_frame_orbit use EEVEE for real
  // lighting/depth-of-field/bokeh and cost minutes per scene, not seconds.
  page_flip_3d: { renderer: "blender", assets: 2, cost: "slow", hint: "a real 3D page bends and turns to reveal the next photo" },
  camera_gallery_3d: { renderer: "blender", assets: 1, cost: "slow", hint: "camera dollies across a row of 3D photo tiles; more assets = a longer row" },
  ring_spin_reveal: { renderer: "blender", assets: 1, cost: "slow", hint: "3D gold ring with a glass gem spins in the foreground; camera racks focus back to the photo in soft bokeh — a wedding-ring / intro motif" },
  photo_frame_orbit: { renderer: "blender", assets: 1, cost: "slow", hint: "camera orbits a single hanging photo frame with warm bokeh lights defocused behind it — a gallery/hero moment" },
};

// The guarantee. An effect the engine accepts but nobody classified would be invisible to
// the director — exactly the failure this file exists to prevent. Extended to hybrid
// templates for the same reason: a template the renderers accept but this file does not
// describe is invisible to the director in exactly the same way an unclassified effect is.
const classified = new Set([...Object.keys(SINGLE), ...Object.keys(MONTAGE), ...Object.keys(SPECIAL)]);
const unclassified = ALL_EFFECTS.filter((e) => !classified.has(e));
if (unclassified.length) {
  throw new Error(
    `scripts/lib/engineCapabilities.mjs is out of date: the engine accepts ${unclassified.join(", ")}, ` +
      `but this file does not classify ${unclassified.length === 1 ? "it" : "them"}. ` +
      `Add ${unclassified.length === 1 ? "it" : "them"} to SINGLE, MONTAGE or SPECIAL so the AI director can use ${unclassified.length === 1 ? "it" : "them"}.`
  );
}
const classifiedHybrid = new Set(Object.keys(HYBRID));
const unclassifiedHybrid = [...ALL_REMOTION_TEMPLATES, ...ALL_BLENDER_TEMPLATES].filter((t) => !classifiedHybrid.has(t));
if (unclassifiedHybrid.length) {
  throw new Error(
    `scripts/lib/engineCapabilities.mjs is out of date: the renderers accept ${unclassifiedHybrid.join(", ")}, ` +
      `but this file does not classify ${unclassifiedHybrid.length === 1 ? "it" : "them"} in HYBRID. ` +
      `Add ${unclassifiedHybrid.length === 1 ? "it" : "them"} so the AI director can use ${unclassifiedHybrid.length === 1 ? "it" : "them"}.`
  );
}

export const HYBRID_TEMPLATES = new Set(Object.keys(HYBRID));
export const HYBRID_RENDERER = Object.fromEntries(Object.entries(HYBRID).map(([id, m]) => [id, m.renderer]));
export const HYBRID_ASSET_MIN = Object.fromEntries(Object.entries(HYBRID).map(([id, m]) => [id, m.assets]));
/** Hybrid templates that take exactly one photo — the ones a single existing scene can be
 *  substituted for without disturbing the shot list's photo count or duration. `gl_transition`
 *  needs a pair and is deliberately excluded: it stays reachable only by hand-authoring a
 *  timeline (see docs/HYBRID-RENDERER.md) until something teaches the composer to solve for
 *  a 2-photo hybrid beat. */
export const HYBRID_SIGNATURE_TEMPLATES = new Set(
  Object.entries(HYBRID).filter(([, m]) => m.assets === 1).map(([id]) => id)
);

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
    hybridScenes: Object.entries(HYBRID).map(([id, m]) => ({
      id,
      renderer: m.renderer,
      assets: m.assets,
      speed: m.cost === "slow" ? "slow — minutes per scene, not seconds" : "fast — seconds, like a native effect",
      note: m.hint,
    })),
    transitions: ALL_TRANSITIONS,
    colorCurves: ALL_CURVES,
    themes: Object.keys(library?.designTokens?.themes || {}),
    ...(assets.overlays ? { overlays: assets.overlays } : {}),
    guidance: [
      "A film that uses one effect and three layouts on rotation looks cheap, however good the photographs are. Vary the treatment.",
      "photoBudget = musicSeconds / photoCount is the number that governs everything. When it is high (>6s), each photograph must carry a long hold — choose effects that MOVE (slow_zoom_in, ken-burns, pans), because a static frame held for 8 seconds is dead air.",
      "When the budget is low (<3s), single-photo scenes waste the set — lean on montages, which spend many photographs in one beat.",
      "layer_scene is the only effect that can show TEXT. Use it for the opening, the closing and a few punctuation beats — not for the whole film.",
      "hybridScenes are GPU/3D, richer than anything native — but they are a SIGNATURE choice, not a palette member. signatureHybridScene may name AT MOST ONE id from hybridScenes whose assets=1 (it replaces one existing single-photo scene, so it cannot take a pair). Prefer a 'fast' one; a 'slow' (Blender) one costs minutes of render time, so only spend it on a moment that earns it. null is the right answer for most films.",
    ],
  };
}
