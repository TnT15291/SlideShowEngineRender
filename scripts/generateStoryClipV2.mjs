// Director v2: consumes analysis/photos.json + analysis/music/<track>.json to
// build a music- and photo-aware timeline. Adaptations over v1:
//   • hero/full-bleed slots get the highest-quality photos
//   • every image carries focusX/focusY (skin-tone centroid) → face-safe cover crop
//   • per-scene duration and crossfade length scale with the song's local energy
//     (quiet = longer, softer; energetic = quicker, snappier)
//   • montage length snaps to whole 4-beat bars from the estimated BPM
//
// Phase C — DIRECTOR-AWARE: if analysis/director_notes.json and/or
// analysis/story_plan.json exist (produced by the Phase B AI nodes), this
// generator follows the director's decisions instead of its hardcoded defaults:
//   • director_notes.montageEffect     → the montage effect (was always film_roll_up)
//   • director_notes.defaultTransition → transition between slides (was always crossfade)
//   • director_notes.endingTransition  → transition INTO the closing slide
//   • director_notes.colorCurves       → adds a curves preset to the global grade
//   • director_notes.overlayVariant    → adds a bundled light-leak overlay (only if the asset exists)
//   • story_plan[].emphasis (low/med/high) → a per-SEGMENT duration multiplier.
//     The AI only picks the enum; THIS code turns it into seconds (Phụ lục A #3).
// All inputs are optional; with none present the output is byte-for-byte the old
// behaviour, so the Lite pipeline (buildClip.mjs) is unaffected. Pass
// `--director none` / `--plan none` to force the defaults even if the files exist.
//
// Usage: node scripts/generateStoryClipV2.mjs [--music "music/a thousand years.mp3"]
//        [--out timeline/quoc-nhi-full-v2.json] [--director analysis/director_notes.json] [--plan analysis/story_plan.json]
import fs from "node:fs";
import path from "node:path";
import { makeEnergy, sceneDur, xfadeDur, barLength } from "./lib/pacing.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const musicPath = arg("--music", "music/a thousand years.mp3");
const outPath = arg("--out", "timeline/quoc-nhi-full-v2.json");
const directorArg = arg("--director", "analysis/director_notes.json");
const planArg = arg("--plan", "analysis/story_plan.json");
const photosPath = arg("--photos", "analysis/photos.json"); // Phase D can point this at a pruned copy

const photosDoc = JSON.parse(fs.readFileSync(path.resolve(root, photosPath), "utf8"));
const musicName = path.basename(musicPath).replace(/\.[^.]+$/, "");
const music = JSON.parse(fs.readFileSync(path.resolve(root, `analysis/music/${musicName}.json`), "utf8"));

// ---- optional director inputs (Phase C) ----
function loadOptional(p) {
  if (!p || p === "none") return null;
  const abs = path.resolve(root, p);
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, "utf8")); } catch { return null; }
}
const directorDoc = loadOptional(directorArg);
const planDoc = loadOptional(planArg);
const dir = directorDoc?.director_notes || {};
const assetChoices = directorDoc?.asset_choices || {};
const applied = []; // human-readable log of which director decisions took effect

function loadAssetCatalog() {
  const abs = path.resolve(root, "analysis/assets_catalog.full.json");
  if (!fs.existsSync(abs)) return null;
  try { return JSON.parse(fs.readFileSync(abs, "utf8")); } catch { return null; }
}
const assetCatalog = loadAssetCatalog();
function assetById(group, id) {
  if (!id || !assetCatalog || !Array.isArray(assetCatalog[group])) return null;
  return assetCatalog[group].find((a) => a.id === id) || null;
}

// Global stylistic knobs, each falling back to the original hardcoded value.
const MONTAGE_EFFECT = dir.montageEffect || "film_roll_up";
const DEFAULT_TRANS = dir.defaultTransition || "crossfade";
const ENDING_TRANS = dir.endingTransition || "crossfade";
const COLOR_CURVES = dir.colorCurves || null;
const OVERLAY_VARIANT = dir.overlayVariant || null;
if (dir.montageEffect && dir.montageEffect !== "film_roll_up") applied.push(`montage=${MONTAGE_EFFECT}`);
if (dir.defaultTransition && dir.defaultTransition !== "crossfade") applied.push(`transition=${DEFAULT_TRANS}`);
if (dir.endingTransition && dir.endingTransition !== "crossfade") applied.push(`ending=${ENDING_TRANS}`);
if (COLOR_CURVES) applied.push(`curves=${COLOR_CURVES}`);

