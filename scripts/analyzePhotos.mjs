// Photo analysis (dependency-free): for each input photo, dump a tiny RGB frame
// via ffmpeg and compute orientation, a sharpness score (edge energy), a quality
// score, and a subject focal point (skin-tone centroid) for face-safe cropping.
//
// Usage: node scripts/analyzePhotos.mjs [--dir input] [--out analysis/photos.json]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { deriveRoleScores } from "./lib/tier1Editorial.mjs";
import { createYunetDetector } from "./lib/yunetFaceDetector.mjs";

const root = process.cwd();
const dirIdx = process.argv.indexOf("--dir");
const inputDir = path.resolve(root, dirIdx >= 0 ? process.argv[dirIdx + 1] : "input");
const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : "analysis/photos.json";
const prefixIdx = process.argv.indexOf("--file-prefix");
const filePrefix = prefixIdx >= 0 ? process.argv[prefixIdx + 1] : path.basename(inputDir);
const facesIdx = process.argv.indexOf("--faces");
const facesPath = facesIdx >= 0 ? process.argv[facesIdx + 1] : "";
const detectedFaces = facesPath ? JSON.parse(fs.readFileSync(path.resolve(root, facesPath), "utf8")) : null;
const skipFaceDetector = process.argv.includes("--skip-face-detector");
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_, e) => "ffprobe" + (e || ""));
let detector = null, detectorError = null;
if (!detectedFaces && !skipFaceDetector) {
  try { detector = await createYunetDetector({ root, ffmpeg }); } catch (error) { detectorError = error.message; }
}
const cachePath = path.resolve(root, path.dirname(outPath), "face_detection.cache.json");
let faceCache = { version: 1, modelId: detector?.model.id || null, modelSha256: detector?.model.sha256 || null, pipelineVersion: detector?.model.pipelineVersion || null, entries: {} };
try {
  const old = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  if (old.modelId === faceCache.modelId && old.modelSha256 === faceCache.modelSha256 && old.pipelineVersion === faceCache.pipelineVersion) faceCache = old;
} catch {}

const N = 96; // analysis frame size (NxN)

// Every downstream consumer (hero ranking by qualityNorm, portrait/landscape slot
// filling by orient, face-safe crop by focusX/focusY) silently degrades to
// garbage if these two probes fail: w=h=0 makes every photo "landscape", and a
// null frame makes every quality 0 so the ranking becomes file order. That is
// exactly what happened once when this ran without FFMPEG_PATH on PATH. So both
// probes now REPORT failure instead of returning a zero-shaped record, and the
// run aborts below rather than writing a plausible-looking but dead file.
/** Display dimensions — i.e. what ffmpeg actually decodes.
 *
 * ffprobe reports the STORED size; a camera held sideways stores the frame
 * landscape and records an EXIF rotation instead. ffmpeg honours that rotation on
 * decode (autorotate defaults on), so a 7008x4672 file with rotation 90 reaches
 * every later stage as a 4672x7008 PORTRAIT frame. Reporting the stored size marks
 * such a photo `landscape`: it gets landscape effects, fills landscape slots, and
 * has its face-safe crop computed against an aspect it does not have — while
 * focusX/focusY, which come from an ffmpeg-decoded (already rotated) frame, are
 * measured in the OTHER coordinate system. Swap here and the whole pipeline agrees.
 */
function probeDims(file) {
  const r = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", file], { encoding: "utf8" });
  if (r.error) return { err: `ffprobe not runnable (${ffprobe}): ${r.error.message}` };
  if (r.status !== 0) return { err: `ffprobe exit ${r.status}: ${(r.stderr || "").trim().slice(0, 160)}` };
  const [w, h] = (r.stdout || "").trim().split("x").map(Number);
  if (!w || !h) return { err: `ffprobe gave no dimensions (stdout: ${JSON.stringify((r.stdout || "").trim())})` };

  const rot = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream_tags=Orientation:side_data=rotation",
    "-of", "default=nw=1:nk=1", file], { encoding: "utf8" });
  const deg = Math.abs(Number((rot.stdout || "").trim().split(/\s+/)[0]) || 0) % 180;
  return deg === 90 ? { w: h, h: w } : { w, h };
}

