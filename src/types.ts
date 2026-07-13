// Core domain types for the wedding render engine.
// Timeline JSON is the "contract"; these types are its canonical, normalized shape.

export type EffectPreset =
  | "still"
  | "slow_zoom_in"
  | "slow_zoom_out"
  | "pan_left"
  | "pan_right"
  | "pan_up"
  | "pan_down"
  | "kenburns_tl"
  | "kenburns_tr"
  | "kenburns_bl"
  | "kenburns_br"
  | "portrait_blur_background"
  | "polaroid"
  | "circle_focus"
  | "memory_wall"
  | "dark_feather"
  | "film_roll_up"
  | "film_roll_left"
  | "film_roll_right"
  | "video_background"
  | "collage_grid"
  | "double_exposure"
  | "mask_reveal"
  | "layer_scene";

// Canonical transition names (timeline-facing) -> ffmpeg xfade transition names.
// One source of truth: validation derives its enum from these keys and the
// command builder derives the xfade argument from the values.
export const XFADE_BY_TRANSITION = {
  crossfade: "fade",
  fade_fast: "fadefast",
  fade_slow: "fadeslow",
  fade_to_black: "fadeblack",
  fade_to_white: "fadewhite",
  fade_grays: "fadegrays",
  dissolve: "dissolve",
  pixelize: "pixelize",
  radial: "radial",
  distance: "distance",
  blur: "hblur",
  zoom_in: "zoomin",
  wipe_left: "wipeleft",
  wipe_right: "wiperight",
  wipe_up: "wipeup",
  wipe_down: "wipedown",
  wipe_tl: "wipetl",
  wipe_tr: "wipetr",
  wipe_bl: "wipebl",
  wipe_br: "wipebr",
  slide_left: "slideleft",
  slide_right: "slideright",
  slide_up: "slideup",
  slide_down: "slidedown",
  smooth_left: "smoothleft",
  smooth_right: "smoothright",
  smooth_up: "smoothup",
  smooth_down: "smoothdown",
  circle_open: "circleopen",
  circle_close: "circleclose",
  circle_crop: "circlecrop",
  rect_crop: "rectcrop",
  horz_open: "horzopen",
  horz_close: "horzclose",
  vert_open: "vertopen",
  vert_close: "vertclose",
  diag_tl: "diagtl",
  diag_tr: "diagtr",
  diag_bl: "diagbl",
  diag_br: "diagbr",
  slice_left: "hlslice",
  slice_right: "hrslice",
  slice_up: "vuslice",
  slice_down: "vdslice",
  wind_left: "hlwind",
  wind_right: "hrwind",
  wind_up: "vuwind",
  wind_down: "vdwind",
  cover_left: "coverleft",
  cover_right: "coverright",
  cover_up: "coverup",
  cover_down: "coverdown",
  reveal_left: "revealleft",
  reveal_right: "revealright",
  reveal_up: "revealup",
  reveal_down: "revealdown",
  squeeze_h: "squeezeh",
  squeeze_v: "squeezev",
} as const;

export type TransitionType = "none" | keyof typeof XFADE_BY_TRANSITION;

export const TRANSITION_TYPES = [
  "none",
  ...Object.keys(XFADE_BY_TRANSITION),
] as [TransitionType, ...TransitionType[]];

// Easing variants for the zoompan motion presets (zoom/pan/kenburns only).
// Omitted = the house smoothstep. gentle = smootherstep (calm, emotional
// slides) · snap = fast ease-out (party/peak beats) · bounce = small overshoot
// that settles back (use on at most 1-2 slides per video).
export const MOTION_EASINGS = ["gentle", "snap", "bounce"] as const;

export type MotionEasing = (typeof MOTION_EASINGS)[number];

