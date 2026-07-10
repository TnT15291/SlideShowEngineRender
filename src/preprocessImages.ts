import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir, Logger, runFfmpeg } from "./fileUtils";
import { readImageSize } from "./imageSize";
import type { Timeline } from "./types";

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png"]);
const DEFAULT_MAX_EDGE = 2560;

interface CacheStats {
  refs: number;
  unique: number;
  resized: number;
  reused: number;
  skipped: number;
}

/**
 * Build a render-only copy of the timeline whose oversized still images point
 * at cached, downscaled files. Source photos are never modified.
 */
export async function preprocessTimelineImages(
  timeline: Timeline,
  baseDir: string,
  tempDir: string,
  logger: Logger,
  dryRun: boolean
): Promise<Timeline> {
  const maxEdge = parseMaxEdge();
  if (dryRun || maxEdge <= 0) {
    logger.info(
      dryRun
        ? "Image cache skipped for dry-run"
        : "Image cache disabled (IMAGE_CACHE_MAX_EDGE <= 0)"
    );
    return timeline;
  }

  const refs = collectImageRefs(timeline);
  if (refs.length === 0) return timeline;

  const cacheDir = path.join(tempDir, "image-cache", `edge-${maxEdge}`);
  ensureDir(cacheDir);

  const stats: CacheStats = {
    refs: refs.length,
    unique: new Set(refs).size,
    resized: 0,
    reused: 0,
    skipped: 0,
  };
  const replacements = new Map<string, string>();

  for (const ref of new Set(refs)) {
    const replacement = await cacheImageIfUseful(ref, {
      baseDir,
      cacheDir,
      logger,
      maxEdge,
      stats,
    });
    if (replacement) replacements.set(ref, replacement);
  }

  logger.info(
    `Image cache: ${stats.refs} refs, ${stats.unique} unique, ` +
      `${stats.resized} resized, ${stats.reused} reused, ${stats.skipped} kept original`
  );

  if (replacements.size === 0) return timeline;
  return rewriteTimelineImageRefs(timeline, replacements);
}

function parseMaxEdge(): number {
  const raw = process.env.IMAGE_CACHE_MAX_EDGE;
  if (!raw) return DEFAULT_MAX_EDGE;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.floor(n) : DEFAULT_MAX_EDGE;
}

function collectImageRefs(timeline: Timeline): string[] {
  const refs: string[] = [];
  for (const slide of timeline.slides) {
    if (slide.image) refs.push(slide.image);
    for (const image of slide.images ?? []) refs.push(image);
    for (const layer of slide.layers ?? []) {
      if (layer.type === "image") refs.push(layer.path);
    }
  }
  return refs;
}

async function cacheImageIfUseful(
  ref: string,
  opts: {
    baseDir: string;
    cacheDir: string;
    logger: Logger;
    maxEdge: number;
    stats: CacheStats;
  }
): Promise<string | undefined> {
  const abs = path.resolve(opts.baseDir, ref);
  const ext = path.extname(abs).toLowerCase();
  if (!IMAGE_EXTS.has(ext)) {
    opts.stats.skipped++;
    return undefined;
  }

  const size = readImageSize(abs);
  if (!size || Math.max(size.width, size.height) <= opts.maxEdge) {
    opts.stats.skipped++;
    return undefined;
  }

  const stat = fs.statSync(abs);
  const outExt = ext === ".png" ? ".png" : ".jpg";
  const cacheName = `${hashCacheKey(abs, stat, opts.maxEdge)}${outExt}`;
  const out = path.join(opts.cacheDir, cacheName);

  if (fs.existsSync(out)) {
    opts.stats.reused++;
    return out;
  }

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    abs,
    "-vf",
    `scale=${opts.maxEdge}:${opts.maxEdge}:force_original_aspect_ratio=decrease`,
    "-frames:v",
    "1",
  ];
  if (outExt === ".jpg") args.push("-q:v", "3");
  if (outExt === ".png") args.push("-compression_level", "6");
  args.push(out);

  opts.logger.info(
    `Caching image ${path.relative(opts.baseDir, abs)} (${size.width}x${size.height} -> max ${opts.maxEdge}px)`
  );
  await runFfmpeg(args, `image-cache ${path.basename(abs)}`, opts.logger);
  opts.stats.resized++;
  return out;
}

function hashCacheKey(
  abs: string,
  stat: fs.Stats,
  maxEdge: number
): string {
  return crypto
    .createHash("sha1")
    .update(abs)
    .update(String(stat.size))
    .update(String(stat.mtimeMs))
    .update(String(maxEdge))
    .digest("hex")
    .slice(0, 20);
}

function rewriteTimelineImageRefs(
  timeline: Timeline,
  replacements: Map<string, string>
): Timeline {
  return {
    ...timeline,
    slides: timeline.slides.map((slide) => ({
      ...slide,
      image: slide.image ? replacements.get(slide.image) ?? slide.image : slide.image,
      images: slide.images?.map((image) => replacements.get(image) ?? image),
      layers: slide.layers?.map((layer) =>
        layer.type === "image"
          ? { ...layer, path: replacements.get(layer.path) ?? layer.path }
          : layer
      ),
    })),
  };
}
