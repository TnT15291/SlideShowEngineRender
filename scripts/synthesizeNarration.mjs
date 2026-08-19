import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { arg, loadProject } from "./lib/project.mjs";
import { resolveFfmpeg, run, silentWav, wavDuration } from "./lib/mediaTools.mjs";
import { createTtsProvider } from "./lib/tts/index.mjs";

export function narrationCacheKey({ text, provider, voice, speed, style }) {
  return createHash("sha256")
    .update(JSON.stringify({ text, provider, voice, speed, style }))
    .digest("hex");
}

function concatPath(file) {
  return path.resolve(file).replace(/\\/g, "/").replace(/'/g, "'\\''");
}

const LOUDNESS = "I=-18:TP=-1.5:LRA=11";

async function measureLoudness(ffmpeg, input) {
  const { stderr } = await run(
    ffmpeg,
    ["-hide_banner", "-nostats", "-i", input, "-af", `loudnorm=${LOUDNESS}:print_format=json`, "-f", "null", "-"],
    { capture: true },
  );
  const open = stderr.lastIndexOf("{");
  const close = stderr.lastIndexOf("}");
  if (open < 0 || close < open) throw new Error(`Could not read loudnorm measurement:\n${stderr.trim()}`);
  const measured = JSON.parse(stderr.slice(open, close + 1));
  if (!Number.isFinite(Number(measured.input_i))) {
    throw new Error(`TTS returned silence (input_i=${measured.input_i}) for ${path.basename(input)}`);
  }
  return measured;
}

/**
 * Two-pass loudnorm so every line lands on the same loudness by a STATIC gain.
 * Single-pass loudnorm is a dynamic normalizer: on three-second sentences it
 * measures unreliably and compresses each line differently, which is exactly
 * the "voice changes between chunks" the Phase 2 acceptance test listens for.
 */
async function normalizeLine(ffmpeg, input, output) {
  const measured = await measureLoudness(ffmpeg, input);
  const filter = [
    `loudnorm=${LOUDNESS}`,
    `measured_I=${measured.input_i}`,
    `measured_TP=${measured.input_tp}`,
    `measured_LRA=${measured.input_lra}`,
    `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`,
    "linear=true",
  ].join(":");
  await run(ffmpeg, [
    "-hide_banner", "-loglevel", "error", "-y", "-i", input,
    "-vn", "-af", filter,
    "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", output,
  ]);
}

const project = loadProject(arg("--project"));
const scriptPath = path.join(project.dir, "script", "script.json");
if (!fs.existsSync(scriptPath)) throw new Error(`Script not found: ${scriptPath}`);
const script = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
if (script.reviewStatus !== "approved" && !process.argv.includes("--allow-unapproved")) {
  throw new Error(
    `Content review gate is "${script.reviewStatus || "missing"}". Set reviewStatus="approved" after factual/editorial sign-off, or use --allow-unapproved only for a disposable voice test.`,
  );
}
if (!Array.isArray(script.beats) || script.beats.length === 0) throw new Error("script.beats must be a non-empty array");
const ids = new Set();
for (const beat of script.beats) {
  if (!beat.id || ids.has(beat.id)) throw new Error(`Beat id is missing or duplicated: ${beat.id}`);
  ids.add(beat.id);
  if (typeof beat.narration !== "string" || beat.narration.trim().length < 3) {
    throw new Error(`Beat ${beat.id} needs at least 3 characters of narration`);
  }
}

const voice = script.voice || {};
const providerName = arg("--provider", voice.provider || "vieneu");
const voiceName = arg("--voice", voice.voice || "Phạm Tuyên");
const speed = Number(arg("--speed", voice.speed ?? 0));
const style = arg("--style", voice.style || "tin_tuc");
const leadingSilence = Number(voice.leadingSilence ?? 0.8);
const defaultPause = Number(voice.defaultPause ?? 0.45);
if (![speed, leadingSilence, defaultPause].every(Number.isFinite) || leadingSilence < 0 || defaultPause < 0) {
  throw new Error("voice speed/silence/pause values must be finite and pauses must be non-negative");
}

const voiceDir = path.join(project.dir, "voice");
const cacheDir = path.join(voiceDir, "cache");
const linesDir = path.join(voiceDir, "lines");
const workDir = path.join(project.dir, "temp", "narration");
for (const dir of [cacheDir, linesDir, workDir]) fs.mkdirSync(dir, { recursive: true });
const ffmpeg = resolveFfmpeg();
const stitchOnly = process.argv.includes("--stitch-only");
const provider = stitchOnly ? null : await createTtsProvider(providerName);
const segments = [];
const concatFiles = [];
const silenceFiles = new Map();

function silenceFile(duration) {
  const milliseconds = Math.round(duration * 1000);
  if (!silenceFiles.has(milliseconds)) {
    const file = path.join(workDir, `silence-${milliseconds}ms.wav`);
    fs.writeFileSync(file, silentWav(milliseconds / 1000));
    silenceFiles.set(milliseconds, file);
  }
  return silenceFiles.get(milliseconds);
}

if (leadingSilence > 0) concatFiles.push(silenceFile(leadingSilence));
let cursor = leadingSilence;
try {
  for (const [index, beat] of script.beats.entries()) {
    const linePath = path.join(linesDir, `${beat.id}.wav`);
    if (stitchOnly) {
      if (!fs.existsSync(linePath)) throw new Error(`--stitch-only requires ${linePath}`);
    } else {
      const key = narrationCacheKey({ text: beat.narration, provider: providerName, voice: voiceName, speed, style });
      const cached = path.join(cacheDir, `${key}.wav`);
      if (!fs.existsSync(cached)) {
        console.log(`[${index + 1}/${script.beats.length}] Synthesizing ${beat.id}…`);
        const raw = await provider.synthesize({
          text: beat.narration,
          voice: voiceName,
          speed,
          style,
          format: "wav",
        });
        const rawPath = path.join(workDir, `${key}.input`);
        // Normalize to a scratch file and rename into place: a killed ffmpeg
        // must not leave a truncated WAV that every later run treats as a hit.
        const pendingPath = path.join(workDir, `${key}.pending.wav`);
        try {
          fs.writeFileSync(rawPath, raw);
          await normalizeLine(ffmpeg, rawPath, pendingPath);
          fs.renameSync(pendingPath, cached);
        } finally {
          fs.rmSync(rawPath, { force: true });
          fs.rmSync(pendingPath, { force: true });
        }
      } else {
        console.log(`[${index + 1}/${script.beats.length}] Cache hit ${beat.id}`);
      }
      fs.copyFileSync(cached, linePath);
    }

    const duration = wavDuration(fs.readFileSync(linePath));
    const pauseAfter = Number(beat.pauseAfter ?? defaultPause);
    if (!Number.isFinite(pauseAfter) || pauseAfter < 0) throw new Error(`Invalid pauseAfter for ${beat.id}`);
    segments.push({ id: beat.id, start: cursor, end: cursor + duration, duration, text: beat.narration });
    concatFiles.push(linePath);
    cursor += duration;
    if (pauseAfter > 0) {
      concatFiles.push(silenceFile(pauseAfter));
      cursor += pauseAfter;
    }
  }
} finally {
  await provider?.close?.();
}

const concatList = path.join(workDir, "concat.txt");
fs.writeFileSync(concatList, concatFiles.map((file) => `file '${concatPath(file)}'`).join("\n") + "\n", "utf8");
const narrationPath = path.join(voiceDir, "narration.wav");
await run(ffmpeg, [
  "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", concatList,
  "-ar", "48000", "-ac", "1", "-c:a", "pcm_s16le", narrationPath,
]);
const totalDuration = wavDuration(fs.readFileSync(narrationPath));
if (Math.abs(totalDuration - cursor) > 0.1) {
  throw new Error(`Narration timing mismatch: metadata=${cursor.toFixed(3)}s WAV=${totalDuration.toFixed(3)}s`);
}
const metadata = {
  provider: providerName,
  voice: voiceName,
  speed,
  style,
  leadingSilence,
  totalDuration,
  segments,
};
fs.writeFileSync(path.join(voiceDir, "narration.json"), `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(`Narration ready: ${project.rel("voice/narration.wav")} (${totalDuration.toFixed(2)}s, ${segments.length} segments).`);
