import path from "node:path";
import {
  ensureDir,
  fileExists,
  Logger,
  probeDurationSeconds,
  ValidationError,
} from "./fileUtils";
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
    for (const [li, layer] of (slide.layers ?? []).entries()) {
      const label = `slide ${slide.id} layers[${li}]`;
      checkLayerBox(label, layer, w, h, stats);
      if (layer.type === "text") checkTextLayer(label, layer, stats);
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

function checkTextLayer(
  label: string,
  layer: TextSceneLayer,
  stats: PreflightStats
): void {
  const lines = layer.wrap
    ? wrapForEstimate(layer.text, layer.width, layer.size)
    : layer.text.split("\n");
  const maxLine = Math.max(0, ...lines.map((line) => line.length));
  const estimatedWidth =
    maxLine * layer.size * AVG_GLYPH +
    Math.max(0, maxLine - 1) * Math.max(0, layer.letterSpacing ?? 0);
  const lineSpacing = layer.lineSpacing ?? Math.round(layer.size * 0.22);
  const estimatedHeight =
    lines.length * layer.size + Math.max(0, lines.length - 1) * lineSpacing;

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
  if (estimatedWidth > safeWidth) {
    stats.warnings.push(
      `${label} caption may exceed safe width; add manual line breaks`
    );
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
