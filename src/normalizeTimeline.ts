import { lightLeakAssetPath, LIGHT_LEAK_VARIANTS, XFADE_BY_TRANSITION } from "./types";
import type { LightLeakVariant } from "./types";

// Normalize a raw timeline object BEFORE strict validation:
//  - map human/AI aliases to canonical preset names ("zoom in" -> "slow_zoom_in")
//  - fill in defaults for missing values
//
// Note on order: docs describe validate -> normalize, but normalizing first lets
// validation run against a single canonical shape (aliases already resolved).

const DEFAULTS = {
  width: 1920,
  height: 1080,
  fps: 30,
  volume: 0.8,
} as const;

const EFFECT_ALIASES: Record<string, string> = {
  still: "still",
  static: "still",
  none: "still",
  zoom_in: "slow_zoom_in",
  zoomin: "slow_zoom_in",
  slow_zoom_in: "slow_zoom_in",
  zoom_out: "slow_zoom_out",
  zoomout: "slow_zoom_out",
  slow_zoom_out: "slow_zoom_out",
  pan_left: "pan_left",
  pan_right: "pan_right",
  pan_up: "pan_up",
  pan_down: "pan_down",
  kenburns: "kenburns_br",
  ken_burns: "kenburns_br",
  kenburns_tl: "kenburns_tl",
  kenburns_tr: "kenburns_tr",
  kenburns_bl: "kenburns_bl",
  kenburns_br: "kenburns_br",
  zoom_pan: "kenburns_br",
  portrait: "portrait_blur_background",
  portrait_blur: "portrait_blur_background",
  portrait_blur_background: "portrait_blur_background",
  polaroid: "polaroid",
  polaroid_card: "polaroid",
  photo_card: "polaroid",
  instant_photo: "polaroid",
  circle_focus: "circle_focus",
  circle_frame: "circle_focus",
  circle_photo: "circle_focus",
  circle_mask: "circle_focus",
  memory_wall: "memory_wall",
  photo_scatter: "memory_wall",
  film_scatter: "memory_wall",
  timeline_wall: "memory_wall",
  dark_feather: "dark_feather",
  feather: "dark_feather",
  feathered_photo: "dark_feather",
  soft_frame: "dark_feather",
  film_roll: "film_roll_up",
  film_roll_up: "film_roll_up",
  film_roll_vertical: "film_roll_up",
  film_roll_left: "film_roll_left",
  film_roll_right: "film_roll_right",
  horizontal_film_roll: "film_roll_left",
  film_roll_horizontal: "film_roll_left",
  photo_roll: "film_roll_up",
  photo_film_roll: "film_roll_up",
  video_background: "video_background",
  background_video: "video_background",
  title_card: "video_background",
  intro_card: "video_background",
  collage: "collage_grid",
  collage_grid: "collage_grid",
  photo_grid: "collage_grid",
  double_exposure: "double_exposure",
  doubleexposure: "double_exposure",
  exposure_blend: "double_exposure",
  mask_reveal: "mask_reveal",
  reveal: "mask_reveal",
  particle_reveal: "mask_reveal",
  tilt_shift: "tilt_shift",
  tiltshift: "tilt_shift",
  miniature: "tilt_shift",
  dream_glow: "dream_glow",
  orton: "dream_glow",
  prism_split: "prism_split",
  chromatic_aberration: "prism_split",
  spotlight_focus: "spotlight_focus",
  spotlight: "spotlight_focus",
  mirror_split: "mirror_split",
  mirror: "mirror_split",
  layer_scene: "layer_scene",
  layers: "layer_scene",
  canva_scene: "layer_scene",
};

