// Glyph-accurate text fitter shared by timeline captions and recipe text layers.
import fs from "node:fs";
import path from "node:path";
import { createTextMeasurer } from "./lib/textMeasure.mjs";
// Same budget the story prompt is written against — see lib/textBudget.mjs.
import { readingLimit as readingLimitFor } from "./lib/textBudget.mjs";

const root = process.cwd();
const tlPath = process.argv[2];
if (!tlPath) throw new Error("Usage: node scripts/fitTextInTimeline.mjs <timeline.json> [--out analysis/text-fit.json]");
const arg = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const abs = path.resolve(root, tlPath);
const tl = JSON.parse(fs.readFileSync(abs, "utf8"));
const measurer = createTextMeasurer({ root, ffmpeg: process.env.FFMPEG_PATH || "ffmpeg" });
const DEFAULT_FONT = "C:/Windows/Fonts/arial.ttf";
const ROLE = {
  title: { size: 83, min: 44, maxLines: 3 },
  subtitle: { size: 42, min: 30, maxLines: 3 },
  caption: { size: 49, min: 28, maxLines: 3 },
  heading: { size: 64, min: 34, maxLines: 3 },
  body: { size: 42, min: 24, maxLines: 3 },
};
const report = { version: 1, timeline: tlPath.replace(/\\/g, "/"), adjusted: 0, entries: [], blockers: [] };

function fit({ text, font, size, minSize, maxWidth, maxHeight, maxLines, lineSpacing = 0 }) {
  const original = String(text || "").replace(/\s+/g, " ").trim();
  const wrapEstimate = (value, currentSize) => {
    const maxChars = Math.max(4, Math.floor(maxWidth / (currentSize * 0.56)));
    const lines = [];
    let line = "";
    for (const word of value.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && next.length > maxChars) { lines.push(line); line = word; }
      else line = next;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  };
  const measureAt = (value, currentSize) => {
    const lines = wrapEstimate(value, currentSize);
    const measured = lines.map((line) => measurer.measure(line, font, currentSize));
    const error = measured.find((row) => row.error)?.error || null;
    const blockHeight = lines.length * (currentSize * 1.32 + lineSpacing);
    return { lines, error, blockHeight, widest: Math.max(0, ...measured.map((row) => row.w)),
      fits: !error && lines.length <= maxLines && blockHeight <= maxHeight && measured.every((row) => row.w <= maxWidth) };
  };
  let currentSize = Math.max(minSize, Math.round(size));
  let currentText = original;
  let measured = measureAt(currentText, currentSize);
  for (let iteration = 0; !measured.fits && !measured.error && currentSize > minSize && iteration < 5; iteration++) {
    const scale = Math.min(maxWidth / Math.max(1, measured.widest), maxHeight / Math.max(1, measured.blockHeight),
      maxLines / Math.max(1, measured.lines.length), 0.92);
    currentSize = Math.max(minSize, Math.floor(currentSize * Math.max(0.55, scale)));
    measured = measureAt(currentText, currentSize);
  }
  let shortened = false;
  if (!measured.fits && !measured.error) {
    const heightLines = Math.max(1, Math.floor(maxHeight / (currentSize * 1.32 + lineSpacing)));
    const allowedLines = Math.min(maxLines, heightLines);
    const maxChars = Math.max(8, Math.floor(allowedLines * maxWidth / (currentSize * 0.56)));
    const cut = currentText.slice(0, maxChars);
    const boundary = cut.lastIndexOf(" ");
    currentText = `${cut.slice(0, boundary > maxChars * 0.6 ? boundary : maxChars).trim()}…`;
    shortened = true;
    measured = measureAt(currentText, currentSize);
    for (let attempt = 0; !measured.fits && !measured.error && attempt < 8; attempt++) {
      const words = currentText.replace(/…$/, "").trim().split(/\s+/);
      if (words.length <= 2) break;
      words.pop();
      currentText = `${words.join(" ")}…`;
      measured = measureAt(currentText, currentSize);
    }
  }
  return { original, final: measured.lines.join("\n"), size: currentSize, lines: measured.lines.length,
    fits: measured.fits, error: measured.error, shortened, widest: measured.widest, blockHeight: measured.blockHeight };
}

