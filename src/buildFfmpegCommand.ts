import { buildCaptionFilter } from "./captionFilter";
import { buildColorFilter, buildLetterboxFilter } from "./buildColorFilters";
import { buildMemoryWallArgs } from "./buildEditorialEffects";
import { buildLayerSceneArgs } from "./buildLayerSceneCommand";
import {
  buildCollageGridArgs,
  buildFilmRollArgs,
  isFilmRollEffect,
  isPhotoStripEffect,
} from "./buildMontageCommand";
import {
  buildEffectFilter,
  centerX,
  centerY,
  zoomInExpr,
} from "./buildPhotoEffects";

export { buildColorFilter, buildLetterboxFilter } from "./buildColorFilters";
export { buildEffectFilter } from "./buildPhotoEffects";
import { buildTechnicalColorFilter, canvasBackground } from "./ffmpegFilterHelpers";
import { videoEncodeArgs } from "./quality";
import type { QualityProfile } from "./quality";
import { EFFECT_PRESETS } from "./types";
import type { EffectPreset, RenderSlideStep } from "./types";

export { buildAudioMuxArgs } from "./buildAudioMuxCommand";
export type { AudioMuxSpec } from "./buildAudioMuxCommand";
export {
  buildConcatArgs,
  buildOverlayArgs,
  buildXfadeArgs,
  hasTransitions,
} from "./buildFinalVideoCommand";

// Pure functions that build ffmpeg argument arrays (for child_process.spawn).
// No AI, no free-text, no shell strings — only preset-driven arguments.

// All per-slide effect presets are implemented. Crossfade transitions (which
// span two slides) and captions are handled elsewhere / in a later milestone.
const IMPLEMENTED_EFFECTS: ReadonlySet<EffectPreset> = new Set(EFFECT_PRESETS);

export function isImplementedEffect(effect: EffectPreset): boolean {
  return IMPLEMENTED_EFFECTS.has(effect);
}

/**
 * A single image -> a fixed-length slide video. The surrounding encode args are
 * identical for every preset; only the video filtergraph (-vf) changes, so the
 * outputs stay stream-compatible for a fast concat later.
 */
