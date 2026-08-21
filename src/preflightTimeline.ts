import path from "node:path";
import {
  ensureDir,
  fileExists,
  Logger,
  probeDurationSeconds,
  ValidationError,
} from "./fileUtils";
import { letterboxBarHeight } from "./buildColorFilters";
import { coverCropLoss, readImageSize } from "./imageSize";
import type { Caption, SceneLayer, Slide, TextSceneLayer, Timeline } from "./types";

const AVG_GLYPH = 0.56;
const MAX_LOGGED_WARNINGS = 12;

interface PreflightStats {
  imageRefs: number;
  uniqueImages: number;
  musicTracks: number;
  nominalDuration: number;
  estimatedFinalDuration: number;
  warnings: string[];
  errors: string[];
}

export async function preflightTimeline(
  timeline: Timeline,
  baseDir: string,
  logger: Logger,
  dryRun: boolean
): Promise<void> {
  const stats: PreflightStats = {
    imageRefs: 0,
    uniqueImages: 0,
    musicTracks: timeline.music.length,
    nominalDuration: timeline.slides.reduce((sum, s) => sum + s.duration, 0),
    estimatedFinalDuration: estimateFinalDuration(timeline),
    warnings: [],
    errors: [],
  };

  ensureDir(path.resolve(baseDir, path.dirname(timeline.output.path)));

  const imageRefs = collectImageRefs(timeline);
  stats.imageRefs = imageRefs.length;
  stats.uniqueImages = new Set(imageRefs).size;

  checkImages(imageRefs, timeline, baseDir, stats);
  checkLayerScenes(timeline, baseDir, stats);
  checkCaptions(timeline, stats);
  await checkAudio(timeline, baseDir, stats, dryRun);

  logger.info(
    `Preflight: ${timeline.slides.length} slides, ${stats.imageRefs} image refs ` +
      `(${stats.uniqueImages} unique), ${stats.musicTracks} music track(s), ` +
      `${stats.estimatedFinalDuration.toFixed(2)}s estimated final duration`
  );

  for (const warning of stats.warnings.slice(0, MAX_LOGGED_WARNINGS)) {
    logger.info(`[preflight warning] ${warning}`);
  }
  if (stats.warnings.length > MAX_LOGGED_WARNINGS) {
    logger.info(
      `[preflight warning] ${stats.warnings.length - MAX_LOGGED_WARNINGS} more warning(s) suppressed`
    );
  }

  if (stats.errors.length > 0) {
    throw new ValidationError(
      "Timeline preflight failed:\n" +
        stats.errors.map((e) => `  - ${e}`).join("\n")
    );
  }
}

function collectImageRefs(timeline: Timeline): string[] {
  const refs: string[] = [];
  for (const slide of timeline.slides) {
    if (slide.image) refs.push(slide.image);
    for (const image of slide.images ?? []) refs.push(image);
    for (const asset of slide.assets ?? []) refs.push(asset);
    for (const layer of slide.layers ?? []) {
      if (layer.type === "image") refs.push(layer.path);
    }
  }
  return refs;
}

function checkImages(
  refs: string[],
  timeline: Timeline,
  baseDir: string,
  stats: PreflightStats
): void {
  for (const ref of new Set(refs)) {
    const abs = path.resolve(baseDir, ref);
    if (!fileExists(abs)) continue; // strict validation already reports this.
    const size = readImageSize(abs);
    if (!size) {
      stats.warnings.push(`Cannot read image size: ${ref}`);
      continue;
    }
    const largest = Math.max(size.width, size.height);
    if (largest > Math.max(timeline.project.width, timeline.project.height) * 4) {
      stats.warnings.push(
        `Very large image may slow render before cache: ${ref} (${size.width}x${size.height})`
      );
    }
  }
}