for (const slide of tl.slides) {
  const layers = slide.layers || [];
  for (const [index, layer] of layers.entries()) {
    if (layer.type !== "text") continue;
    const role = ROLE[layer.fontRole || layer.role] || ROLE.body;
    const originalSize = layer.size || role.size;
    const result = fit({ text: layer.text, font: layer.font || DEFAULT_FONT, size: layer.size || role.size,
      minSize: role.min, maxWidth: layer.width, maxHeight: layer.height, maxLines: role.maxLines, lineSpacing: layer.lineSpacing || 0 });
    const readingLimit = readingLimitFor(tl.language);
    const duration = Math.max(0.1, Number(slide.duration) || 0.1);
    const units = tl.language === "en" ? result.final.trim().split(/\s+/).filter(Boolean).length : result.final.replace(/\s/g, "").length;
    let finalResult = result;
    if (units / duration > readingLimit) {
      const words = result.final.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
      const allowed = Math.floor(duration * readingLimit);
      while (words.length > 2 && (tl.language === "en" ? words.length : words.join("").length) > allowed) words.pop();
      finalResult = fit({ text: `${words.join(" ")}…`, font: layer.font || DEFAULT_FONT, size: layer.size || role.size,
        minSize: role.min, maxWidth: layer.width, maxHeight: layer.height, maxLines: role.maxLines, lineSpacing: layer.lineSpacing || 0 });
      finalResult.shortened = true;
    }
    layer.text = finalResult.final;
    layer.size = finalResult.size;
    delete layer.wrap;
    if (finalResult.original !== finalResult.final || finalResult.size !== originalSize) report.adjusted++;
    const entry = { sceneId: slide.id, source: "layer", index, role: layer.fontRole || layer.role || "body", ...finalResult,
      readingRate: +(Math.min(units, tl.language === "en" ? finalResult.final.trim().split(/\s+/).filter(Boolean).length : finalResult.final.replace(/\s/g, "").length) / duration).toFixed(2), readingLimit };
    report.entries.push(entry);
    if (!finalResult.fits || entry.readingRate > readingLimit) report.blockers.push(entry);
  }

  for (const [index, caption] of (slide.captions || []).entries()) {
    const role = ROLE[caption.role] || ROLE.caption;
    const font = caption.font || DEFAULT_FONT;
    const startSize = caption.size || role.size;
    const availableDuration = Math.max(0.1, slide.duration - (Number(caption.start) || 0));
    const originalText = String(caption.text || "");
    let result = fit({ text: originalText, font, size: startSize, minSize: role.min,
      maxWidth: tl.project.width * 0.86, maxHeight: tl.project.height * 0.34, maxLines: role.maxLines });
    const readingLimit = readingLimitFor(tl.language);
    const readingUnits = () => tl.language === "en" ? result.final.trim().split(/\s+/).filter(Boolean).length : result.final.replace(/\s/g, "").length;
    const allowedUnits = Math.max(1, Math.floor(availableDuration * readingLimit));
    if (readingUnits() > allowedUnits) {
      const words = result.final.replace(/\n/g, " ").split(/\s+/).filter(Boolean);
      while (words.length > 2 && (tl.language === "en" ? words.length : words.join("").length) > allowedUnits) words.pop();
      result = fit({ text: `${words.join(" ")}…`, font, size: startSize, minSize: role.min,
        maxWidth: tl.project.width * 0.86, maxHeight: tl.project.height * 0.34, maxLines: role.maxLines });
      result.shortened = true;
    }
    caption.text = result.final;
    caption.size = result.size;
    caption.font = font;
    caption.duration = +availableDuration.toFixed(3);
    caption.shadow = true;
    caption.outline ||= { color: "#000000", width: 2 };
    if (originalText !== result.final || startSize !== result.size) report.adjusted++;
    const rate = caption.duration > 0 ? +(readingUnits() / caption.duration).toFixed(2) : Infinity;
    const entry = { sceneId: slide.id, source: "caption", index, role: caption.role, ...result, readingRate: rate, readingLimit };
    report.entries.push(entry);
    if (!result.fits || rate > readingLimit) report.blockers.push(entry);
  }

  // Text over a photo needs a declared backing surface.
  for (let index = layers.length - 1; index >= 0; index--) {
    const text = layers[index];
    if (text.type !== "text") continue;
    const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
    const photoBelow = layers.slice(0, index).some((layer) => layer.type === "image" && overlaps(text, layer));
    const backingBelow = layers.slice(0, index).some((layer) => layer.type === "rect" && overlaps(text, layer) && (layer.opacity ?? 1) >= 0.25);
    if (photoBelow && !backingBelow) {
      layers.splice(index, 0, { type: "rect", x: Math.max(0, text.x - 24), y: Math.max(0, text.y - 16),
        width: Math.min(tl.project.width - Math.max(0, text.x - 24), text.width + 48),
        height: Math.min(tl.project.height - Math.max(0, text.y - 16), text.height + 32), color: "#000000", opacity: 0.42 });
      report.adjusted++;
    }
  }
}
measurer.close();
fs.writeFileSync(abs, JSON.stringify(tl, null, 2) + "\n");
const inferred = path.resolve(path.dirname(abs), "..", "analysis", "text-fit.json");
const reportPath = path.resolve(root, arg("--out", inferred));
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`Text auto-fit: adjusted ${report.adjusted} item(s), ${report.blockers.length} blocker(s) -> ${path.relative(root, reportPath)}.`);
if (report.blockers.length) process.exitCode = 1;
