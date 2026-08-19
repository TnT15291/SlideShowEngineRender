import fs from "node:fs";
import path from "node:path";
import { arg, loadProject } from "./lib/project.mjs";
import { ensureInside, parseTimestamp, probeMedia, resolveFfmpeg, run } from "./lib/mediaTools.mjs";

const project = loadProject(arg("--project"));
const inputArg = arg("--in");
const outputArg = arg("--out");
const label = arg("--label", "").trim();
const start = parseTimestamp(arg("--start", "0"));
const duration = Number(arg("--duration"));
if (!inputArg || !outputArg || !label || !Number.isFinite(duration) || duration <= 0) {
  throw new Error(
    "Usage: node scripts/prepareFootage.mjs --project <dir> --in <file> --start <HH:MM:SS> --duration <seconds> --out <file> --label <text>",
  );
}

const input = ensureInside(project.dir, path.resolve(project.dir, inputArg), "--in");
const output = ensureInside(project.dir, path.resolve(project.dir, outputArg), "--out");
if (!fs.existsSync(input)) throw new Error(`Input clip not found: ${input}`);
if (start < 0) throw new Error("--start must be non-negative");

const ffmpeg = resolveFfmpeg();
const source = await probeMedia(input, ffmpeg);
if (start + duration > source.duration + 0.05) {
  throw new Error(`Requested range ends at ${(start + duration).toFixed(3)}s, after source duration ${source.duration.toFixed(3)}s`);
}

fs.mkdirSync(path.dirname(output), { recursive: true });
await run(ffmpeg, [
  "-hide_banner", "-y", "-i", input,
  "-ss", String(start), "-t", String(duration),
  "-filter_complex",
  "[0:v]split=2[base][front];[base]scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,boxblur=20:2[bg];[front]scale=1920:1080:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,fps=30,format=yuv420p[v]",
  "-map", "[v]", "-an", "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-movflags", "+faststart", output,
]);

const normalized = await probeMedia(output, ffmpeg);
const problems = [];
if (normalized.width !== 1920 || normalized.height !== 1080) problems.push(`size=${normalized.width}x${normalized.height}`);
if (normalized.fps == null || Math.abs(normalized.fps - 30) > 0.05) problems.push(`fps=${normalized.fps}`);
if (normalized.pixelFormat !== "yuv420p") problems.push(`pixelFormat=${normalized.pixelFormat || "unknown"}`);
if (normalized.hasAudio) problems.push("audio stream present");
if (Math.abs(normalized.duration - duration) > 0.15) problems.push(`duration=${normalized.duration.toFixed(3)}s`);
if (problems.length) throw new Error(`Normalized clip failed verification: ${problems.join(", ")}`);

const catalogPath = path.join(project.dir, "footage", "footage.json");
fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
let catalog = { version: 1, clips: [] };
if (fs.existsSync(catalogPath)) catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
if (!Array.isArray(catalog.clips)) throw new Error(`Invalid footage catalog: ${catalogPath}`);
const file = path.relative(project.dir, output).replace(/\\/g, "/");
const entry = {
  file,
  duration: normalized.duration,
  src: path.relative(project.dir, input).replace(/\\/g, "/"),
  srcIn: start,
  label,
  orient: source.width && source.height ? (source.width > source.height ? "landscape" : source.width < source.height ? "portrait" : "square") : "unknown",
  width: 1920,
  height: 1080,
  fps: 30,
};
const index = catalog.clips.findIndex((clip) => clip.file === file);
if (index >= 0) catalog.clips[index] = entry;
else catalog.clips.push(entry);
fs.writeFileSync(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
console.log(`Prepared ${file} (${normalized.duration.toFixed(2)}s, ${entry.orient}, silent 1080p30).`);
