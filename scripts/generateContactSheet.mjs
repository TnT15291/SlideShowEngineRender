import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { buildContactSheetReport, contactSheetSampleTime } from "./lib/contactSheetReport.mjs";

const root = process.cwd();
const arg = (flag, def = "") => { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const timelinePath = process.argv[2];
if (!timelinePath) throw new Error("Usage: node scripts/generateContactSheet.mjs <timeline.json> [--analysis-dir analysis] [--out image.jpg] [--json report.json]");
const timeline = JSON.parse(fs.readFileSync(path.resolve(root, timelinePath), "utf8"));
const base = path.basename(timelinePath, path.extname(timelinePath));
const sibling = path.posix.join(path.dirname(path.dirname(timelinePath.replace(/\\/g, "/"))), "analysis");
const analysis = arg("--analysis-dir", sibling).replace(/\\/g, "/").replace(/\/$/, "");
const outJson = arg("--json", `${analysis}/qa/${base}.contact.json`);
const outImage = arg("--out", `${analysis}/qa/${base}.contact.jpg`);
const read = (p) => { try { return JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8")); } catch { return null; } };
const report = buildContactSheetReport({ timeline, proxy: read(`${analysis}/qa/${base}.proxy.json`), clip: read(`${analysis}/qa/${base}.json`),
  diversity: read(`${analysis}/tier1_diversity.json`), color: read(`${analysis}/tier1_color.json`), photos: read(`${analysis}/photos.json`)?.photos || [] });
fs.mkdirSync(path.dirname(path.resolve(root, outJson)), { recursive: true });
fs.writeFileSync(path.resolve(root, outJson), JSON.stringify(report, null, 2) + "\n");
if (process.argv.includes("--json-only")) { console.log(`Contact-sheet QA JSON -> ${outJson}`); process.exit(0); }
const video = path.resolve(root, timeline.output.path);
if (!fs.existsSync(video)) throw new Error(`Rendered video not found: ${timeline.output.path}`);
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = process.env.FFPROBE_PATH || ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_, ext) => `ffprobe${ext || ""}`);
const probe = spawnSync(ffprobe, ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", video], { encoding: "utf8" });
const videoDuration = Number(probe.stdout);
if (probe.status !== 0 || !Number.isFinite(videoDuration) || videoDuration <= 0) {
  throw new Error(`Could not determine rendered video duration: ${(probe.stderr || probe.stdout || "").trim()}`);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-contact-"));
try {
  const cards = [];
  for (const [i, scene] of report.scenes.entries()) {
    const card = path.join(tmp, `${String(i).padStart(3, "0")}.jpg`);
    const color = scene.status === "error" ? "#C62828" : scene.status === "warning" ? "#F9A825" : "#2E7D32";
    const label = `${i + 1}. ${scene.id} | ${scene.editorialBeat || scene.effect} | ${scene.start.toFixed(1)}s ${scene.flags.map((f) => f.flag).join(",")}`.slice(0, 150);
    const labelFile = path.join(tmp, `${i}.txt`); fs.writeFileSync(labelFile, label, "utf8");
    const esc = (p) => p.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
    const font = path.resolve(root, "fonts/BeVietnamPro-Regular.ttf");
    const vf = `scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2:black,pad=480:320:0:0:${color},drawtext=fontfile='${esc(font)}':textfile='${esc(labelFile)}':fontcolor=white:fontsize=16:x=10:y=282`;
    const sampleTime = contactSheetSampleTime(scene.mid, videoDuration);
    const r = spawnSync(ffmpeg, ["-v", "error", "-y", "-ss", String(sampleTime), "-i", video, "-frames:v", "1", "-vf", vf, "-q:v", "3", card], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`frame ${scene.id}: ${r.stderr}`);
    if (!fs.existsSync(card)) throw new Error(`frame ${scene.id}: ffmpeg produced no image at ${sampleTime}s`);
    cards.push(card);
  }
  const cols = Math.min(4, cards.length), rows = Math.ceil(cards.length / cols);
  const layout = cards.map((_, i) => `${(i % cols) * 480}_${Math.floor(i / cols) * 320}`).join("|");
  const args = ["-v", "error", "-y", ...cards.flatMap((p) => ["-i", p]), "-filter_complex", `xstack=inputs=${cards.length}:layout=${layout}:fill=black`, "-frames:v", "1", "-q:v", "2", path.resolve(root, outImage)];
  fs.mkdirSync(path.dirname(path.resolve(root, outImage)), { recursive: true });
  const tile = spawnSync(ffmpeg, args, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (tile.status !== 0) throw new Error(`tile failed: ${tile.stderr}`);
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
console.log(`Contact-sheet QA ${report.verdict}: ${report.scenes.length} scenes -> ${outImage}`);