function rgbFrame(file) {
  const r = spawnSync(ffmpeg, ["-v", "error", "-i", file, "-vf", `scale=${N}:${N}`,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 26 });
  if (r.error) return { err: `ffmpeg not runnable (${ffmpeg}): ${r.error.message}` };
  if (r.status !== 0) return { err: `ffmpeg exit ${r.status}: ${(r.stderr || "").toString().trim().slice(0, 160)}` };
  const got = r.stdout ? r.stdout.length : 0;
  if (got < N * N * 3) return { err: `short frame: ${got}/${N * N * 3} bytes` };
  return { buf: r.stdout };
}

// skin-tone test (common RGB rule)
function isSkin(R, G, B) {
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
  return R > 95 && G > 40 && B > 20 && (mx - mn) > 15 && Math.abs(R - G) > 15 && R > G && R > B;
}

/** Constrain a normalized box to the unit square, then round. Width/height shrink to fit
 *  so x+width and y+height never exceed 1 — the invariant the engine validates. */
function clampBox({ x, y, width, height }) {
  const cx = Math.min(Math.max(x, 0), 1), cy = Math.min(Math.max(y, 0), 1);
  return {
    x: +cx.toFixed(3), y: +cy.toFixed(3),
    width: +Math.min(Math.max(width, 0), 1 - cx).toFixed(3),
    height: +Math.min(Math.max(height, 0), 1 - cy).toFixed(3),
  };
}

function dHash(buf) {
  // 9x8 samples from the already decoded 96x96 frame. Adjacent brightness
  // comparisons survive resize/compression and produce a 64-bit fingerprint.
  let bits = 0n;
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const lum = (sx) => {
      const px = Math.round(sx * (N - 1) / 8), py = Math.round(y * (N - 1) / 7);
      const o = (py * N + px) * 3;
      return 0.299 * buf[o] + 0.587 * buf[o + 1] + 0.114 * buf[o + 2];
    };
    bits = (bits << 1n) | (lum(x) > lum(x + 1) ? 1n : 0n);
  }
  return bits.toString(16).padStart(16, "0");
}