function checkLayerScenes(
  timeline: Timeline,
  baseDir: string,
  stats: PreflightStats
): void {
  const w = timeline.project.width;
  const h = timeline.project.height;
  for (const slide of timeline.slides) {
    // The same merge compileTimeline performs, because the bars a slide gets
    // are usually the film's, not the slide's.
    const barHeight = letterboxBarHeight({ ...timeline.color, ...slide.color }, w, h);
    for (const [li, layer] of (slide.layers ?? []).entries()) {
      const label = `slide ${slide.id} layers[${li}]`;
      checkLayerBox(label, layer, w, h, stats);
      if (layer.type === "text") {
        checkTextLayer(label, layer, stats);
        checkTextUnderLetterbox(label, layer, barHeight, h, stats);
      }
      if (layer.type === "image") {
        checkImageLayerCropRisk(label, layer, baseDir, stats);
      }
    }
    checkTextPhotoCollisions(slide, stats);
  }
}

function checkLayerBox(
  label: string,
  layer: SceneLayer,
  frameWidth: number,
  frameHeight: number,
  stats: PreflightStats
): void {
  if (layer.x < 0 || layer.y < 0) {
    stats.errors.push(`${label} starts outside canvas (${layer.x}, ${layer.y})`);
  }
  if (layer.x + layer.width > frameWidth || layer.y + layer.height > frameHeight) {
    stats.errors.push(
      `${label} exceeds canvas bounds: ` +
        `${layer.x},${layer.y},${layer.width}x${layer.height} on ${frameWidth}x${frameHeight}`
    );
  }
  if (layer.opacity === 0) {
    stats.warnings.push(`${label} has opacity 0 and will not be visible`);
  }
}

/** Lines and glyph extents as the renderer will lay them out: drawtext anchors
 *  the block at layer.y and never wraps by itself, so by the time a timeline
 *  reaches here the newlines fitTextInTimeline wrote ARE the line breaks. */
function estimateTextBlock(layer: TextSceneLayer): { estimatedWidth: number; estimatedHeight: number } {
  const lines = layer.wrap
    ? wrapForEstimate(layer.text, layer.width, layer.size)
    : layer.text.split("\n");
  const maxLine = Math.max(0, ...lines.map((line) => line.length));
  const lineSpacing = layer.lineSpacing ?? Math.round(layer.size * 0.22);
  return {
    estimatedWidth:
      maxLine * layer.size * AVG_GLYPH +
      Math.max(0, maxLine - 1) * Math.max(0, layer.letterSpacing ?? 0),
    estimatedHeight:
      lines.length * layer.size + Math.max(0, lines.length - 1) * lineSpacing,
  };
}

function checkTextLayer(
  label: string,
  layer: TextSceneLayer,
  stats: PreflightStats
): void {
  const { estimatedWidth, estimatedHeight } = estimateTextBlock(layer);

  if (estimatedWidth > layer.width * 1.08) {
    stats.warnings.push(
      `${label} text may overflow width: estimated ${Math.round(estimatedWidth)}px > ${layer.width}px`
    );
  }
  if (estimatedHeight > layer.height * 1.08) {
    stats.warnings.push(
      `${label} text may overflow height: estimated ${Math.round(estimatedHeight)}px > ${layer.height}px`
    );
  }
}

/**
 * Cinematic bars are painted over the finished card, so a layer-scene's own
 * text is UNDER them — unlike a caption, which is drawn after the bars on
 * purpose so it reads like a film subtitle. Nothing else notices: the bars are
 * inside the canvas, so the bounds check passes; they are below the 5%
 * title-safe margin, so the layout rules pass; and the QA text measurer only
 * asks whether the text fits its own slot. A title can therefore be authored
 * legally, measured as fitting, and rendered completely invisible — which is
 * exactly what a probe of a 2.39 grade with text at the title-safe limit shows.
 *
 * Judged on the glyph block rather than the slot box: a slot that reaches into
 * the bar while its one line of text sits well above it is how several shipping
 * cards are authored, and failing those would be crying wolf. An entrance
 * animation that slides text up from under the bottom bar is deliberate and is
 * not counted either — this is about where the text comes to rest.
 */
