import fs from "node:fs";
import path from "node:path";
import { arg, loadProject } from "./lib/project.mjs";
import { cuesForSegment } from "./lib/subtitles.mjs";

function timestamp(seconds) {
  const milliseconds = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const secs = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

const project = loadProject(arg("--project"));
const source = path.join(project.dir, "voice", "narration.json");
if (!fs.existsSync(source)) throw new Error(`Narration metadata not found: ${source}`);
const narration = JSON.parse(fs.readFileSync(source, "utf8"));
if (!Array.isArray(narration.segments)) throw new Error("narration.segments must be an array");
const cues = narration.segments.flatMap((segment) => cuesForSegment(segment));
const srt = cues
  .map((cue, index) => [String(index + 1), `${timestamp(cue.start)} --> ${timestamp(cue.end)}`, cue.text, ""].join("\n"))
  .join("\n");
// Sit beside the film it subtitles rather than under a hardcoded project name.
const output = path.join(project.dir, `${project.manifest.output.replace(/\.[^./]+$/, "")}.srt`);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, srt, "utf8");
console.log(`Subtitles ready: ${project.rel(output)} (${cues.length} cues from ${narration.segments.length} beats).`);