// story_plan emphasis → per-segment duration multiplier. Each hardcoded beat is
// tagged with the act it belongs to; the AI's low/med/high becomes a number here.
const SEG_OF = {
  s01_hero: "opening",
  s02_japan: "love_story", s03_cungque: "love_story", m1: "love_story",
  s04_firstmeeting: "love_story", s05_ourstory: "love_story", s06_injapan: "love_story", m2: "love_story",
  s07_lovegrows: "love_story", s08_fouryears: "love_story", s09_promise: "love_story", m3: "love_story",
  s10_cominghome: "ceremony", s11_quangtri: "family_friends",
  s12_thebigday: "ending", s99_closing: "ending",
};
const EMPH_MUL = { low: 0.9, medium: 1.0, high: 1.12 };
const emphasisBySeg = {};
for (const s of planDoc?.segments || []) emphasisBySeg[s.segment] = s.emphasis;
const emphasisMul = (id) => EMPH_MUL[emphasisBySeg[SEG_OF[id]]] ?? 1.0;

const CREAM = "#FBF6ED", INK = "#2D2D33", BROWN = "#634C31";
const titleFontAsset = assetById("fonts", assetChoices.titleFontId);
const bodyFontAsset = assetById("fonts", assetChoices.bodyFontId);
const F_HEAD = titleFontAsset?.path || "fonts/PlayfairDisplay.ttf";
const F_BODY = bodyFontAsset?.path || "fonts/BeVietnamPro-Regular.ttf";
if (titleFontAsset) applied.push(`titleFont=${titleFontAsset.id}`);
if (bodyFontAsset) applied.push(`bodyFont=${bodyFontAsset.id}`);
const CARD = (r, b) => ({ radius: r, border: b, borderColor: "#FFFFFF", shadow: true });

const beats = [
  ["SAVE THE DATE", "Quốc & Nhi"],
  ["JAPAN BEGINNING", "Quốc làm việc tại Nhật, Nhi là du học sinh nơi đất khách."],
  ["CÙNG QUÊ", "Cùng quê hương, cùng xa nhà, hai người tìm thấy nhau giữa Nhật Bản."],
  ["FIRST MEETING", "Một lần gặp gỡ bình thường đã mở ra một hành trình rất dài."],
  ["OUR STORY", "Từ những ngày đầu bỡ ngỡ, cả hai dần trở thành điểm tựa của nhau."],
  ["IN JAPAN", "Những con phố, chuyến đi và ngày thường ở Nhật lưu lại thật nhiều kỷ niệm."],
  ["LOVE GROWS", "Tình yêu lớn lên qua sự quan tâm, chờ đợi và những lần cùng nhau cố gắng."],
  ["FOUR YEARS", "Bốn năm bên nhau, đủ để hiểu, thương và chọn đi tiếp cùng nhau."],
  ["PROMISE", "Từ Nhật Bản, lời hứa về một mái nhà chung ngày càng rõ ràng hơn."],
  ["COMING HOME", "Sau hành trình yêu xa quê, cả hai trở về với gia đình và quê hương."],
  ["QUẢNG TRỊ", "Đám cưới ở Quảng Trị là điểm hẹn của tình yêu và lời chúc phúc."],
  ["THE BIG DAY", "Hôm nay, câu chuyện Quốc và Nhi được kể lại bằng những nụ cười."],
];

