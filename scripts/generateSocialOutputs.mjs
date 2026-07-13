import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { arg, loadProject, root } from "./lib/project.mjs";
import { makePreviewCut } from "./lib/previewCut.mjs";
import { retargetTimeline } from "./lib/socialRetarget.mjs";

const projectArg = arg("--project"), project = loadProject(projectArg);
const source = arg("--timeline", project.rel(project.manifest.timeline));
const sourceAbs = path.resolve(root, source);
if (!fs.existsSync(sourceAbs)) throw new Error(`Timeline not found: ${source}`);
const dryRun = process.argv.includes("--dry-run"), duration = Math.max(15, Math.min(30, Number(arg("--duration", "24")) || 24));
const analysis = project.rel(project.manifest.analysisDir), outDir = project.rel("output/deliver/social"), tlDir = project.rel("timeline/social");
fs.mkdirSync(path.resolve(root, outDir), { recursive: true }); fs.mkdirSync(path.resolve(root, tlDir), { recursive: true });
const photos = (() => { try { return JSON.parse(fs.readFileSync(project.abs(`${project.manifest.analysisDir}/photos.json`), "utf8")).photos || []; } catch { return []; } })();
const full = JSON.parse(fs.readFileSync(sourceAbs, "utf8"));
const cut = makePreviewCut(full, { duration, output: `${outDir}/teaser.mp4` });
const variants = [
  { id: "vertical", width: 1080, height: 1920, video: `${outDir}/social-vertical.mp4` },
  { id: "feed", width: 1080, height: 1350, video: `${outDir}/social-feed.mp4` },
];
function run(args, label) { const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error(`${label}: ${r.stderr || r.stdout}`); }
const manifest = [];
for (const v of variants) {
  const tlPath = `${tlDir}/${v.id}.json`, timeline = retargetTimeline(cut, { ...v, output: v.video, photos, label: v.id });
  fs.writeFileSync(path.resolve(root, tlPath), JSON.stringify(timeline, null, 2) + "\n");
  run(["scripts/fitTextInTimeline.mjs", tlPath], `fit ${v.id}`);
  run(["--import", "tsx", "src/index.ts", "--timeline", tlPath, "--job-dir", project.relDir, ...(dryRun ? ["--dry-run"] : [])], `render ${v.id}`);
  if (!dryRun) run(["scripts/generateContactSheet.mjs", tlPath, "--analysis-dir", analysis, "--out", `${outDir}/${v.id}.contact.jpg`, "--json", `${outDir}/${v.id}.contact.json`], `QA ${v.id}`);
  manifest.push({ ...v, timeline: tlPath, contactSheet: dryRun ? null : `${outDir}/${v.id}.contact.jpg` });
}
const teaserTl = `${tlDir}/teaser.json`; fs.writeFileSync(path.resolve(root, teaserTl), JSON.stringify(cut, null, 2) + "\n");
run(["scripts/fitTextInTimeline.mjs", teaserTl], "fit teaser");
run(["--import", "tsx", "src/index.ts", "--timeline", teaserTl, "--job-dir", project.relDir, ...(dryRun ? ["--dry-run"] : [])], "render teaser");
if (!dryRun) {
  const vertical = path.resolve(root, variants[0].video), poster = path.resolve(root, `${outDir}/poster.jpg`);
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg", r = spawnSync(ffmpeg, ["-v", "error", "-y", "-ss", String(duration * 0.65), "-i", vertical, "-frames:v", "1", "-q:v", "2", poster], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`poster: ${r.stderr}`);
}
fs.writeFileSync(path.resolve(root, `${outDir}/social-manifest.json`), JSON.stringify({ version: 1, source, duration, dryRun, variants: manifest,
  teaser: { timeline: teaserTl, video: dryRun ? null : `${outDir}/teaser.mp4` }, poster: dryRun ? null : `${outDir}/poster.jpg` }, null, 2) + "\n");
console.log(`Social outputs: ${dryRun ? "validated" : "rendered"} -> ${outDir}`);
