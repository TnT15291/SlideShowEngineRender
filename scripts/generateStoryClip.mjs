// Deterministic "Director": turns the 12 story beats + input photos + music into
// a full layer_scene timeline (varied layouts, film-roll interludes, closing card),
// using the Phase 2 engine features (frame cards, Ken-Burns motion, text wrap).
//
// Usage: node scripts/generateStoryClip.mjs [--out timeline/quoc-nhi-full.json]
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const inputDir = path.join(root, "input");
const outArgIdx = process.argv.indexOf("--out");
const outPath = outArgIdx >= 0 ? process.argv[outArgIdx + 1] : "timeline/quoc-nhi-full.json";

// ---- theme tokens (white_weddings) ----
const CREAM = "#FBF6ED", INK = "#2D2D33", BROWN = "#634C31", WHITE = "#FFFDFC";
const F_HEAD = "fonts/PlayfairDisplay.ttf";   // VN-safe display
const F_BODY = "fonts/BeVietnamPro-Regular.ttf"; // VN body
const CARD = (r, b) => ({ radius: r, border: b, borderColor: "#FFFFFF", shadow: true });

// ---- 12 story beats (heading | line) ----
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

// ---- classify photos by orientation ----
const ffprobe = (process.env.FFMPEG_PATH || "ffmpeg")
  .replace(/ffmpeg(\.exe)?$/i, (_, e) => "ffprobe" + (e || ""));
const files = fs.readdirSync(inputDir)
  .filter((n) => /\.(jpe?g|png)$/i.test(n))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const portraits = [], landscapes = [], ordered = [];
for (const name of files) {
  let dim = "0x0";
  try {
    dim = execFileSync(ffprobe, ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0",
      path.join(inputDir, name)], { encoding: "utf8" }).trim();
  } catch { /* skip unreadable */ }
  const [w, h] = dim.split("x").map(Number);
  const p = `input/${name}`;
  ordered.push(p);
  (w >= h ? landscapes : portraits).push(p);
}
if (!ordered.length) throw new Error("No photos in input/");

// round-robin queues that wrap when exhausted
const mk = (list) => { let i = 0; return () => list[(i++) % list.length]; };
const nextPort = mk(portraits.length ? portraits : ordered);
const nextLand = mk(landscapes.length ? landscapes : ordered);
let oi = 0;
const nextAny = () => ordered[(oi++) % ordered.length];
const nextN = (n) => Array.from({ length: n }, nextAny);

const img = (p, x, y, w, h, extra = {}) => ({ type: "image", path: p, x, y, width: w, height: h, fit: "cover", ...extra });
const txt = (t, font, x, y, w, h, size, color, align, extra = {}) =>
  ({ type: "text", text: t, font, x, y, width: w, height: h, size, color, align, ...extra });
const rect = (x, y, w, h, color, opacity, extra = {}) => ({ type: "rect", x, y, width: w, height: h, color, opacity, ...extra });

