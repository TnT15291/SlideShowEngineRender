// Photo analysis (dependency-free): for each input photo, dump a tiny RGB frame
// via ffmpeg and compute orientation, a sharpness score (edge energy), a quality
// score, and a subject focal point (skin-tone centroid) for face-safe cropping.
//
// Usage: node scripts/analyzePhotos.mjs [--dir input] [--out analysis/photos.json]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const dirIdx = process.argv.indexOf("--dir");
const inputDir = path.resolve(root, dirIdx >= 0 ? process.argv[dirIdx + 1] : "input");
const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : "analysis/photos.json";
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_, e) => "ffprobe" + (e || ""));

const N = 96; // analysis frame size (NxN)

// Every downstream consumer (hero ranking by qualityNorm, portrait/landscape slot
// filling by orient, face-safe crop by focusX/focusY) silently degrades to
// garbage if these two probes fail: w=h=0 makes every photo "landscape", and a
// null frame makes every quality 0 so the ranking becomes file order. That is
// exactly what happened once when this ran without FFMPEG_PATH on PATH. So both
// probes now REPORT failure instead of returning a zero-shaped record, and the
// run aborts below rather than writing a plausible-looking but dead file.
function probeDims(file) {
  const r = spawnSync(ffprobe, ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", file], { encoding: "utf8" });
  if (r.error) return { err: `ffprobe not runnable (${ffprobe}): ${r.error.message}` };
  if (r.status !== 0) return { err: `ffprobe exit ${r.status}: ${(r.stderr || "").trim().slice(0, 160)}` };
  const [w, h] = (r.stdout || "").trim().split("x").map(Number);
  if (!w || !h) return { err: `ffprobe gave no dimensions (stdout: ${JSON.stringify((r.stdout || "").trim())})` };
  return { w, h };
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

const files = fs.readdirSync(inputDir)
  .filter((n) => /\.(jpe?g|png)$/i.test(n))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

if (!files.length) { console.error(`[analyzePhotos] FAILED: no .jpg/.png found in ${inputDir}`); process.exit(1); }

const photos = [];
const failures = [];
for (const name of files) {
  const abs = path.join(inputDir, name);
  const dims = probeDims(abs);
  const frame = rgbFrame(abs);
  if (dims.err || frame.err) { failures.push(`${name}: ${dims.err || frame.err}`); continue; }
  const { w, h } = dims, buf = frame.buf;
  let sharpness = 0, meanLuma = 0, skinN = 0, sxAcc = 0, syAcc = 0;
  {
    // luma grid + gradient (sharpness) + skin centroid
    const luma = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const o = (y * N + x) * 3, R = buf[o], G = buf[o + 1], B = buf[o + 2];
      luma[y * N + x] = 0.299 * R + 0.587 * G + 0.114 * B;
      meanLuma += luma[y * N + x];
      if (isSkin(R, G, B)) { skinN++; sxAcc += x; syAcc += y; }
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
  // focal point: skin centroid if enough skin, else weighted toward upper-center
  let focusX = 0.5, focusY = 0.45;
  if (skinFrac > 0.02) { focusX = +(sxAcc / skinN / (N - 1)).toFixed(3); focusY = +(syAcc / skinN / (N - 1)).toFixed(3); }
  // quality: sharpness, penalize very dark/bright frames
  const exposurePenalty = Math.abs(meanLuma - 128) / 128; // 0 good, 1 bad
  const quality = +(sharpness * (1 - 0.5 * exposurePenalty)).toFixed(3);
  photos.push({
    file: `${path.basename(inputDir)}/${name}`,
    w, h, orient: w >= h ? "landscape" : "portrait",
    sharpness: +sharpness.toFixed(3), meanLuma: +meanLuma.toFixed(1),
    skinFrac: +skinFrac.toFixed(3), focusX, focusY, quality,
  });
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
for (const p of photos) p.qualityNorm = +((p.quality - qmin) / (qmax - qmin)).toFixed(3);

fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify({ dir: path.basename(inputDir), count: photos.length, photos }, null, 2));
const top = [...photos].sort((a, b) => b.qualityNorm - a.qualityNorm).slice(0, 5).map((p) => p.file).join(", ");
console.log(`Wrote ${outPath}: ${photos.length} photos. Top-quality: ${top}`);
