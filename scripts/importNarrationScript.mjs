import fs from "node:fs";
import path from "node:path";
import { arg, loadProject } from "./lib/project.mjs";

function splitLongClause(text, limit) {
  const words = text.trim().split(/\s+/);
  const chunks = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && candidate.length > limit) {
      chunks.push(current);
      current = word;
    } else current = candidate;
  }
  if (current) chunks.push(current);
  return chunks;
}

export function splitNarration(paragraph, target = 280, hardLimit = 380) {
  const sentences = paragraph.trim().split(/(?<=[.!?])\s+/u).filter(Boolean);
  const units = sentences.flatMap((sentence) => {
    if (sentence.length <= hardLimit) return [sentence];
    return sentence.split(/(?<=[,;:])\s+/u).flatMap((clause) =>
      clause.length <= hardLimit ? [clause] : splitLongClause(clause, target));
  });
  const chunks = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current} ${unit}` : unit;
    if (current && candidate.length > target) {
      chunks.push(current.trim());
      current = unit;
    } else current = candidate;
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

const project = loadProject(arg("--project"));
const sourceArg = arg("--source");
if (!sourceArg) throw new Error("Usage: node scripts/importNarrationScript.mjs --project <dir> --source <markdown>");
const source = path.resolve(sourceArg);
if (!fs.existsSync(source)) throw new Error(`Source script not found: ${source}`);
const prose = fs.readFileSync(source, "utf8").trim();
const paragraphs = prose.split(/(?:\r?\n){2,}/).map((value) => value.replace(/\s+/g, " ").trim()).filter(Boolean);
if (paragraphs.length !== 11) {
  throw new Error(`Expected the reviewed source shape of 11 paragraphs, found ${paragraphs.length}; update section mapping before import.`);
}
const sectionByParagraph = [
  "mo-dau",
  "dia-ban-lao-bao", "dia-ban-lao-bao",
  "mo-hinh-tu-quan", "mo-hinh-tu-quan", "mo-hinh-tu-quan",
  "tuyen-truyen-va-ket-qua",
  "suc-manh-doan-the", "suc-manh-doan-the", "suc-manh-doan-the",
  "thanh-qua-va-ket",
];
const sectionTitles = {
  "mo-dau": "AN NINH TỪ NHÂN DÂN",
  "dia-ban-lao-bao": "ĐỊA BÀN LAO BẢO",
  "mo-hinh-tu-quan": "NHỮNG MÔ HÌNH TỪ CƠ SỞ",
  "tuyen-truyen-va-ket-qua": "TUYÊN TRUYỀN ĐI VÀO THỰC CHẤT",
  "suc-manh-doan-the": "SỨC MẠNH CỦA CÁC ĐOÀN THỂ",
  "thanh-qua-va-ket": "NIỀM TIN VÀ HƯỚNG TỚI TƯƠNG LAI",
};
const beats = /** @type {any[]} */ ([]);
let lastSection = "";
for (const [paragraphIndex, paragraph] of paragraphs.entries()) {
  const section = sectionByParagraph[paragraphIndex];
  for (const narration of splitNarration(paragraph)) {
    const id = `b${String(beats.length + 1).padStart(3, "0")}`;
    const firstInSection = section !== lastSection;
    beats.push({
      id,
      section,
      narration,
      ...(firstInSection ? { caption: sectionTitles[section] } : {}),
      visual: firstInSection && beats.length === 0
        ? {
            kind: "title",
            title: "TOÀN DÂN BẢO VỆ AN NINH TỔ QUỐC",
            subtitle: "Hành trình từ lòng dân tại xã Lao Bảo, tỉnh Quảng Trị",
          }
        : {
            kind: "pending",
            description: `Chưa gán tư liệu cho ${id}; cần ảnh hoặc subclip thật có mốc nguồn rõ ràng.`,
          },
    });
    lastSection = section;
  }
}
// The long breath belongs to the beat that CLOSES a section, not the one that
// opens the next: the pause has to sit in the gap the section dissolve lands
// in. 1.2s also outlasts the 1.0s `fade_slow`, so that dissolve finishes
// entirely in silence instead of over the first words of the new section.
for (const [index, beat] of beats.entries()) {
  const next = beats[index + 1];
  if (next && next.section !== beat.section) beat.pauseAfter = 1.2;
}
const script = {
  version: 1,
  reviewStatus: "needs-content-approval",
  reviewNotes: [
    "Kịch bản nguồn còn câu cụt kết thúc bằng “công tác xây dựng”; không được tự suy diễn phần còn thiếu.",
    "Cần xác nhận các cụm nhận dạng bất thường như “hòa ra phong trào”, “nối niềm giữ”, “ra đời và như rộng”, “những con sạch đẹp”.",
    "Cần ký duyệt toàn bộ số liệu, tên đơn vị, mốc năm 2026 và mục tiêu năm 2030 trước khi tổng hợp giọng.",
    "Mỗi beat có visual.kind=pending phải được thay bằng ảnh hoặc subclip thật đã kiểm kê.",
  ],
  project: {
    name: "Toàn dân bảo vệ an ninh Tổ quốc - Lao Bảo 2026",
    issuer: "Xã Lao Bảo, tỉnh Quảng Trị",
    width: 1920,
    height: 1080,
    fps: 30,
    quality: "high",
    output: "output/antt-lao-bao-2026.mp4",
    maxShotDuration: 9,
    closingDuration: 4,
    closingSlogan: "AN NINH TỪ NHÂN DÂN, VÌ NHÂN DÂN, DO NHÂN DÂN LÀM CHỦ",
  },
  voice: {
    provider: "vieneu",
    voice: "Phạm Tuyên",
    style: "tin_tuc",
    speed: 0,
    leadingSilence: 0.8,
    defaultPause: 0.45,
  },
  music: [],
  beats,
};

const scriptDir = path.join(project.dir, "script");
fs.mkdirSync(scriptDir, { recursive: true });
const scriptPath = path.join(scriptDir, "script.json");
// Assigning a visual to every beat is days of human work that lives ONLY in
// this file. A re-import must never quietly eat it.
if (fs.existsSync(scriptPath) && !process.argv.includes("--force")) {
  const existing = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
  const assigned = (existing.beats || []).filter((beat) =>
    [beat.visual, ...(beat.visuals || [])].some((visual) => visual && visual.kind !== "pending")).length;
  throw new Error(
    `${scriptPath} already exists (${existing.beats?.length ?? 0} beats, ${assigned} with visuals assigned). ` +
      "Re-importing rebuilds beats from the markdown and discards every visual assignment, caption and review status. " +
      "Edit script.json directly, or pass --force if you really mean to start over.",
  );
}
fs.writeFileSync(path.join(scriptDir, "script.md"), `${prose}\n`, "utf8");
fs.writeFileSync(scriptPath, `${JSON.stringify(script, null, 2)}\n`, "utf8");
for (const dir of ["photos", "footage/raw", "footage/clips", "voice/cache", "voice/lines"]) {
  fs.mkdirSync(path.join(project.dir, dir), { recursive: true });
  fs.writeFileSync(path.join(project.dir, dir, ".gitkeep"), "", "utf8");
}
const catalogPath = path.join(project.dir, "footage", "footage.json");
if (!fs.existsSync(catalogPath)) fs.writeFileSync(catalogPath, '{\n  "version": 1,\n  "clips": []\n}\n', "utf8");

const manifestPath = path.join(project.dir, "project.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.inputDir = "photos";
manifest.timeline = "timeline/antt-lao-bao.json";
manifest.output = "output/antt-lao-bao-2026.mp4";
manifest.tier = "lite";
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Imported ${beats.length} narration beats. Review gate remains closed until content and visual assignments are approved.`);