function checkTextUnderLetterbox(
  label: string,
  layer: TextSceneLayer,
  barHeight: number,
  frameHeight: number,
  stats: PreflightStats
): void {
  if (barHeight <= 0 || layer.opacity === 0) return;
  const top = layer.y;
  const bottom = layer.y + estimateTextBlock(layer).estimatedHeight;
  const hidden = top < barHeight ? "top" : bottom > frameHeight - barHeight ? "bottom" : null;
  if (!hidden) return;
  stats.errors.push(
    `${label} text runs under the ${hidden} letterbox bar: glyphs at ` +
      `${Math.round(top)}-${Math.round(bottom)} with ${barHeight}px bars on ${frameHeight}px; ` +
      `move it inside ${barHeight}-${frameHeight - barHeight} or drop the letterbox`
  );
}

function checkImageLayerCropRisk(
  label: string,
  layer: Extract<SceneLayer, { type: "image" }>,
  baseDir: string,
  stats: PreflightStats
): void {
  if (layer.fit !== "cover") return;
  const size = readImageSize(path.resolve(baseDir, layer.path));
  const loss = coverCropLoss(size, layer.width, layer.height);
  if (loss > 0.18) {
    stats.warnings.push(
      `${label} uses cover with ${Math.round(loss * 100)}% crop risk; ` +
        `use contain for face-safe framing`
    );
  }
}

function checkTextPhotoCollisions(slide: Slide, stats: PreflightStats): void {
  const layers = slide.layers ?? [];
  for (const [textIndex, textLayer] of layers.entries()) {
    if (textLayer.type !== "text" || textLayer.opacity === 0) continue;

    for (const [imageIndex, imageLayer] of layers.entries()) {
      if (imageLayer.type !== "image" || imageLayer.opacity === 0) continue;
      if (!timeOverlaps(textLayer, imageLayer, slide.duration)) continue;

      const overlap = overlapRatio(textLayer, imageLayer);
      if (overlap < 0.02) continue;

      const label =
        `slide ${slide.id} layers[${textIndex}] text overlaps ` +
        `layers[${imageIndex}] image (${Math.round(overlap * 100)}% of text box)`;

      if (imageIndex > textIndex) {
        stats.errors.push(`${label}; image is drawn after the text and may cover it`);
      } else if (
        overlap >= 0.1 &&
        !hasBackingRect(layers, imageIndex, textIndex, textLayer, slide.duration)
      ) {
        stats.warnings.push(`${label}; add a rect backing or move text/photo apart`);
      }
    }
  }
}

function hasBackingRect(
  layers: SceneLayer[],
  imageIndex: number,
  textIndex: number,
  textLayer: SceneLayer,
  slideDuration: number
): boolean {
  for (let i = imageIndex + 1; i < textIndex; i++) {
    const layer = layers[i];
    if (layer.type !== "rect" || layer.opacity < 0.25) continue;
    if (!timeOverlaps(textLayer, layer, slideDuration)) continue;
    if (overlapRatio(textLayer, layer) >= 0.85) return true;
  }
  return false;
}

function timeOverlaps(a: SceneLayer, b: SceneLayer, slideDuration: number): boolean {
  const aEnd = layerEnd(a, slideDuration);
  const bEnd = layerEnd(b, slideDuration);
  return a.start < bEnd && b.start < aEnd;
}

function layerEnd(layer: SceneLayer, slideDuration: number): number {
  return layer.start + (layer.duration ?? slideDuration - layer.start);
}

function overlapRatio(a: SceneLayer, b: SceneLayer): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.width, b.x + b.width);
  const y2 = Math.min(a.y + a.height, b.y + b.height);
  const w = Math.max(0, x2 - x1);
  const h = Math.max(0, y2 - y1);
  const aArea = Math.max(1, a.width * a.height);
  return (w * h) / aArea;
}

