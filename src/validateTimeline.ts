import path from "node:path";
import { z } from "zod";
import { fileExists, ValidationError } from "./fileUtils";
import {
  CURVES_PRESETS,
  EASED_MOTION_EFFECTS,
  lightLeakAssetPath,
  LIGHT_LEAK_VARIANTS,
  MOTION_EASINGS,
  TRANSITION_TYPES,
} from "./types";
import type { Timeline } from "./types";

const colorGradeSchema = z.object({
  brightness: z.number().min(-1).max(1).optional(),
  contrast: z.number().min(0).max(3).optional(),
  saturation: z.number().min(0).max(3).optional(),
  gamma: z.number().min(0.1).max(10).optional(),
  curves: z.enum(CURVES_PRESETS).optional(),
  lut: z.string().min(1).optional(),
  vignette: z.union([z.boolean(), z.number().min(0).max(Math.PI)]).optional(),
  sharpen: z.number().min(0).max(2).optional(),
  blur: z.number().min(0).max(50).optional(),
  temperature: z.number().min(1000).max(40000).optional(),
  glow: z.number().min(0).max(1).optional(),
  grain: z.number().min(0).max(30).optional(),
  flicker: z.number().min(0).max(1).optional(),
  letterbox: z.union([z.boolean(), z.number().min(1).max(4)]).optional(),
});
const technicalColorSchema = z.object({ brightness: z.number().min(-0.12).max(0.12), saturation: z.number().min(0.9).max(1.1), redBalance: z.number().min(-0.08).max(0.08), blueBalance: z.number().min(-0.08).max(0.08) });
const tiltShiftSchema = z.object({
  focusY: z.number().min(0).max(1),
  bandHeight: z.number().min(0.05).max(0.8),
  blur: z.number().min(1).max(40),
});

// ---- Structural schema (Zod). Runs on the already-normalized timeline. ----

const effectEnum = z.enum([
  "still",
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
  "portrait_blur_background",
  "polaroid",
  "circle_focus",
  "memory_wall",
  "dark_feather",
  "film_roll_up",
  "film_roll_left",
  "film_roll_right",
  "video_background",
  "collage_grid",
  "double_exposure",
  "mask_reveal",
  "tilt_shift",
  "dream_glow",
  "prism_split",
  "spotlight_focus",
  "mirror_split",
  "layer_scene",
]);

const transitionTypeEnum = z.enum(TRANSITION_TYPES);

const positionEnum = z.enum(["bottom_center", "center", "top_center", "none"]);

const captionSchema = z.object({
  text: z.string(),
  role: z.enum(["title", "subtitle", "caption"]),
  position: positionEnum,
  start: z.number().min(0),
  duration: z.number().min(0),
  font: z.string().min(1).optional(),
  size: z.number().int().positive().optional(),
  color: z.string().min(1),
  outline: z
    .object({ color: z.string().min(1), width: z.number().min(0).max(20) })
    .optional(),
  shadow: z.boolean(),
  animation: z.enum(["fade", "slide_up", "none"]),
});

const baseLayerSchema = {
  id: z.string().min(1).optional(),
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
  opacity: z.number().min(0).max(1).default(1),
  rotation: z.number().min(-360).max(360).optional(),
  start: z.number().min(0).default(0),
  duration: z.number().min(0).optional(),
  animation: z
    .enum(["none", "fade", "slide_up", "slide_down", "slide_left", "slide_right"])
    .default("none"),
};

const layerSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image"),
    path: z.string().min(1),
    fit: z.enum(["cover", "contain", "stretch"]).default("cover"),
    motion: z
      .enum(["none", "zoom_in", "zoom_out", "pan_left", "pan_right", "pan_up", "pan_down"])
      .optional(),
    motionStrength: z.number().min(0.01).max(0.12).optional(),
    easing: z.enum(MOTION_EASINGS).optional(),
    technicalColor: technicalColorSchema.optional(),
    frame: z
      .object({
        radius: z.number().min(0).max(400).optional(),
        border: z.number().min(0).max(200).optional(),
        borderColor: z.string().min(1).optional(),
        shadow: z.boolean().optional(),
      })
      .optional(),
    focusX: z.number().min(0).max(1).optional(),
    focusY: z.number().min(0).max(1).optional(),
    ...baseLayerSchema,
  }),
  z.object({
    type: z.literal("rect"),
    color: z.string().min(1),
    ...baseLayerSchema,
  }),
  z.object({
    type: z.literal("text"),
    text: z.string(),
    font: z.string().min(1).optional(),
    size: z.number().int().positive(),
    color: z.string().min(1),
    align: z.enum(["left", "center", "right"]).default("left"),
    lineSpacing: z.number().positive().optional(),
    letterSpacing: z.number().optional(),
    wrap: z.boolean().optional(),
    ...baseLayerSchema,
  }),
]);

