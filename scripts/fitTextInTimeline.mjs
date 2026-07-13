// Phase 4 text auto-fit: measure real rendered text width with ffmpeg and
// re-wrap + shrink each text layer so no line overflows its slot (width) and the
// block fits the slot height. Replaces the compile-time char-count wrap with a
// precise, glyph-accurate layout. Writes the adjusted timeline in place.
//
// Usage: node scripts/fitTextInTimeline.mjs timeline/quoc-nhi-full-v2.json
import fs from "node:fs";
import path from "node:path";
import { createTextMeasurer } from "./lib/textMeasure.mjs";

const root = process.cwd();
const tlPath = process.argv[2];
if (!tlPath) throw new Error("Usage: node scripts/fitTextInTimeline.mjs <timeline.json>");
const abs = path.resolve(root, tlPath);
const tl = JSON.parse(fs.readFileSync(abs, "utf8"));
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const measurer = createTextMeasurer({ root, ffmpeg });

const DEFAULT_FONT = "C:/Windows/Fonts/arial.ttf";
let adjusted = 0;
for (const slide of tl.slides) {
  const layers = slide.layers || [];
  for (const layer of slide.layers || []) {
    if (layer.type !== "text") continue;
    const font = layer.font || DEFAULT_FONT;
    const boxW = layer.width, boxH = layer.height;
    let size = layer.size;
    if (measurer.measure(layer.text.split("\n")[0], font, size).error) continue;
    // shrink until wrapped block fits width (per line) AND height (line count)
    for (let iter = 0; iter < 8; iter++) {
      const lines = measurer.balance(measurer.wrap(layer.text, font, size, boxW), font, size, boxW);
      const lineH = size * 1.32 + (layer.lineSpacing || 0);
      const blockH = lines.length * lineH;
      const widest = Math.max(...lines.map((l) => measurer.measure(l, font, size).w), 1);
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
  // Text over a photo needs a declared backing surface. This is conservative by
  // design: it protects readability without pretending a bbox rule sampled pixels.
  for (let i = layers.length - 1; i >= 0; i--) {
    const text = layers[i];
    if (text.type !== "text") continue;
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const photoBelow = layers.slice(0, i).some((l) => l.type === "image" && overlaps(text, l));
    const backingBelow = layers.slice(0, i).some((l) => l.type === "rect" && overlaps(text, l) && (l.opacity ?? 1) >= 0.25);
    if (photoBelow && !backingBelow) {
      layers.splice(i, 0, { type: "rect", x: Math.max(0, text.x - 24), y: Math.max(0, text.y - 16),
        width: text.width + 48, height: text.height + 32, color: "#000000", opacity: 0.42 });
      adjusted++;
    }
  }
}
measurer.close();
fs.writeFileSync(abs, JSON.stringify(tl, null, 2));
console.log(`Text auto-fit: adjusted ${adjusted} text layer(s) in ${path.basename(tlPath)}.`);