/** Effects whose motion is driven by zoompan — the only ones `easing` applies to. */
export const EASED_MOTION_EFFECTS: ReadonlySet<string> = new Set([
  "slow_zoom_in",
  "slow_zoom_out",
  "pan_left",
  "pan_right",
  "pan_up",
  "pan_down",
  "kenburns_tl",
  "kenburns_tr",
  "kenburns_bl",
  "kenburns_br",
]);

export type CaptionPosition = "bottom_center" | "center" | "top_center" | "none";

export type CaptionRole = "title" | "subtitle" | "caption";

export type CaptionAnimation = "fade" | "slide_up" | "none";

export interface ProjectConfig {
  name: string;
  width: number;
  height: number;
  fps: number;
  quality: QualityPreset;
}

export type QualityPreset = "draft" | "share" | "high" | "master";

// ffmpeg `curves` filter presets.
export const CURVES_PRESETS = [
  "color_negative",
  "cross_process",
  "darker",
  "increase_contrast",
  "lighter",
  "linear_contrast",
  "medium_contrast",
  "negative",
  "strong_contrast",
  "vintage",
] as const;

export type CurvesPreset = (typeof CURVES_PRESETS)[number];

/**
 * Color grade. Set globally on the timeline (`color`) and/or per slide
 * (`slides[].color`); per-slide fields override the global ones.
 */
export interface ColorGrade {
  brightness?: number; // -1..1, 0 = unchanged
  contrast?: number; // 0..3, 1 = unchanged
  saturation?: number; // 0..3, 1 = unchanged
  gamma?: number; // 0.1..10, 1 = unchanged
  curves?: CurvesPreset; // tone-curve look
  lut?: string; // path to a .cube 3D LUT (relative to project)
  vignette?: boolean | number; // true = default; number = angle in radians
  sharpen?: number; // 0..2 -> unsharp amount
  blur?: number; // gblur sigma (soft-focus look)
  temperature?: number; // color temperature in Kelvin (6500 = neutral, lower = warmer)
  glow?: number; // 0..1 -> dreamy bloom (blurred screen-blend over itself)
  grain?: number; // 0..30 -> animated film grain (noise strength)
  flicker?: number; // 0..1 -> analog exposure flicker (Super-8 luma pulse)
  letterbox?: boolean | number; // cinematic bars; true = 2.39:1, number = target aspect
}

export interface MusicTrack {
  path: string;
  volume: number; // per-track gain 0..1
  start?: number; // optional source offset in seconds
  end?: number; // optional source end in seconds
}

export interface AudioAutomationPoint {
  at: number; // seconds into the final video
  volume: number; // 0..2 — master music gain from this point (linear ramp between points)
}

export interface VoiceoverConfig {
  path: string;
  start: number; // seconds into the final video, default 0
  volume: number; // default 1
  ducking: boolean; // sidechain-compress the music under the voice, default true
}

/** Master audio behavior; every field has a default so the block is optional. */
export interface AudioConfig {
  fade_in: number; // seconds, default 2
  fade_out: number; // seconds, default 2
  crossfade: number; // seconds between playlist tracks, default 2
  automation?: AudioAutomationPoint[]; // master volume envelope
  voiceover?: VoiceoverConfig;
}

export interface OutputConfig {
  path: string;
}

export interface Transition {
  type: TransitionType;
  duration: number;
}

export interface Caption {
  text: string;
  role: CaptionRole; // default "caption"; presets the font size
  position: CaptionPosition;
  start: number;
  duration: number;
  font?: string; // path to a .ttf/.otf (relative to project); default CAPTION_FONT env or Arial
  size?: number; // px override; default derived from role and frame height
  color: string; // named color or #rrggbb; default "white"
  outline?: { color: string; width: number }; // drawtext border
  shadow: boolean; // soft dark drop shadow; default true
  animation: CaptionAnimation; // default "fade"
}

export type SceneLayerType = "image" | "rect" | "text";

export type LayerFit = "cover" | "contain" | "stretch";