// ---- photo pools ----
const byId = new Map(photosDoc.photos.map((p) => [p.file, p]));
const ordered = photosDoc.photos.map((p) => p.file);
const byQual = [...photosDoc.photos].sort((a, b) => b.qualityNorm - a.qualityNorm).map((p) => p.file);
const used = new Set();
const orientOf = (f) => byId.get(f)?.orient;
function takeBest(orient) {
  const f = byQual.find((x) => !used.has(x) && (!orient || orientOf(x) === orient)) || byQual.find((x) => !used.has(x)) || ordered[0];
  used.add(f); return f;
}
let seq = 0;
function takeSeq(orient) {
  for (let n = 0; n < ordered.length; n++) {
    const f = ordered[(seq + n) % ordered.length];
    if (!used.has(f) && (!orient || orientOf(f) === orient)) { seq = (seq + n + 1) % ordered.length; used.add(f); return f; }
  }
  const f = ordered[seq % ordered.length]; seq++; return f; // wrap (reuse) if exhausted
}
// image layer with focus attached from analysis
function pic(f, x, y, w, h, extra = {}) {
  const p = byId.get(f) || {};
  return { type: "image", path: f, x, y, width: w, height: h, fit: "cover", focusX: p.focusX ?? 0.5, focusY: p.focusY ?? 0.45, ...extra };
}
const txt = (t, font, x, y, w, h, size, color, align, extra = {}) =>
  ({ type: "text", text: t, font, x, y, width: w, height: h, size, color, align, ...extra });
const rect = (x, y, w, h, color, opacity, extra = {}) => ({ type: "rect", x, y, width: w, height: h, color, opacity, ...extra });

// ---- music-driven pacing helpers ----
// sceneDur/xfadeDur/energy now live in lib/pacing.mjs so the QA proxy (node 11)
// checks durations against the SAME curve this generator picked them from.
const energy = makeEnergy(music);
const energyAt = (t) => energy.at(t);   // quiet longer, loud shorter
const barLen = barLength(music);
const montageDur = Math.max(10, Math.min(15, Math.round(13 / barLen) * barLen));

