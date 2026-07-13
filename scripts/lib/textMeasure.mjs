import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

export function createTextMeasurer({ root = process.cwd(), ffmpeg = process.env.FFMPEG_PATH || "ffmpeg" } = {}) {
  const cache = new Map();
  const tmp = path.join(os.tmpdir(), `slideshow-text-${process.pid}-${Math.random().toString(16).slice(2)}.txt`);

  function measure(text, fontPath, size) {
    const font = path.isAbsolute(fontPath) ? fontPath : path.resolve(root, fontPath);
    const key = `${size}|${font}|${text}`;
    if (cache.has(key)) return cache.get(key);
    if (!fs.existsSync(font)) return { w: 0, h: 0, error: `font not found: ${fontPath}` };
    fs.writeFileSync(tmp, text || " ", "utf8");
    const W = 4096, H = Math.ceil(size * 2) + 40;
    const esc = (s) => s.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    const vf = `drawtext=fontfile='${esc(font)}':textfile='${esc(tmp)}':fontcolor=white:fontsize=${size}:x=0:y=10,format=gray`;
    const r = spawnSync(ffmpeg, ["-v", "error", "-f", "lavfi", "-i", `color=black:s=${W}x${H}`,
      "-vf", vf, "-frames:v", "1", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
    let out = { w: 0, h: 0, error: r.status === 0 ? null : (r.stderr || "measure failed").toString().slice(0, 200) };
    const buf = r.stdout;
    if (buf?.length >= W * H) {
      let maxX = -1, minY = H, maxY = -1;
      for (let y = 0; y < H; y++) for (let x = W - 1; x >= 0; x--) {
        if (buf[y * W + x] > 24) { maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); break; }
      }
      if (maxX >= 0) out = { w: maxX + 1, h: maxY - minY + 1, error: null };
    }
    cache.set(key, out);
    return out;
  }

  function wrap(text, font, size, maxW) {
    const lines = [];
    for (const segment of String(text).split("\n")) {
      let line = "";
      for (const word of segment.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (line && measure(next, font, size).w > maxW) { lines.push(line); line = word; }
        else line = next;
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  function balance(lines, font, size, maxW) {
    if (lines.length < 2) return lines;
    const out = [...lines];
    // Avoid a one-word final line when moving the previous line's last word fits.
    const lastWords = out.at(-1).split(/\s+/);
    const prevWords = out.at(-2).split(/\s+/);
    if (lastWords.length === 1 && prevWords.length > 1) {
      const moved = prevWords.at(-1);
      const candidateLast = `${moved} ${out.at(-1)}`;
      if (measure(candidateLast, font, size).w <= maxW) {
        out[out.length - 2] = prevWords.slice(0, -1).join(" ");
        out[out.length - 1] = candidateLast;
      }
    }
    return out;
  }

  function inspect(layer) {
    const font = layer.font || "C:/Windows/Fonts/arial.ttf";
    const lines = wrap(layer.text, font, layer.size, layer.width);
    const measured = lines.map((line) => measure(line, font, layer.size));
    const error = measured.find((m) => m.error)?.error || null;
    const lineHeight = layer.size * 1.32 + (layer.lineSpacing || 0);
    return {
      lines,
      widest: Math.max(0, ...measured.map((m) => m.w)),
      blockHeight: lines.length * lineHeight,
      error,
      fits: !error && measured.every((m) => m.w <= layer.width) && lines.length * lineHeight <= layer.height,
    };
  }

  return { measure, wrap, balance, inspect, close() { try { fs.unlinkSync(tmp); } catch {} } };
}