// Human/AI-friendly aliases -> canonical transition names. Canonical names
// themselves (see types.ts XFADE_BY_TRANSITION) pass through untouched below.
const TRANSITION_ALIASES: Record<string, string> = {
  hard: "none",
  cut: "none",
  fade: "crossfade",
  cross_fade: "crossfade",
  fadeblack: "fade_to_black",
  fadewhite: "fade_to_white",
  fadegrays: "fade_grays",
  grayscale: "fade_grays",
  wipe: "wipe_left",
  slide: "slide_left",
  smooth: "smooth_left",
  circle: "circle_open",
  zoom: "zoom_in",
  zoomin: "zoom_in",
  diagonal: "diag_tl",
  pixelate: "pixelize",
  mosaic: "pixelize",
  slice: "slice_left",
  wind: "wind_left",
  cover: "cover_left",
  reveal: "reveal_left",
  squeeze: "squeeze_h",
};

function canonicalKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_");
}

function isCanonicalTransition(key: string): boolean {
  return key === "none" || key in XFADE_BY_TRANSITION;
}

/** Returns a plain object ready for the Zod schema. Leaves unknown values as-is
 *  so validation (not normalization) is what rejects them with a clear message. */
export function normalizeTimeline(raw: any): any {
  const project = raw?.project ?? {};
  const normalizedProject = {
    name: project.name ?? "wedding",
    width: project.width ?? DEFAULTS.width,
    height: project.height ?? DEFAULTS.height,
    fps: project.fps ?? DEFAULTS.fps,
    quality: canonicalKey(project.quality ?? raw?.quality ?? "share"),
  };

  // Music accepts a single object (legacy) or a playlist array.
  const rawMusic = raw?.music;
  const musicList: any[] =
    rawMusic == null ? [] : Array.isArray(rawMusic) ? rawMusic : [rawMusic];
  const music = musicList.map((m: any) => ({
    path: m?.path,
    volume: m?.volume ?? DEFAULTS.volume,
    ...(m?.start != null ? { start: m.start } : {}),
    ...(m?.end != null ? { end: m.end } : {}),
  }));

  const slides = Array.isArray(raw?.slides)
    ? raw.slides.map((s: any) => normalizeSlide(s))
    : raw?.slides;

  const out: any = {
    project: normalizedProject,
    music,
    audio: normalizeAudio(raw?.audio),
    output: raw?.output ?? {},
    slides,
    overlays: Array.isArray(raw?.overlays)
      ? raw.overlays.map(normalizeOverlay)
      : [],
  };
  if (raw?.color != null) out.color = raw.color;
  return out;
}

function normalizeAudio(a: any): any {
  const out: any = {
    fade_in: a?.fade_in ?? 2,
    fade_out: a?.fade_out ?? 2,
    crossfade: a?.crossfade ?? 2,
  };
  if (Array.isArray(a?.automation)) {
    out.automation = a.automation.map((p: any) => ({
      at: p?.at,
      volume: p?.volume,
    }));
  }
  if (a?.voiceover != null) {
    out.voiceover = {
      path: a.voiceover.path,
      start: a.voiceover.start ?? 0,
      volume: a.voiceover.volume ?? 1,
      ducking: a.voiceover.ducking ?? true,
    };
  }
  return out;
}

function normalizeOverlay(o: any): any {
  // A bundled light leak: `variant` instead of `path`. Resolve the asset and
  // flip the defaults to what a leak wants (screen blend, restrained opacity).
  const variantKey = canonicalKey(o?.variant);
  const isLeak =
    variantKey !== "" &&
    (LIGHT_LEAK_VARIANTS as readonly string[]).includes(variantKey);
  const path =
    o?.path == null && isLeak
      ? lightLeakAssetPath(variantKey as LightLeakVariant)
      : o?.path;

  const out: any = {
    path,
    position: canonicalKey(o?.position) || "fullscreen",
    opacity: o?.opacity ?? (isLeak ? 0.6 : 1),
    margin: o?.margin ?? 40,
    blend: canonicalKey(o?.blend) || (isLeak ? "screen" : "alpha"),
    start: o?.start ?? 0,
  };
  if (o?.variant != null) out.variant = variantKey || o.variant;
  if (o?.scale != null) out.scale = o.scale;
  if (o?.end != null) out.end = o.end;
  return out;
}