// ---- layout templates ----
function heroTitle([head, name], dur) {
  return {
    id: "s01_hero", duration: dur, effect: "layer_scene",
    transition: { type: "crossfade", duration: 0.8 }, captions: [],
    layers: [
      img(nextLand(), 0, 0, 1920, 1080, { motion: "zoom_in" }),
      rect(108, 92, 1704, 162, CREAM, 0.92, { animation: "fade" }),
      img(nextPort(), 160, 300, 504, 512, { frame: CARD(26, 12), animation: "slide_up", start: 0.15 }),
      img(nextPort(), 711, 300, 504, 512, { frame: CARD(26, 12), animation: "fade", start: 0.28 }),
      img(nextPort(), 1262, 300, 504, 512, { frame: CARD(26, 12), animation: "slide_up", start: 0.4 }),
      txt(head, F_HEAD, 636, 142, 648, 151, 80, INK, "center", { animation: "fade", start: 0.1 }),
      rect(0, 850, 1920, 230, CREAM, 0.9, { animation: "fade", start: 0.45 }),
      txt(name, F_HEAD, 260, 890, 1400, 170, 104, BROWN, "center", { animation: "fade", start: 0.6 }),
    ],
  };
}
function textPhoto([head, line], dur, id, side, trans = 0.7) {
  const photoRight = side === "right";
  const photo = img(nextPort(), photoRight ? 1040 : 100, 90, 780, 900,
    { motion: "zoom_in", frame: CARD(28, 14), animation: photoRight ? "slide_left" : "slide_right", start: 0.1 });
  const tx = photoRight ? 70 : 1020;
  return {
    id, duration: dur, effect: "layer_scene",
    transition: { type: "crossfade", duration: trans }, captions: [],
    layers: [
      rect(0, 0, 1920, 1080, CREAM, 1),
      photo,
      txt(head, F_HEAD, tx, 210, 900, 180, 90, BROWN, "left", { animation: "fade", start: 0.2 }),
      txt(line, F_BODY, tx, 470, 820, 380, 34, BROWN, "left", { lineSpacing: 20, wrap: true, animation: "fade", start: 0.6 }),
    ],
  };
}
function threeRow([head, line], dur, id, trans = 0.6) {
  return {
    id, duration: dur, effect: "layer_scene",
    transition: { type: "crossfade", duration: trans }, captions: [],
    layers: [
      rect(0, 0, 1920, 1080, CREAM, 1),
      img(nextLand(), 108, 265, 551, 551, { frame: CARD(24, 12), animation: "slide_right", start: 0.15 }),
      img(nextPort(), 709, 106, 500, 760, { motion: "zoom_in", frame: CARD(24, 12), animation: "slide_up", start: 0.28 }),
      img(nextLand(), 1262, 434, 551, 551, { frame: CARD(24, 12), animation: "slide_left", start: 0.4 }),
      txt(head, F_HEAD, 40, 91, 640, 150, 90, BROWN, "left", { animation: "fade", start: 0.2 }),
      txt(line, F_BODY, 60, 885, 1800, 130, 34, BROWN, "center", { lineSpacing: 14, wrap: true, animation: "fade", start: 0.55 }),
    ],
  };
}
function twoStory([head, line], dur, id, trans = 0.6) {
  return {
    id, duration: dur, effect: "layer_scene",
    transition: { type: "crossfade", duration: trans }, captions: [],
    layers: [
      rect(0, 0, 1920, 1080, CREAM, 1),
      img(nextPort(), 71, 130, 620, 660, { motion: "zoom_in", frame: CARD(26, 12), animation: "slide_up", start: 0.15 }),
      img(nextLand(), 906, 150, 940, 560, { motion: "pan_left", frame: CARD(26, 12), animation: "slide_left", start: 0.28 }),
      txt(head, F_HEAD, 906, 740, 940, 120, 68, BROWN, "center", { animation: "fade", start: 0.35 }),
      txt(line, F_BODY, 116, 900, 1688, 130, 33, BROWN, "center", { lineSpacing: 14, wrap: true, animation: "fade", start: 0.55 }),
    ],
  };
}
function cluster([head, line], dur, id, trans = 0.6) {
  return {
    id, duration: dur, effect: "layer_scene",
    transition: { type: "crossfade", duration: trans }, captions: [],
    layers: [
      rect(0, 0, 1920, 1080, CREAM, 1),
      img(nextLand(), 36, 150, 500, 396, { frame: CARD(22, 10), animation: "slide_right", start: 0.15 }),
      img(nextLand(), 36, 565, 500, 396, { frame: CARD(22, 10), animation: "slide_right", start: 0.28 }),
      img(nextPort(), 560, 110, 590, 860, { motion: "zoom_in", frame: CARD(26, 14), animation: "slide_up", start: 0.2 }),
      txt(head, F_HEAD, 1194, 170, 660, 150, 88, BROWN, "center", { animation: "fade", start: 0.3 }),
      txt(line, F_BODY, 1200, 430, 640, 560, 34, BROWN, "center", { lineSpacing: 20, wrap: true, animation: "fade", start: 0.6 }),
    ],
  };
}
function fullQuote([head, line], dur, id, trans = 0.7) {
  return {
    id, duration: dur, effect: "layer_scene",
    transition: { type: "crossfade", duration: trans }, captions: [],
    layers: [
      img(nextLand(), 0, 0, 1920, 1080, { motion: "zoom_in" }),
      rect(0, 600, 1920, 480, "#000000", 0.4, { animation: "fade" }),
      txt(head, F_HEAD, 260, 700, 1400, 90, 52, "#FFFFFF", "center", { animation: "fade", start: 0.3 }),
      txt(line, F_BODY, 260, 810, 1400, 220, 40, "#FFFFFF", "center", { lineSpacing: 16, wrap: true, animation: "fade", start: 0.5 }),
    ],
  };
}
function montage(id, count, dur, trans = 0.6) {
  return {
    id, duration: dur, effect: "film_roll_up",
    images: nextN(count),
    transition: { type: "crossfade", duration: trans }, captions: [],
  };
}
function closing(name, dateLine, dur) {
  return {
    id: "s99_closing", duration: dur, effect: "layer_scene",
    transition: { type: "none", duration: 0 }, captions: [],
    layers: [
      rect(0, 0, 1920, 1080, CREAM, 1),
      txt(name, F_HEAD, 260, 380, 1400, 240, 140, BROWN, "center", { animation: "fade", start: 0.4 }),
      txt(dateLine, F_BODY, 260, 660, 1400, 90, 44, BROWN, "center", { animation: "fade", start: 0.9 }),
    ],
  };
}

