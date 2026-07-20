import fs from "node:fs";
import path from "node:path";
import { retimeSlidesToMusic } from "./lib/musicRetime.mjs";
import { validateMusicAnalysis } from "./lib/musicAnalysis.mjs";

const root = process.cwd();
const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const timelinePath = arg("timeline");
const musicPath = arg("music-analysis");
const outPath = arg("out", timelinePath);
if (!timelinePath || !musicPath) {
  throw new Error("Usage: node scripts/retimeTimelineToMusic.mjs --timeline <json> --music-analysis <json> [--out <json>]");
}

const timeline = JSON.parse(fs.readFileSync(path.resolve(root, timelinePath), "utf8"));
const music = JSON.parse(fs.readFileSync(path.resolve(root, musicPath), "utf8"));
const contract = validateMusicAnalysis(music);
if (!contract.ok) throw new Error(`Music analysis is incomplete: ${contract.missing.join(", ")}`);
const result = retimeSlidesToMusic(timeline.slides, music);
timeline.slides = result.slides;
timeline.musicSync = result.sync;
fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), `${JSON.stringify(timeline, null, 2)}\n`);
console.log(`Retimed ${timeline.slides.length} scenes to ${result.sync.targetDuration}s (${result.sync.snappedBoundaries} snapped boundaries)`);