function normalizeSlide(s: any): any {
  const effectKey = canonicalKey(s?.effect);
  const effect = EFFECT_ALIASES[effectKey] ?? s?.effect ?? "still";

  const rawTransition = s?.transition ?? {};
  const transitionKey = canonicalKey(rawTransition.type);
  const transitionType = isCanonicalTransition(transitionKey)
    ? transitionKey
    : TRANSITION_ALIASES[transitionKey] ?? rawTransition.type ?? "none";

  const transition = {
    type: transitionType,
    duration: rawTransition.duration ?? 0,
  };

  // Accept both `captions: [...]` and the legacy single `caption: {...}`.
  const rawCaptions: any[] = Array.isArray(s?.captions)
    ? s.captions
    : s?.caption != null
      ? [s.caption]
      : [];

  // memory_wall works from 1 photo up, so a lone `image` folds into `images`.
  const images =
    effect === "memory_wall" && !Array.isArray(s?.images) && s?.image
      ? [s.image]
      : s?.images;

  const out: any = {
    id: s?.id,
    image: s?.image,
    images,
    background: s?.background,
    mask: s?.mask,
    layers: Array.isArray(s?.layers) ? s.layers.map(normalizeLayer) : s?.layers,
    duration: s?.duration,
    effect,
    transition,
    captions: rawCaptions.map((c) => normalizeCaption(c, s?.duration)),
  };
  if (s?.easing != null) out.easing = canonicalKey(s.easing);
  if (s?.color != null) out.color = s.color;
  if (s?.technicalColor != null) out.technicalColor = s.technicalColor;
  if (effect === "tilt_shift") {
    out.tiltShift = {
      focusY: s?.tiltShift?.focusY ?? 0.5,
      bandHeight: s?.tiltShift?.bandHeight ?? 0.22,
      blur: s?.tiltShift?.blur ?? 14,
    };
  } else if (s?.tiltShift != null) {
    out.tiltShift = s.tiltShift;
  }
  return out;
}

function normalizeLayer(l: any): any {
  const type = canonicalKey(l?.type);
  const base: any = {
    id: l?.id,
    type,
    x: l?.x,
    y: l?.y,
    width: l?.width,
    height: l?.height,
    opacity: l?.opacity ?? 1,
    rotation: l?.rotation,
    start: l?.start ?? 0,
    duration: l?.duration,
    animation: canonicalKey(l?.animation) || "none",
  };

  if (type === "image") {
    return {
      ...base,
      path: l?.path,
      fit: canonicalKey(l?.fit) || "cover",
      motion: l?.motion,
      motionStrength: l?.motionStrength,
      easing: l?.easing,
      technicalColor: l?.technicalColor,
      frame: l?.frame,
      focusX: l?.focusX,
      focusY: l?.focusY,
    };
  }
  if (type === "rect") {
    return {
      ...base,
      color: l?.color ?? "black",
    };
  }
  if (type === "text") {
    return {
      ...base,
      text: l?.text,
      font: l?.font,
      size: l?.size,
      color: l?.color ?? "white",
      align: canonicalKey(l?.align) || "left",
      lineSpacing: l?.lineSpacing,
      letterSpacing: l?.letterSpacing,
      wrap: l?.wrap,
    };
  }
  return base;
}

function normalizeCaption(c: any, slideDuration: unknown): any {
  const out: any = {
    text: c?.text,
    role: canonicalKey(c?.role) || "caption",
    position: canonicalKey(c?.position) || "bottom_center",
    start: c?.start ?? 0,
    duration: c?.duration ?? slideDuration ?? 0,
    color: c?.color ?? "white",
    shadow: c?.shadow ?? true,
    animation: canonicalKey(c?.animation) || "fade",
  };
  if (c?.font != null) out.font = c.font;
  if (c?.size != null) out.size = c.size;
  if (c?.outline != null) {
    out.outline = {
      color: c.outline.color ?? "black",
      width: c.outline.width ?? 2,
    };
  }
  return out;
}
