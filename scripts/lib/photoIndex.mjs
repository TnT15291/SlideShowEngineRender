/**
 * The album inventory the narrated pipeline plans against: one row per photograph,
 * with the size ffmpeg will actually decode and the shape that follows from it.
 *
 * `analysis/photo-index.json` for the first film was produced by hand, and everything
 * downstream indexes INTO it — `pools-curated.json` maps a topic to positions in this
 * array. So the order is the contract: filenames, numerically aware, exactly as the
 * hand-made file was built ("photos/ sorted by filename"). Rebuilding an existing
 * index is therefore never automatic; a re-sort would silently re-point every pool.
 */
import fs from "node:fs";
import path from "node:path";

import { probeDisplaySize, resolveFfprobe } from "./imageDimensions.mjs";

export const PHOTO_FILE = /\.(jpe?g|png|webp|heic|heif)$/i;

/**
 * Landscape past 1.15, portrait below 0.85, square between.
 *
 * Reconstructed from the hand-built ANTT index rather than invented: its 207
 * landscapes bottom out at 1.1552, its 11 squares span 0.9011–1.1441 and its 121
 * portraits top out at 0.8086, so these two thresholds reproduce all 339 labels.
 * The wedding pipeline's binary `w >= h` rule cannot be reused — `square` is a real
 * third case here, and both the assigner and the AI director read it as one.
 */
export function orientationOf(width, height) {
  const ratio = width / height;
  if (ratio >= 1.15) return "landscape";
  if (ratio <= 0.85) return "portrait";
  return "square";
}

export function listPhotoFiles(dir) {
  return fs.readdirSync(dir)
    .filter((name) => PHOTO_FILE.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Every row or none: a photograph whose size cannot be read would otherwise land in
 * the index as a plausible-looking landscape and be seated in a wide slot it does not
 * fit. The probe reports its failure, so this refuses the whole file.
 */
export function buildPhotoIndex(dir, { probe = (file) => probeDisplaySize(file, resolveFfprobe()) } = {}) {
  const files = listPhotoFiles(dir);
  if (!files.length) throw new Error(`No photographs found in ${dir}`);
  const failures = [];
  const rows = files.map((file, index) => {
    const size = probe(path.join(dir, file));
    if (size.err) {
      failures.push(`${file}: ${size.err}`);
      return null;
    }
    return { i: index, file, w: size.w, h: size.h, orient: orientationOf(size.w, size.h) };
  });
  if (failures.length) {
    throw new Error(`Could not measure ${failures.length} of ${files.length} photograph(s):\n  ${failures.slice(0, 5).join("\n  ")}`);
  }
  return rows;
}

export function writePhotoIndex(target, dir, options = {}) {
  const rows = buildPhotoIndex(dir, options);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, `${JSON.stringify(rows, null, 1)}\n`, "utf8");
  return rows;
}

/**
 * Where a project keeps its pools of photographs, in preference order.
 *
 * `pools-curated.json` is the first film's second pass — pools with the weak, duplicate
 * and sensitive frames of `curation.json` already removed — so it wins wherever it
 * exists. A film that has not been through a curation pass has only `pools.json`, and
 * requiring it to name that file "curated" would carry one album's history into every
 * album after it.
 */
export const POOL_FILES = ["analysis/pools-curated.json", "analysis/pools.json"];

export function resolvePoolsFile(projectDir) {
  return POOL_FILES.find((candidate) => fs.existsSync(path.join(projectDir, candidate))) ?? null;
}