// ---- assemble the film ----
const slides = [];
slides.push(heroTitle(beats[0], 6.5));
slides.push(textPhoto(beats[1], 6.0, "s02_japan", "right"));
slides.push(threeRow(beats[2], 5.5, "s03_cungque"));
slides.push(montage("m1_interlude", 6, 13));
slides.push(textPhoto(beats[3], 6.0, "s04_firstmeeting", "left"));
slides.push(cluster(beats[4], 6.0, "s05_ourstory"));
slides.push(fullQuote(beats[5], 6.5, "s06_injapan"));
slides.push(montage("m2_interlude", 6, 13));
slides.push(textPhoto(beats[6], 6.0, "s07_lovegrows", "right"));
slides.push(threeRow(beats[7], 5.5, "s08_fouryears"));
slides.push(twoStory(beats[8], 5.5, "s09_promise"));
slides.push(montage("m3_interlude", 6, 13));
slides.push(textPhoto(beats[9], 6.0, "s10_cominghome", "left"));
slides.push(cluster(beats[10], 6.0, "s11_quangtri"));
slides.push(fullQuote(beats[11], 6.5, "s12_thebigday"));
slides.push(closing("Quốc & Nhi", "Quảng Trị · 2025", 8.0));

const timeline = {
  project: { name: "quoc-nhi-full", width: 1920, height: 1080, fps: 30, quality: "share" },
  music: [{ path: "music/a thousand years.mp3", volume: 0.8 }],
  audio: { fade_in: 1.5, fade_out: 3.0, crossfade: 0 },
  color: { temperature: 5600, saturation: 1.05, contrast: 1.03, glow: 0.12 },
  output: { path: "output/quoc-nhi-full.mp4" },
  slides,
};

fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(timeline, null, 2));
const total = slides.reduce((a, s) => a + s.duration, 0);
console.log(`Wrote ${outPath}: ${slides.length} scenes, ~${Math.round(total)}s raw (photos: ${portraits.length} portrait / ${landscapes.length} landscape).`);