const timelineSchema = z.object({
  project: z.object({
    name: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fps: z.number().int().positive(),
    quality: z.enum(["draft", "share", "high", "master"]),
  }),
  music: z.array(
    z.object({
      path: z.string().min(1),
      volume: z.number().min(0).max(1),
      start: z.number().min(0).optional(),
      end: z.number().positive().optional(),
    })
  ),
  audio: z.object({
    fade_in: z.number().min(0).max(30),
    fade_out: z.number().min(0).max(30),
    crossfade: z.number().min(0).max(30),
    automation: z
      .array(
        z.object({
          at: z.number().min(0),
          volume: z.number().min(0).max(2),
        })
      )
      .optional(),
    voiceover: z
      .object({
        path: z.string().min(1),
        start: z.number().min(0),
        volume: z.number().min(0).max(2),
        ducking: z.boolean(),
      })
      .optional(),
  }),
  output: z.object({
    path: z.string().min(1),
  }),
  color: colorGradeSchema.optional(),
  overlays: z.array(
    z.object({
      path: z.string().min(1),
      variant: z.enum(LIGHT_LEAK_VARIANTS).optional(),
      position: z.enum([
        "top_left",
        "top_right",
        "bottom_left",
        "bottom_right",
        "center",
        "fullscreen",
      ]),
      scale: z.number().min(0.01).max(1).optional(),
      opacity: z.number().min(0).max(1),
      margin: z.number().min(0).max(500),
      blend: z.enum(["alpha", "screen", "add"]),
      start: z.number().min(0),
      end: z.number().positive().optional(),
    })
  ),
  slides: z
    .array(
      z.object({
        id: z.string().min(1),
        image: z.string().min(1).optional(),
        images: z.array(z.string().min(1)).optional(),
        background: z.string().min(1).optional(),
        mask: z.string().min(1).optional(),
        layers: z.array(layerSchema).optional(),
        duration: z.number().min(2).max(30),
        effect: effectEnum,
        easing: z.enum(MOTION_EASINGS).optional(),
        transition: z.object({
          type: transitionTypeEnum,
          duration: z.number().min(0).max(2),
        }),
        captions: z.array(captionSchema),
        color: colorGradeSchema.optional(),
        technicalColor: technicalColorSchema.optional(),
        tiltShift: tiltShiftSchema.optional(),
      })
    )
    .min(1, "timeline must contain at least one slide"),
});

/**
 * Validate a normalized timeline. Runs Zod (structure) then semantic checks
 * (unique ids, cross-field durations, file existence). Throws ValidationError
 * with a human-readable, multi-line message listing every problem found.
 */