// ---- layout templates (durations/transitions injected by caller) ----
function heroTitle([head, name]) {
  return { effect: "layer_scene", captions: [], layers: [
    pic(takeBest("landscape"), 0, 0, 1920, 1080, { motion: "zoom_in" }),
    rect(108, 92, 1704, 162, CREAM, 0.92, { animation: "fade" }),
    pic(takeBest("portrait"), 160, 300, 504, 512, { frame: CARD(26, 12), animation: "slide_up", start: 0.15 }),
    pic(takeBest("portrait"), 711, 300, 504, 512, { frame: CARD(26, 12), animation: "fade", start: 0.28 }),
    pic(takeBest("portrait"), 1262, 300, 504, 512, { frame: CARD(26, 12), animation: "slide_up", start: 0.4 }),
    txt(head, F_HEAD, 636, 142, 648, 151, 80, INK, "center", { animation: "fade", start: 0.1 }),
    rect(0, 850, 1920, 230, CREAM, 0.9, { animation: "fade", start: 0.45 }),
    txt(name, F_HEAD, 260, 890, 1400, 170, 104, BROWN, "center", { animation: "fade", start: 0.6 }),
  ] };
}
function textPhoto([head, line], side) {
  const right = side === "right";
  const tx = right ? 70 : 1020;
  return { effect: "layer_scene", captions: [], layers: [
    rect(0, 0, 1920, 1080, CREAM, 1),
    pic(takeBest("portrait"), right ? 1040 : 100, 90, 780, 900, { motion: "zoom_in", frame: CARD(28, 14), animation: right ? "slide_left" : "slide_right", start: 0.1 }),
    txt(head, F_HEAD, tx, 210, 900, 180, 90, BROWN, "left", { animation: "fade", start: 0.2 }),
    txt(line, F_BODY, tx, 470, 820, 380, 34, BROWN, "left", { lineSpacing: 20, wrap: true, animation: "fade", start: 0.6 }),
  ] };
}
function threeRow([head, line]) {
  return { effect: "layer_scene", captions: [], layers: [
    rect(0, 0, 1920, 1080, CREAM, 1),
    pic(takeSeq("landscape"), 108, 265, 551, 551, { frame: CARD(24, 12), animation: "slide_right", start: 0.15 }),
    pic(takeBest("portrait"), 709, 106, 500, 760, { motion: "zoom_in", frame: CARD(24, 12), animation: "slide_up", start: 0.28 }),
    pic(takeSeq("landscape"), 1262, 434, 551, 551, { frame: CARD(24, 12), animation: "slide_left", start: 0.4 }),
    txt(head, F_HEAD, 40, 91, 640, 150, 90, BROWN, "left", { animation: "fade", start: 0.2 }),
    txt(line, F_BODY, 60, 900, 1800, 130, 34, BROWN, "center", { lineSpacing: 14, wrap: true, animation: "fade", start: 0.55 }),
  ] };
}
function twoStory([head, line]) {
  return { effect: "layer_scene", captions: [], layers: [
    rect(0, 0, 1920, 1080, CREAM, 1),
    pic(takeBest("portrait"), 71, 130, 620, 660, { motion: "zoom_in", frame: CARD(26, 12), animation: "slide_up", start: 0.15 }),
    pic(takeSeq("landscape"), 906, 150, 940, 560, { motion: "pan_left", frame: CARD(26, 12), animation: "slide_left", start: 0.28 }),
    txt(head, F_HEAD, 906, 740, 940, 120, 68, BROWN, "center", { animation: "fade", start: 0.35 }),
    txt(line, F_BODY, 116, 900, 1688, 130, 33, BROWN, "center", { lineSpacing: 14, wrap: true, animation: "fade", start: 0.55 }),
  ] };
}
function cluster([head, line]) {
  return { effect: "layer_scene", captions: [], layers: [
    rect(0, 0, 1920, 1080, CREAM, 1),
    pic(takeSeq("landscape"), 36, 150, 500, 396, { frame: CARD(22, 10), animation: "slide_right", start: 0.15 }),
    pic(takeSeq("landscape"), 36, 565, 500, 396, { frame: CARD(22, 10), animation: "slide_right", start: 0.28 }),
    pic(takeBest("portrait"), 560, 110, 590, 860, { motion: "zoom_in", frame: CARD(26, 14), animation: "slide_up", start: 0.2 }),
    txt(head, F_HEAD, 1194, 170, 660, 150, 88, BROWN, "center", { animation: "fade", start: 0.3 }),
    txt(line, F_BODY, 1200, 430, 640, 560, 34, BROWN, "center", { lineSpacing: 20, wrap: true, animation: "fade", start: 0.6 }),
  ] };
}
function fullQuote([head, line]) {
  return { effect: "layer_scene", captions: [], layers: [
    pic(takeBest("landscape"), 0, 0, 1920, 1080, { motion: "zoom_in" }),
    rect(0, 600, 1920, 480, "#000000", 0.4, { animation: "fade" }),
    txt(head, F_HEAD, 260, 700, 1400, 90, 52, "#FFFFFF", "center", { animation: "fade", start: 0.3 }),
    txt(line, F_BODY, 260, 810, 1400, 220, 40, "#FFFFFF", "center", { lineSpacing: 16, wrap: true, animation: "fade", start: 0.5 }),
  ] };
}
function montageScene(count) {
  return { effect: MONTAGE_EFFECT, images: Array.from({ length: count }, () => takeSeq()), captions: [] };
}
function closing(name, dateLine) {
  return { effect: "layer_scene", captions: [], layers: [
    rect(0, 0, 1920, 1080, CREAM, 1),
    txt(name, F_HEAD, 260, 380, 1400, 240, 140, BROWN, "center", { animation: "fade", start: 0.4 }),
    txt(dateLine, F_BODY, 260, 660, 1400, 90, 44, BROWN, "center", { animation: "fade", start: 0.9 }),
  ] };
}

// plan: (kind, builder). Montages interleave every ~3 beats.
const plan = [
  { id: "s01_hero", b: heroTitle(beats[0]) },
  { id: "s02_japan", b: textPhoto(beats[1], "right") },
  { id: "s03_cungque", b: threeRow(beats[2]) },
  { id: "m1", b: montageScene(6), montage: true },
  { id: "s04_firstmeeting", b: textPhoto(beats[3], "left") },
  { id: "s05_ourstory", b: cluster(beats[4]) },
  { id: "s06_injapan", b: fullQuote(beats[5]) },
  { id: "m2", b: montageScene(6), montage: true },
  { id: "s07_lovegrows", b: textPhoto(beats[6], "right") },
  { id: "s08_fouryears", b: threeRow(beats[7]) },
  { id: "s09_promise", b: twoStory(beats[8]) },
  { id: "m3", b: montageScene(6), montage: true },
  { id: "s10_cominghome", b: textPhoto(beats[9], "left") },
  { id: "s11_quangtri", b: cluster(beats[10]) },
  { id: "s12_thebigday", b: fullQuote(beats[11]) },
  { id: "s99_closing", b: closing("Quốc & Nhi", "Quảng Trị · 2025") },
];