function checkCaptions(timeline: Timeline, stats: PreflightStats): void {
  for (const slide of timeline.slides) {
    for (const [ci, caption] of slide.captions.entries()) {
      if (caption.position === "none") continue;
      checkCaptionText(`slide ${slide.id} captions[${ci}]`, caption, timeline, stats);
    }
  }
}

function checkCaptionText(
  label: string,
  caption: Caption,
  timeline: Timeline,
  stats: PreflightStats
): void {
  const size = caption.size ?? Math.round(timeline.project.height / 18);
  const safeWidth = timeline.project.width * 0.86;
  const lines = caption.text.split("\n");
  const maxLine = Math.max(0, ...lines.map((line) => line.length));
  const estimatedWidth = maxLine * size * AVG_GLYPH;
  // How hard to judge a caption is a POLICY decision, and the builder resolves it from the
  // tier's own row in scripts/lib/rules/policy.mjs (`text_safe_area`). It used to be
  // inferred here from `pipelineVersion === "lite-v2"` — a string only the Lite generator
  // ever wrote — so the same overrun was an error for Lite and a warning for everyone else
  // by accident of provenance. A timeline that declares nothing keeps the lenient reading:
  // hand-built and legacy timelines are not the thing this gate is for.
  const strictLiteText = Boolean(
    (timeline as Timeline & { metadata?: { strictText?: boolean } }).metadata?.strictText
  );
  if (estimatedWidth > safeWidth) {
    (strictLiteText ? stats.errors : stats.warnings).push(`${label} caption exceeds the 86% safe width after fitting`);
  }
  if (lines.length > 3) {
    (strictLiteText ? stats.errors : stats.warnings).push(`${label} caption has ${lines.length} lines; maximum is 3`);
  }
  const estimatedHeight = lines.length * size * 1.32;
  if (estimatedHeight > timeline.project.height * 0.34) {
    (strictLiteText ? stats.errors : stats.warnings).push(`${label} caption exceeds the vertical safe box`);
  }
  const language = (timeline as Timeline & { language?: string }).language;
  const units = language === "en"
    ? caption.text.trim().split(/\s+/).filter(Boolean).length
    : caption.text.replace(/\s/g, "").length;
  const limit = language === "en" ? 3 : 18;
  if (caption.duration <= 0 || units / caption.duration > limit) {
    (strictLiteText ? stats.errors : stats.warnings).push(`${label} caption exceeds reading-rate policy (${limit} ${language === "en" ? "words" : "characters"}/s)`);
  }
}

async function checkAudio(
  timeline: Timeline,
  baseDir: string,
  stats: PreflightStats,
  dryRun: boolean
): Promise<void> {
  if (timeline.music.length === 0) {
    stats.warnings.push("No music tracks declared");
    return;
  }
  if (dryRun) return;

  const durations = await Promise.all(
    timeline.music.map((track) =>
      fileExists(path.resolve(baseDir, track.path))
        ? probeDurationSeconds(path.resolve(baseDir, track.path))
        : Promise.resolve(undefined)
    )
  );
  for (const [i, duration] of durations.entries()) {
    if (duration === undefined) {
      stats.warnings.push(`Cannot probe music duration: ${timeline.music[i].path}`);
    }
  }
}

function estimateFinalDuration(timeline: Timeline): number {
  let total = timeline.slides.reduce((sum, slide) => sum + slide.duration, 0);
  for (let i = 0; i < timeline.slides.length - 1; i++) {
    if (timeline.slides[i].transition.type !== "none") {
      total -= timeline.slides[i].transition.duration;
    }
  }
  return total;
}

function wrapForEstimate(text: string, width: number, size: number): string[] {
  const maxChars = Math.max(6, Math.floor(width / (size * AVG_GLYPH)));
  const lines: string[] = [];
  for (const segment of text.split("\n")) {
    const words = segment.split(/\s+/).filter(Boolean);
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
  }
  return lines.length > 0 ? lines : [""];
}
