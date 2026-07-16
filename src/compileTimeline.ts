import path from "node:path";
import { coverCropLoss, readImageSize } from "./imageSize";
import { resolveQualityProfile } from "./quality";
import type {
  CompiledCaption,
  CompiledSceneLayer,
  EffectPreset,
  RenderPlan,
  RenderSlideStep,
  Timeline,
} from "./types";

// Default font: overridable per caption (font field) or globally (CAPTION_FONT).
const DEFAULT_FONT = process.env.CAPTION_FONT || "C:/Windows/Fonts/arial.ttf";

// drawtext does not auto-wrap. When a text layer sets `wrap: true` we greedily
// break it to the layer width at compile time. Char budget ≈ width / (size *
// AVG_GLYPH), where AVG_GLYPH is the mean glyph advance as a fraction of the em
// for our serif/sans faces; explicit "\n" in the source are always kept.
const AVG_GLYPH = 0.5;

function wrapTextToWidth(text: string, width: number, size: number): string {
  const maxChars = Math.max(6, Math.floor(width / (size * AVG_GLYPH)));
  return text
    .split("\n")
    .map((segment) => {
      const words = segment.split(/\s+/).filter(Boolean);
      const lines: string[] = [];
      let line = "";
      for (const word of words) {
        const next = line ? `${line} ${word}` : word;
        if (next.length > maxChars && line) {
          lines.push(line);
          line = word;
        } else {
          line = next;
        }
      }
      if (line) lines.push(line);
      return lines.join("\n");
    })
    .join("\n");
}

// Presets that fill the frame by cropping. Applying them to an image whose
// aspect is far from the project's would cut off people, so those images are
// rerouted to blur-bg. Judged against the PROJECT aspect (not "portrait"), so
// 9:16 social edits reroute landscape photos the same way.
const CROPPING_EFFECTS: ReadonlySet<EffectPreset> = new Set([
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
  "tilt_shift",
  "dream_glow",
  "prism_split",
  "spotlight_focus",
  "mirror_split",
]);

// Reroute when cover-cropping would discard more than this fraction of the
// image. 0.3 keeps 4:3-on-16:9 (loss 0.25) cropped but reroutes portrait and
// square photos (loss ≥ 0.44).
const MAX_COVER_CROP_LOSS = 0.3;

/**
 * Turn a validated timeline into a concrete render plan: a list of slide-render
 * steps with absolute paths, plus the resolved final output and music.
 *
 * Each image is measured here so portrait photos on a cropping preset are
 * transparently rerouted to `portrait_blur_background` (no cropped faces).
 *
 * `baseDir` is the root all timeline-relative paths resolve against.
 * `tempDir` is where per-slide videos are written.
 */
export function compileTimeline(
  timeline: Timeline,
  baseDir: string,
  tempDir: string
): RenderPlan {
  const quality = resolveQualityProfile(timeline.project.quality);
  const steps: RenderSlideStep[] = timeline.slides.map((slide) => {
    const inputPaths = slide.effect === "layer_scene"
      ? []
      : isMultiImageEffect(slide.effect)
      ? slide.images ?? []
      : slide.effect === "video_background"
        ? slide.background
          ? [slide.background]
          : []
        : slide.image
          ? [slide.image]
          : [];
    const inputs = inputPaths.map((imagePath) => path.resolve(baseDir, imagePath));
    const input = inputs[0];
    const size = input ? readImageSize(input) : undefined;

    const requestedEffect = slide.effect;
    const autoPortrait =
      CROPPING_EFFECTS.has(requestedEffect) &&
      coverCropLoss(size, timeline.project.width, timeline.project.height) >
        MAX_COVER_CROP_LOSS;
    const effect: EffectPreset = autoPortrait
      ? "portrait_blur_background"
      : requestedEffect;

    // Per-slide grade overrides the global grade field-by-field.
    const mergedColor =
      timeline.color || slide.color
        ? { ...timeline.color, ...slide.color }
        : undefined;
    const color =
      mergedColor && mergedColor.lut
        ? { ...mergedColor, lut: path.resolve(baseDir, mergedColor.lut) }
        : mergedColor;

    const captions: CompiledCaption[] = slide.captions
      .filter((c) => c.position !== "none")
      .map((c, ci) => ({
        ...c,
        textFile: path.resolve(tempDir, `caption_${slide.id}_${ci}.txt`),
        fontFile: c.font ? path.resolve(baseDir, c.font) : DEFAULT_FONT,
      }));

    const layers: CompiledSceneLayer[] = (slide.layers ?? []).map((layer, li) => {
      const end = layer.start + (layer.duration ?? slide.duration - layer.start);
      if (layer.type === "image") {
        return {
          ...layer,
          end,
          absPath: path.resolve(baseDir, layer.path),
        };
      }
      if (layer.type === "text") {
        return {
          ...layer,
          end,
          text: layer.wrap
            ? wrapTextToWidth(layer.text, layer.width, layer.size)
            : layer.text,
          textFile: path.resolve(tempDir, `layer_${slide.id}_${li}.txt`),
          fontFile: layer.font ? path.resolve(baseDir, layer.font) : DEFAULT_FONT,
        };
      }
      return { ...layer, end };
    });

    return {
      type: "render_slide",
      slideId: slide.id,
      renderer: slide.renderer ?? "ffmpeg",
      rendererTemplate: slide.template,
      rendererAssets: (slide.assets ?? []).map((asset) => path.resolve(baseDir, asset)),
      rendererParams: slide.params ?? {},
      input,
      inputs,
      mask: slide.mask ? path.resolve(baseDir, slide.mask) : undefined,
      layers,
      output: path.resolve(tempDir, `${slide.id}.mp4`),
      duration: slide.duration,
      effect,
      requestedEffect,
      easing: slide.easing,
      autoPortrait,
      transition: slide.transition,
      captions,
      color,
      technicalColor: slide.technicalColor,
      tiltShift: slide.tiltShift,
      srcWidth: size?.width,
      srcHeight: size?.height,
      width: timeline.project.width,
      height: timeline.project.height,
      fps: timeline.project.fps,
      quality,
    };
  });

  const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi"]);
  const overlays = timeline.overlays.map((o) => ({
    ...o,
    absPath: path.resolve(baseDir, o.path),
    isVideo: VIDEO_EXTS.has(path.extname(o.path).toLowerCase()),
  }));

  return {
    project: timeline.project,
    quality,
    steps,
    overlays,
    finalOutput: path.resolve(baseDir, timeline.output.path),
    audio:
      timeline.music.length > 0
        ? {
            tracks: timeline.music.map((t) => ({
              path: path.resolve(baseDir, t.path),
              volume: t.volume,
              start: t.start,
              end: t.end,
            })),
            fadeIn: timeline.audio.fade_in,
            fadeOut: timeline.audio.fade_out,
            crossfade: timeline.audio.crossfade,
            automation: timeline.audio.automation,
            voiceover: timeline.audio.voiceover
              ? {
                  ...timeline.audio.voiceover,
                  path: path.resolve(baseDir, timeline.audio.voiceover.path),
                }
              : undefined,
          }
        : undefined,
  };
}

function isMultiImageEffect(effect: EffectPreset): boolean {
  return (
    effect === "film_roll_up" ||
    effect === "film_roll_left" ||
    effect === "film_roll_right" ||
    effect === "collage_grid" ||
    effect === "double_exposure" ||
    effect === "memory_wall"
  );
}