// forward pass: assign durations/crossfades from local song energy, adjusted by
// the director's transition choices and the story plan's per-segment emphasis.
let t = 0;
const slides = plan.map((p, i) => {
  const e = energyAt(t);
  const last = i === plan.length - 1;
  const intoClosing = plan[i + 1]?.id === "s99_closing"; // this slide's transition leads into the ending
  // base duration (montages stay music-bar-locked; closing fixed); story scenes take the emphasis multiplier
  let dur = p.montage ? montageDur : (p.id === "s99_closing" ? 8 : sceneDur(e) * emphasisMul(p.id));
  dur = Math.max(2, Math.min(30, dur)); // engine hard limits
  const type = last ? "none" : intoClosing ? ENDING_TRANS : DEFAULT_TRANS;
  const trans = last ? { type: "none", duration: 0 } : { type, duration: p.montage ? Math.min(0.6, xfadeDur(e)) : xfadeDur(e) };
  const slide = { id: p.id, duration: +dur.toFixed(2), ...p.b, transition: trans };
  t += dur - trans.duration;
  return slide;
});

// global color grade — the director may add a curves preset on top of the base grade
const color = { temperature: 5600, saturation: 1.05, contrast: 1.03, glow: 0.12 };
if (COLOR_CURVES) color.curves = COLOR_CURVES;

// director light-leak overlay — only attach if the bundled asset is actually present
let overlays;
const overlayAsset = assetById("overlays", assetChoices.overlayId);
if (overlayAsset) {
  if (overlayAsset.variant) {
    const asset = path.resolve(root, `overlays/light_leak_${overlayAsset.variant}.mp4`);
    if (fs.existsSync(asset)) {
      overlays = [{
        variant: overlayAsset.variant,
        blend: overlayAsset.recommendedBlend || "screen",
        opacity: overlayAsset.recommendedOpacity ?? 0.45,
      }];
      applied.push(`overlayId=${overlayAsset.id}`);
    } else {
      console.warn(`[director] overlay asset '${overlayAsset.id}' skipped - ${path.relative(root, asset)} missing`);
    }
  } else if (overlayAsset.path && fs.existsSync(path.resolve(root, overlayAsset.path))) {
    overlays = [{
      path: overlayAsset.path,
      position: "fullscreen",
      blend: overlayAsset.recommendedBlend || "screen",
      opacity: overlayAsset.recommendedOpacity ?? 0.35,
    }];
    applied.push(`overlayId=${overlayAsset.id}`);
  } else {
    console.warn(`[director] overlay asset '${overlayAsset.id}' skipped - path missing`);
  }
}
if (!overlays && OVERLAY_VARIANT) {
  const asset = path.resolve(root, `overlays/light_leak_${OVERLAY_VARIANT}.mp4`);
  if (!overlays && fs.existsSync(asset)) { overlays = [{ variant: OVERLAY_VARIANT, blend: "screen", opacity: 0.45 }]; applied.push(`overlay=${OVERLAY_VARIANT}`); }
  else console.warn(`[director] overlay '${OVERLAY_VARIANT}' skipped — ${path.relative(root, asset)} missing`);
}

const timeline = {
  project: { name: "quoc-nhi-full-v2", width: 1920, height: 1080, fps: 30, quality: "share" },
  music: [{ path: musicPath, volume: 0.8 }],
  audio: { fade_in: 1.5, fade_out: 3.5, crossfade: 0 },
  color,
  ...(overlays ? { overlays } : {}),
  output: { path: "output/quoc-nhi-full-v2.mp4" },
  slides,
};

fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(timeline, null, 2));
const dirNote = directorDoc
  ? ` Director[${directorDoc.choice || "?"}/${directorDoc.storyTitle || "?"}]: ${applied.length ? applied.join(", ") : "defaults (no override)"}.`
  : " Director: none (hardcoded defaults).";
const planNote = planDoc ? ` Plan emphasis: ${Object.entries(emphasisBySeg).map(([k, v]) => `${k}=${v}`).join(", ")}.` : "";
console.log(`Wrote ${outPath}: ${slides.length} scenes, ~${Math.round(t)}s, bpm≈${music.bpmEstimate}, bar=${barLen.toFixed(2)}s, montage=${montageDur.toFixed(1)}s. ` +
  `Photos used: ${used.size}/${ordered.length}. Music: ${musicName}.${dirNote}${planNote}`);