function hamming(a, b) {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`), n = 0;
  while (x) { n += Number(x & 1n); x >>= 1n; }
  return n;
}

const files = fs.readdirSync(inputDir)
  .filter((n) => /\.(jpe?g|png)$/i.test(n))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (!files.length) { console.error(`[analyzePhotos] FAILED: no .jpg/.png found in ${inputDir}`); process.exit(1); }

const photos = [];
const failures = [];
for (const [uploadIndex, name] of files.entries()) {
  const abs = path.join(inputDir, name);
  const dims = probeDims(abs);
  const frame = rgbFrame(abs);
  if (dims.err || frame.err) { failures.push(`${name}: ${dims.err || frame.err}`); continue; }
  const { w, h } = dims, buf = frame.buf;
  let sharpness = 0, meanLuma = 0, skinN = 0, sxAcc = 0, syAcc = 0, rAcc = 0, gAcc = 0, bAcc = 0, colorAcc = 0;
  const lumaBins = new Uint32Array(256);
  let skinMinX = N, skinMinY = N, skinMaxX = -1, skinMaxY = -1;
  {
    // luma grid + gradient (sharpness) + skin centroid
    const luma = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 3, R = buf[o], G = buf[o + 1], B = buf[o + 2];
      luma[y * N + x] = 0.299 * R + 0.587 * G + 0.114 * B;
      meanLuma += luma[y * N + x];
      rAcc += R; gAcc += G; bAcc += B; colorAcc += Math.max(R, G, B) - Math.min(R, G, B);
      lumaBins[Math.max(0, Math.min(255, Math.round(luma[y * N + x])))]++;
      if (isSkin(R, G, B)) {
        skinN++; sxAcc += x; syAcc += y;
        skinMinX = Math.min(skinMinX, x); skinMaxX = Math.max(skinMaxX, x);
        skinMinY = Math.min(skinMinY, y); skinMaxY = Math.max(skinMaxY, y);
      }
    }
    meanLuma /= N * N;
    let grad = 0;
    for (let y = 1; y < N; y++) for (let x = 1; x < N; x++) {
      const i = y * N + x;
      grad += Math.abs(luma[i] - luma[i - 1]) + Math.abs(luma[i] - luma[i - N]);
    }
    sharpness = grad / (N * N); // higher = sharper
  }
  const skinFrac = skinN / (N * N);
  const percentile = (q) => { let n = 0; for (let i = 0; i < 256; i++) { n += lumaBins[i]; if (n >= N * N * q) return i; } return 255; };
  // focal point: skin centroid if enough skin, else weighted toward upper-center
  let focusX = 0.5, focusY = 0.45;
  if (skinFrac > 0.02) { focusX = +(sxAcc / skinN / (N - 1)).toFixed(3); focusY = +(syAcc / skinN / (N - 1)).toFixed(3); }
  // quality: sharpness, penalize very dark/bright frames
  const exposurePenalty = Math.abs(meanLuma - 128) / 128; // 0 good, 1 bad
  const quality = +(sharpness * (1 - 0.5 * exposurePenalty)).toFixed(3);
  // Clamp to the image before rounding. The inclusive +1 pixel and independent 3-decimal
  // rounding of x and width let a box whose skin touches the right/bottom edge come out at
  // x+width = 1.0102 — past the frame — which the engine rejects outright ("faceBox must
  // stay inside the source image"), taking the whole render down over a 1% overflow.
  const faceBoxEstimate = skinFrac > 0.02 ? clampBox({
    x: skinMinX / N, y: skinMinY / N,
    width: (skinMaxX - skinMinX + 1) / N,
    height: (skinMaxY - skinMinY + 1) / N,
  }) : null;
  let realFaces = null, realFaceError = null;
  if (detector) {
    const hash = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
    if (faceCache.entries[hash]) realFaces = faceCache.entries[hash].faces;
    else try { realFaces = await detector.detect(abs, dims); faceCache.entries[hash] = { file: name, faces: realFaces }; }
    catch (error) { realFaceError = error.message; }
  }
  const primaryReal = realFaces?.length ? [...realFaces].sort((a, b) => b.confidence * b.box.width * b.box.height - a.confidence * a.box.width * a.box.height)[0].box : null;
  const groupBox = realFaces?.length ? (() => { const x = Math.min(...realFaces.map((f) => f.box.x)), y = Math.min(...realFaces.map((f) => f.box.y)); const right = Math.max(...realFaces.map((f) => f.box.x + f.box.width)), bottom = Math.max(...realFaces.map((f) => f.box.y + f.box.height)); return clampBox({ x, y, width: right - x, height: bottom - y }); })() : null;
  const effectiveBox = groupBox || faceBoxEstimate;
  if (groupBox) { focusX = +(groupBox.x + groupBox.width / 2).toFixed(3); focusY = +(groupBox.y + groupBox.height / 2).toFixed(3); }
  photos.push({
    file: `${filePrefix.replace(/\\/g, "/").replace(/\/$/, "")}/${name}`,
    uploadIndex,
    w, h, orient: w >= h ? "landscape" : "portrait",
    sharpness: +sharpness.toFixed(3), meanLuma: +meanLuma.toFixed(1),
    meanRgb: { r: +(rAcc / (N * N)).toFixed(1), g: +(gAcc / (N * N)).toFixed(1), b: +(bAcc / (N * N)).toFixed(1) },
    colorfulness: +(colorAcc / (N * N) / 255).toFixed(3), lumaP05: percentile(0.05), lumaP95: percentile(0.95),
    skinFrac: +skinFrac.toFixed(3), focusX, focusY, quality,
    perceptualHash: dHash(buf),
    ...(effectiveBox ? {
      faceBoxEstimate: effectiveBox, faces: realFaces?.length ? realFaces : [{ box: faceBoxEstimate, confidence: 0.35 }],
      primarySubject: primaryReal || effectiveBox, subjectCount: realFaces?.length || 1,
      faceDetection: realFaces?.length ? detector.model.id : "skin_estimate_fallback",
      ...(realFaceError ? { faceDetectionError: realFaceError } : {}),
    } : { faces: [], subjectCount: null, faceDetection: detector ? detector.model.id : "none",
      ...((realFaceError || detectorError) ? { faceDetectionError: realFaceError || detectorError } : {}) }),
  });
}
if (detector) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(faceCache, null, 2) + "\n");
}

// Abort rather than write a file whose numbers are all zero: a poisoned
// photos.json validates fine and renders fine, it just quietly ruins every
// hero pick and crop, which is far more expensive to notice later.
if (failures.length) {
  console.error(`[analyzePhotos] FAILED: could not analyze ${failures.length}/${files.length} photo(s). Nothing written.`);
  for (const f of failures.slice(0, 10)) console.error(`  - ${f}`);
  if (failures.length > 10) console.error(`  ... and ${failures.length - 10} more`);
  console.error(`  Hint: FFMPEG_PATH=${process.env.FFMPEG_PATH || "(unset)"} — ffmpeg AND ffprobe must both be runnable.`);
  process.exit(1);
}

// normalize quality to 0..1 across the set for easy ranking
const qs = photos.map((p) => p.quality);
const qmin = Math.min(...qs), qmax = Math.max(...qs);
if (qmax - qmin < 1e-6) {
  console.error(`[analyzePhotos] FAILED: every photo scored the same quality (${qmin}) — the frame probe is not producing real pixels. Nothing written.`);
  process.exit(1);
}
for (const p of photos) {
  const supplied = detectedFaces?.photos?.find((row) => row.file === p.file || path.basename(row.file) === path.basename(p.file));
  if (supplied?.faces) {
    p.faces = supplied.faces;
    p.subjectCount = supplied.subjectCount ?? supplied.faces.length;
    p.primarySubject = supplied.primarySubject || supplied.faces.sort((a, b) =>
      (b.confidence ?? 0) * (b.box?.width ?? 0) * (b.box?.height ?? 0) -
      (a.confidence ?? 0) * (a.box?.width ?? 0) * (a.box?.height ?? 0))[0]?.box;
    p.faceBoxEstimate = p.primarySubject || p.faceBoxEstimate;
    p.faceDetection = supplied.detector || detectedFaces.detector || "external_detector";
    if (p.primarySubject) {
      p.focusX = +(p.primarySubject.x + p.primarySubject.width / 2).toFixed(3);
      p.focusY = +(p.primarySubject.y + p.primarySubject.height / 2).toFixed(3);
    }
  }
  p.qualityNorm = +((p.quality - qmin) / (qmax - qmin)).toFixed(3);
  Object.assign(p, deriveRoleScores(p));
}

// Connected components under a conservative dHash threshold. Each group names
// its best-quality representative; downstream may retain the rest, but must not
// place siblings next to each other.
const parent = photos.map((_, i) => i);
const find = (i) => parent[i] === i ? i : (parent[i] = find(parent[i]));
const join = (a, b) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };
for (let i = 0; i < photos.length; i++) for (let j = i + 1; j < photos.length; j++) {
  if (hamming(photos[i].perceptualHash, photos[j].perceptualHash) <= 6) join(i, j);
}
const groups = new Map();
for (let i = 0; i < photos.length; i++) {
  const key = find(i); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(photos[i]);
}
let duplicateIndex = 1;
for (const members of groups.values()) {
  if (members.length < 2) continue;
  members.sort((a, b) => b.qualityNorm - a.qualityNorm);
  const id = `dup-${String(duplicateIndex++).padStart(3, "0")}`;
  for (const [i, p] of members.entries()) {
    p.duplicateGroup = id;
    p.duplicateRepresentative = i === 0;
    p.duplicateDistance = hamming(p.perceptualHash, members[0].perceptualHash);
  }
}

fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify({ dir: path.basename(inputDir), count: photos.length, photos }, null, 2));
const top = [...photos].sort((a, b) => b.qualityNorm - a.qualityNorm).slice(0, 5).map((p) => p.file).join(", ");
console.log(`Wrote ${outPath}: ${photos.length} photos. Top-quality: ${top}`);