export type LayerAnimation =
  | "none"
  | "fade"
  | "slide_up"
  | "slide_down"
  | "slide_left"
  | "slide_right";

// Continuous Ken-Burns motion on an image layer, running over the whole slide.
export type LayerMotion =
  | "none"
  | "zoom_in"
  | "zoom_out"
  | "pan_left"
  | "pan_right"
  | "pan_up"
  | "pan_down";

/** Card treatment for an image layer: rounded corners, matte border, drop shadow. */
export interface LayerFrame {
  radius?: number; // rounded-corner radius in px
  border?: number; // white matte border thickness in px
  borderColor?: string; // default "white"
  shadow?: boolean; // soft drop shadow behind the card
}

export interface BaseSceneLayer {
  id?: string;
  type: SceneLayerType;
  x: number;
  y: number;
  width: number;
  height: number;
  opacity: number;
  rotation?: number; // degrees
  start: number;
  duration?: number;
  animation: LayerAnimation;
}

export interface ImageSceneLayer extends BaseSceneLayer {
  type: "image";
  path: string;
  fit: LayerFit;
  motion?: LayerMotion; // continuous Ken-Burns zoom/pan
  motionStrength?: number; // 0.01..0.12 travel/zoom amount
  easing?: MotionEasing;
  technicalColor?: TechnicalColor;
  frame?: LayerFrame; // rounded/bordered/shadowed card
  focusX?: number; // 0..1 cover-crop focal point (default 0.5 = center)
  focusY?: number; // 0..1
}

export interface TechnicalColor { brightness: number; saturation: number; redBalance: number; blueBalance: number; }

export interface RectSceneLayer extends BaseSceneLayer {
  type: "rect";
  color: string;
}

export interface TextSceneLayer extends BaseSceneLayer {
  type: "text";
  text: string;
  font?: string;
  size: number;
  color: string;
  align: "left" | "center" | "right";
  lineSpacing?: number;
  letterSpacing?: number;
  wrap?: boolean; // auto-wrap text to the layer width at compile time
}

export type SceneLayer = ImageSceneLayer | RectSceneLayer | TextSceneLayer;

export type OverlayPosition =
  | "top_left"
  | "top_right"
  | "bottom_left"
  | "bottom_right"
  | "center"
  | "fullscreen";

export type OverlayBlend = "alpha" | "screen" | "add";

// Bundled analog light-leak loops (overlays/light_leak_<variant>.mp4). An
// overlay may name one via `variant` instead of `path`; normalization resolves
// it and defaults blend to "screen" and opacity to 0.6.
export const LIGHT_LEAK_VARIANTS = ["warm", "soft", "sunset"] as const;

export type LightLeakVariant = (typeof LIGHT_LEAK_VARIANTS)[number];

/** Timeline-relative path of a bundled light-leak asset. */
export function lightLeakAssetPath(variant: LightLeakVariant): string {
  return `overlays/light_leak_${variant}.mp4`;
}

/**
 * A visual layered over the whole slideshow: logo, watermark, decorative PNG
 * frame, or a particle/bokeh/light-leak video loop. Images use their alpha
 * channel (blend "alpha"); black-background loops composite with blend
 * "screen" (or the hotter "add").
 */
export interface Overlay {
  path: string; // .png/.jpg = image; .mp4/.mov/.webm = looping video
  variant?: LightLeakVariant; // bundled light leak; alternative to `path`
  position: OverlayPosition; // default "fullscreen"
  scale?: number; // overlay width as a fraction of frame width (ignored for fullscreen)
  opacity: number; // 0..1, default 1
  margin: number; // px inset for corner positions, default 40
  blend: OverlayBlend; // default "alpha"
  start: number; // seconds into the final video, default 0
  end?: number; // default: video end
}

