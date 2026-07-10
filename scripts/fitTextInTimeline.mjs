// Phase 4 text auto-fit: measure real rendered text width with ffmpeg and
// re-wrap + shrink each text layer so no line overflows its slot (width) and the
// block fits the slot height. Replaces the compile-time char-count wrap with a
// precise, glyph-accurate layout. Writes the adjusted timeline in place.
//
// Usage: node scripts/fitTextInTimeline.mjs timeline/quoc-nhi-full-v2.json
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tlPath = process.argv[2];
if (!tlPath) throw new Error("Usage: node scripts/fitTextInTimeline.mjs <timeline.json>");
const abs = path.resolve(root, tlPath);
const tl = JSON.parse(fs.readFileSync(abs, "utf8"));
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
// Relative paths only in the filtergraph: a Windows drive colon (C:) collides
// with drawtext's option separator and this ffmpeg build won't parse the escape.
fs.mkdirSync(path.join(root, "temp"), { recursive: true });
const tmpRel = "temp/fit_measure.txt";
const tmpAbs = path.join(root, tmpRel);

// measure rendered width/height (px) of one line of text. Returns w=0 when the
// render fails (e.g. an absolute font path) so the caller can skip fitting.
const cache = new Map();
function measure(text, fontRel, size) {
  const key = `${size}|${fontRel}|${text}`;
  if (cache.has(key)) return cache.get(key);
  const W = 3800, H = Math.ceil(size * 1.8) + 40;
  fs.writeFileSync(tmpAbs, text, "utf8");
  const font = /^[A-Za-z]:/.test(fontRel) ? null : fontRel; // skip absolute-path fonts
  let out = { w: 0, h: 0 };
  if (font) {
    const vf = `drawtext=fontfile=${font}:textfile=${tmpRel}:fontcolor=white:fontsize=${size}:x=0:y=10,format=gray`;
    const r = spawnSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", `color=black:s=${W}x${H}`,
      "-vf", vf, "-frames:v", "1", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
    const buf = r.stdout;
    let maxX = 0, maxY = 0;
    if (buf && buf.length >= W * H) {
      for (let y = 0; y < H; y++) { const row = y * W; for (let x = W - 1; x > maxX; x--) if (buf[row + x] > 24) { maxX = x; break; } }
      for (let y = H - 1; y > maxY; y--) { const row = y * W; for (let x = 0; x < W; x++) if (buf[row + x] > 24) { maxY = y; break; } }
    }
    if (maxX > 0) out = { w: maxX + 1, h: maxY + 1 };
  }
  cache.set(key, out);
  return out;
}

// greedy word-wrap using measured widths so each line fits maxW
function wrapMeasured(text, fontRel, size, maxW) {
  const lines = [];
  for (const seg of text.split("\n")) {
    const words = seg.split(/\s+/).filter(Boolean);
    let line = "";
    for (const w of words) {
      const next = line ? `${line} ${w}` : w;
      if (line && measure(next, fontRel, size).w > maxW) { lines.push(line); line = w; }
      else line = next;
    }
    if (line) lines.push(line);
  }
  return lines;
}

const DEFAULT_FONT = "C:/Windows/Fonts/arial.ttf";
let adjusted = 0;
for (const slide of tl.slides) {
  for (const layer of slide.layers || []) {
    if (layer.type !== "text") continue;
    const font = layer.font || DEFAULT_FONT;
    const boxW = layer.width, boxH = layer.height;
    let size = layer.size;
    if (measure(layer.text.split("\n")[0], font, size).w === 0) continue; // unmeasurable font -> leave as-is
    // shrink until wrapped block fits width (per line) AND height (line count)
    for (let iter = 0; iter < 8; iter++) {
      const lines = wrapMeasured(layer.text, font, size, boxW);
      const lineH = size * 1.32 + (layer.lineSpacing || 0);
      const blockH = lines.length * lineH;
      const widest = Math.max(...lines.map((l) => measure(l, font, size).w), 1);
      if (widest <= boxW && blockH <= boxH) {
        const wrapped = lines.join("\n");
        if (wrapped !== layer.text || size !== layer.size) adjusted++;
        layer.text = wrapped; layer.size = size; delete layer.wrap;
        break;
      }
      size = Math.max(14, Math.floor(size * Math.min(boxW / widest, boxH / blockH, 0.94)));
      if (size <= 14) { layer.text = lines.join("\n"); layer.size = size; delete layer.wrap; adjusted++; break; }
    }
  }
}
try { fs.unlinkSync(tmpAbs); } catch {}
fs.writeFileSync(abs, JSON.stringify(tl, null, 2));
console.log(`Text auto-fit: adjusted ${adjusted} text layer(s) in ${path.basename(tlPath)}.`);