export function buildSlideArgs(step: RenderSlideStep): string[] {
  if (step.effect === "layer_scene") return buildLayerSceneArgs(step);
  if (step.effect === "video_background") return buildVideoBackgroundArgs(step);
  if (step.effect === "collage_grid") return buildCollageGridArgs(step);
  if (step.effect === "double_exposure") return buildDoubleExposureArgs(step);
  if (step.effect === "mask_reveal") return buildMaskRevealArgs(step);
  if (step.effect === "memory_wall") return buildMemoryWallArgs(step);
  if (isFilmRollEffect(step.effect) || isPhotoStripEffect(step.effect)) return buildFilmRollArgs(step);

  const vf = buildEffectFilter(step);

  return [
    "-y",
    "-loop",
    "1",
    "-i",
    step.input,
    "-t",
    String(step.duration),
    "-vf",
    vf,
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

function buildVideoBackgroundArgs(step: RenderSlideStep): string[] {
  return [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    step.input,
    "-t",
    String(step.duration),
    "-vf",
    buildVideoBackgroundFilter(step),
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

function buildDoubleExposureArgs(step: RenderSlideStep): string[] {
  const inputs: string[] = [];
  for (const input of step.inputs.slice(0, 2)) {
    inputs.push("-loop", "1", "-t", String(step.duration), "-i", input);
  }

  return [
    "-y",
    ...inputs,
    "-filter_complex",
    buildDoubleExposureFilter(step),
    "-map",
    "[vout]",
    "-t",
    String(step.duration),
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

function buildMaskRevealArgs(step: RenderSlideStep): string[] {
  if (!step.mask) {
    throw new Error(`slide ${step.slideId}: mask_reveal step is missing mask`);
  }
  return [
    "-y",
    "-loop",
    "1",
    "-t",
    String(step.duration),
    "-i",
    step.input,
    "-i",
    step.mask,
    "-filter_complex",
    buildMaskRevealFilter(step),
    "-map",
    "[vout]",
    "-t",
    String(step.duration),
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

/**
 * mask_reveal: the photo appears through the luma of a grayscale mask video
 * (white = photo, black = hidden) over the canvas background. The mask plays
 * once; tpad clones its final frame so a 4s reveal simply holds fully-open
 * for the rest of a longer slide. Grade/letterbox/captions run after the
 * composite, same as the other filter_complex effects.
 */
function buildMaskRevealFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const filters: string[] = [];

  filters.push(`color=c=${canvasBackground(step)}:s=${w}x${h}:r=${fps}:d=${duration}[mrbg]`);
  filters.push(
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},setsar=1,format=rgba[mrph]`
  );
  filters.push(
    `[1:v]fps=${fps},scale=${w}:${h},format=gray,setsar=1,` +
      `tpad=stop=-1:stop_mode=clone[mrmk]`
  );
  filters.push(`[mrph][mrmk]alphamerge[mrrev]`);
  filters.push(`[mrbg][mrrev]overlay=0:0[mr0]`);

  let current = "mr0";
  const post = [
    buildColorFilter(step.color),
    buildLetterboxFilter(step.color, w, h),
    ...step.captions.map((c) => buildCaptionFilter(c, h)),
  ].filter((f): f is string => Boolean(f));
  post.forEach((filter, i) => {
    const next = `mrpost${i}`;
    filters.push(`[${current}]${filter}[${next}]`);
    current = next;
  });
  filters.push(
    `[${current}]trim=duration=${duration},fps=${fps},format=yuv420p[vout]`
  );

  return filters.join(";");
}

function buildVideoBackgroundFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps } = step;
  const chain = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    `setsar=1`,
    `fps=${fps}`,
    `format=yuv420p`,
  ];

  const grade = buildColorFilter(step.color);
  if (grade) chain.push(grade);
  const bars = buildLetterboxFilter(step.color, w, h);
  if (bars) chain.push(bars);
  for (const c of step.captions) chain.push(buildCaptionFilter(c, h));

  return chain.join(",");
}
/**
 * Double exposure: the second image screen-blends over the first at partial
 * opacity (a dreamy superimposition — silhouette + texture in the classic
 * wedding-template style), then the composite gets a slow eased zoom-in.
 * Both layers are 2x-oversampled cover-fills so blend sizes always match and
 * the zoom stays smooth; gbrp keeps the screen blend from tinting (both blend
 * inputs must share one planar RGB format).
 */
function buildDoubleExposureFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const frames = Math.max(1, Math.round(duration * fps));
  const cover =
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,` +
    `crop=${w * 2}:${h * 2},setsar=1,format=gbrp`;
  const filters: string[] = [];

  filters.push(`[0:v]${cover}[dxbase]`);
  filters.push(`[1:v]${cover},eq=saturation=0.85[dxtop]`);
  filters.push(
    `[dxbase][dxtop]blend=all_mode=screen:all_opacity=0.45[dxmix]`
  );
  filters.push(
    `[dxmix]zoompan=z=${zoomInExpr(frames)}:x=${centerX()}:y=${centerY()}:` +
      `d=${frames}:s=${w}x${h}:fps=${fps},setsar=1,fps=${fps},format=yuv420p[dx0]`
  );

  const post = [
    buildTechnicalColorFilter(step.technicalColor),
    buildColorFilter(step.color),
    buildLetterboxFilter(step.color, w, h),
    ...step.captions.map((c) => buildCaptionFilter(c, h)),
  ].filter((f): f is string => Boolean(f));
  let current = "dx0";
  post.forEach((filter, i) => {
    const next = `dx${i + 1}`;
    filters.push(`[${current}]${filter}[${next}]`);
    current = next;
  });
  filters.push(`[${current}]format=yuv420p[vout]`);

  return filters.join(";");
}