export interface Slide {
  id: string;
  image?: string;
  images?: string[];
  background?: string;
  mask?: string; // grayscale reveal video for mask_reveal (white = photo shows)
  layers?: SceneLayer[];
  duration: number;
  effect: EffectPreset;
  easing?: MotionEasing; // zoom/pan/kenburns effects only; default smoothstep
  transition: Transition;
  captions: Caption[]; // normalize folds a legacy single `caption` into this
  color?: ColorGrade; // per-slide grade, merged over the timeline-level one
  technicalColor?: TechnicalColor;
}

export interface Timeline {
  project: ProjectConfig;
  music: MusicTrack[]; // playlist; normalize wraps a legacy single object
  audio: AudioConfig;
  output: OutputConfig;
  color?: ColorGrade; // global grade applied to every slide
  overlays: Overlay[]; // layered over the combined video, in order
  slides: Slide[];
}

// ---- Render plan: the concrete work the engine will execute ----

/** A caption with its temp text file and font resolved to absolute paths. */
export interface CompiledCaption extends Caption {
  textFile: string; // absolute path to the UTF-8 file drawtext reads
  fontFile: string; // absolute path to the font actually used
}

export interface CompiledBaseSceneLayer extends BaseSceneLayer {
  end: number;
}

export interface CompiledImageSceneLayer extends CompiledBaseSceneLayer {
  type: "image";
  path: string;
  absPath: string;
  fit: LayerFit;
  motion?: LayerMotion;
  motionStrength?: number;
  easing?: MotionEasing;
  technicalColor?: TechnicalColor;
  frame?: LayerFrame;
  focusX?: number;
  focusY?: number;
}

export interface CompiledRectSceneLayer extends CompiledBaseSceneLayer {
  type: "rect";
  color: string;
}

export interface CompiledTextSceneLayer extends CompiledBaseSceneLayer {
  type: "text";
  text: string;
  textFile: string;
  fontFile: string;
  size: number;
  color: string;
  align: "left" | "center" | "right";
  lineSpacing?: number;
  letterSpacing?: number;
}

export type CompiledSceneLayer =
  | CompiledImageSceneLayer
  | CompiledRectSceneLayer
  | CompiledTextSceneLayer;

export interface RenderSlideStep {
  type: "render_slide";
  slideId: string;
  input: string; // absolute path to source image
  inputs: string[]; // absolute paths; film_roll_up uses multiple images
  mask?: string; // absolute path to the reveal-mask video (mask_reveal only)
  layers: CompiledSceneLayer[];
  output: string; // absolute path to temp slide video
  duration: number;
  effect: EffectPreset; // the preset actually rendered (may differ from requested)
  requestedEffect: EffectPreset; // what the timeline asked for
  easing?: MotionEasing; // motion easing for zoompan effects; default smoothstep
  autoPortrait: boolean; // true when a portrait image was rerouted to blur-bg
  transition: Transition; // how this slide transitions INTO the next one
  captions: CompiledCaption[]; // baked into the slide video via drawtext
  color?: ColorGrade; // merged global+slide grade; lut resolved to absolute path
  technicalColor?: TechnicalColor;
  srcWidth?: number; // intrinsic image width (undefined if unreadable)
  srcHeight?: number; // intrinsic image height
  width: number; // output frame width
  height: number; // output frame height
  fps: number;
  quality: import("./quality").QualityProfile;
}

/** Overlay with its asset resolved to an absolute path and kind detected. */
export interface CompiledOverlay extends Overlay {
  absPath: string;
  isVideo: boolean; // video assets loop; images display statically
}

export interface RenderPlan {
  project: ProjectConfig;
  quality: import("./quality").QualityProfile;
  steps: RenderSlideStep[];
  overlays: CompiledOverlay[];
  finalOutput: string; // absolute path
  /** Present only when the timeline declares at least one music track. */
  audio?: {
    tracks: MusicTrack[]; // absolute paths
    fadeIn: number;
    fadeOut: number;
    crossfade: number;
    automation?: AudioAutomationPoint[];
    voiceover?: VoiceoverConfig; // absolute path
  };
}