export function validateTimeline(normalized: unknown, baseDir: string): Timeline {
  const parsed = timelineSchema.safeParse(normalized);
  if (!parsed.success) {
    const lines = parsed.error.issues.map(
      (i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`
    );
    throw new ValidationError(
      "Timeline schema errors:\n" + lines.join("\n")
    );
  }

  const timeline = parsed.data as Timeline;
  const errors: string[] = [];

  // Every declared music track (and the voiceover) must exist.
  for (const [ti, track] of timeline.music.entries()) {
    if (!fileExists(path.resolve(baseDir, track.path))) {
      errors.push(`music[${ti}] not found: ${track.path}`);
    }
  }
  if (timeline.audio.voiceover) {
    const vo = timeline.audio.voiceover;
    if (!fileExists(path.resolve(baseDir, vo.path))) {
      errors.push(`audio.voiceover not found: ${vo.path}`);
    }
  }
  if (timeline.audio.automation) {
    const pts = timeline.audio.automation;
    for (let i = 1; i < pts.length; i++) {
      if (pts[i].at <= pts[i - 1].at) {
        errors.push(
          `audio.automation must be sorted by ascending "at" ` +
            `(point ${i}: ${pts[i].at} <= ${pts[i - 1].at})`
        );
        break;
      }
    }
  }

  // LUT files must exist wherever a grade declares one.
  const luts = [
    ...(timeline.color?.lut ? [["timeline", timeline.color.lut] as const] : []),
    ...timeline.slides
      .filter((s) => s.color?.lut)
      .map((s) => [`slide ${s.id}`, s.color!.lut!] as const),
  ];
  for (const [where, lut] of luts) {
    if (!fileExists(path.resolve(baseDir, lut))) {
      errors.push(`${where} color.lut not found: ${lut}`);
    }
  }

  for (const [oi, ov] of timeline.overlays.entries()) {
    if (!fileExists(path.resolve(baseDir, ov.path))) {
      errors.push(`overlays[${oi}] file not found: ${ov.path}`);
    }
    // Normalization only fills `path` from `variant` when path was absent, so
    // a mismatch here means the author set both.
    if (ov.variant && ov.path !== lightLeakAssetPath(ov.variant)) {
      errors.push(
        `overlays[${oi}] set either path or variant, not both ` +
          `(variant ${ov.variant} resolves to ${lightLeakAssetPath(ov.variant)})`
      );
    }
    if (ov.end !== undefined && ov.end <= ov.start) {
      errors.push(`overlays[${oi}] end (${ov.end}) must be after start (${ov.start})`);
    }
  }

  const seenIds = new Set<string>();
  for (const slide of timeline.slides) {
    if (seenIds.has(slide.id)) {
      errors.push(`duplicate slide id: ${slide.id}`);
    }
    seenIds.add(slide.id);

    if (slide.effect === "layer_scene") {
      if (!slide.layers || slide.layers.length < 1) {
        errors.push(`slide ${slide.id} layer_scene requires layers`);
      }
    } else if (slide.effect === "memory_wall") {
      if (!slide.images || slide.images.length < 1 || slide.images.length > 5) {
        errors.push(`slide ${slide.id} memory_wall requires images with 1 to 5 files`);
      }
    } else if (isMultiImageEffect(slide.effect)) {
      if (!slide.images || slide.images.length < 2) {
        errors.push(`slide ${slide.id} ${slide.effect} requires images with at least 2 files`);
      }
    } else if (slide.effect === "video_background") {
      if (!slide.background) {
        errors.push(`slide ${slide.id} video_background requires background`);
      }
    } else if (slide.effect === "mask_reveal") {
      if (!slide.image) {
        errors.push(`slide ${slide.id} image is required for effect mask_reveal`);
      }
      if (!slide.mask) {
        errors.push(
          `slide ${slide.id} mask_reveal requires mask (grayscale reveal video, e.g. assets/masks/particle_gather.mp4)`
        );
      }
    } else if (!slide.image) {
      errors.push(`slide ${slide.id} image is required for effect ${slide.effect}`);
    }

    const imagePaths = isMultiImageEffect(slide.effect)
      ? slide.images ?? []
      : slide.image
        ? [slide.image]
        : [];
    for (const imagePath of imagePaths) {
      const abs = path.resolve(baseDir, imagePath);
      if (!fileExists(abs)) {
        errors.push(`slide ${slide.id} image not found: ${imagePath}`);
      }
    }
    if (slide.mask && !fileExists(path.resolve(baseDir, slide.mask))) {
      errors.push(`slide ${slide.id} mask not found: ${slide.mask}`);
    }
    if (slide.background && !fileExists(path.resolve(baseDir, slide.background))) {
      errors.push(`slide ${slide.id} background not found: ${slide.background}`);
    }

    for (const [li, layer] of (slide.layers ?? []).entries()) {
      const layerEnd = layer.start + (layer.duration ?? slide.duration - layer.start);
      if (layerEnd > slide.duration) {
        errors.push(
          `slide ${slide.id} layers[${li}] exceeds slide duration ` +
            `(start ${layer.start} + duration ${layer.duration} > ${slide.duration})`
        );
      }
      if (layer.type === "image" && !fileExists(path.resolve(baseDir, layer.path))) {
        errors.push(`slide ${slide.id} layers[${li}] image not found: ${layer.path}`);
      }
      if (layer.type === "text" && layer.font && !fileExists(path.resolve(baseDir, layer.font))) {
        errors.push(`slide ${slide.id} layers[${li}] font not found: ${layer.font}`);
      }
    }

    if (slide.easing && !EASED_MOTION_EFFECTS.has(slide.effect)) {
      errors.push(
        `slide ${slide.id} easing "${slide.easing}" only applies to ` +
          `zoom/pan/kenburns effects (got "${slide.effect}")`
      );
    }

    if (slide.tiltShift && slide.effect !== "tilt_shift") {
      errors.push(
        `slide ${slide.id} tiltShift only applies to effect tilt_shift ` +
          `(got "${slide.effect}")`
      );
    }

    if (slide.transition.duration >= slide.duration) {
      errors.push(
        `slide ${slide.id} transition.duration (${slide.transition.duration}) ` +
          `must be shorter than slide duration (${slide.duration})`
      );
    }

    for (const [ci, cap] of slide.captions.entries()) {
      const end = cap.start + cap.duration;
      if (end > slide.duration) {
        errors.push(
          `slide ${slide.id} captions[${ci}] exceeds slide duration ` +
            `(start ${cap.start} + duration ${cap.duration} > ${slide.duration})`
        );
      }
      if (cap.font) {
        const fontAbs = path.resolve(baseDir, cap.font);
        if (!fileExists(fontAbs)) {
          errors.push(`slide ${slide.id} captions[${ci}] font not found: ${cap.font}`);
        }
      }
    }
  }

  if (errors.length > 0) {
    throw new ValidationError(
      "Timeline validation failed:\n" + errors.map((e) => `  - ${e}`).join("\n")
    );
  }

  return timeline;
}

function isMultiImageEffect(effect: string): boolean {
  return (
    effect === "film_roll_up" ||
    effect === "film_roll_left" ||
    effect === "film_roll_right" ||
    effect === "collage_grid" ||
    effect === "double_exposure" ||
    effect === "memory_wall"
  );
}
