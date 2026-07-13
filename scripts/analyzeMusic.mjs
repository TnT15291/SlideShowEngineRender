// Music analysis (dependency-free): decode to mono PCM via ffmpeg, build an RMS
// energy envelope, classify calm/normal/build sections, and estimate a coarse
// BPM by autocorrelating the onset envelope. Feeds the Director's pacing.
//
// Usage: node scripts/analyzeMusic.mjs "music/a thousand years.mp3" [--out analysis/music/<name>.json]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { MUSIC_ANALYSIS_VERSION } from "./lib/musicAnalysis.mjs";

const root = process.cwd();
const inPath = process.argv[2];
if (!inPath) throw new Error('Usage: node scripts/analyzeMusic.mjs "music/track.mp3"');
const outArgIdx = process.argv.indexOf("--out");
const base = path.basename(inPath).replace(/\.[^.]+$/, "");
const outPath = outArgIdx >= 0 ? process.argv[outArgIdx + 1] : `analysis/music/${base}.json`;

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const SR = 2000;        // mono sample rate for the envelope
const HOP = 0.1;        // seconds per analysis window
const winSamples = Math.round(SR * HOP);

// decode to raw mono s16le
const res = spawnSync(ffmpeg, ["-v", "error", "-i", path.resolve(root, inPath),
  "-ac", "1", "-ar", String(SR), "-f", "s16le", "-"], { maxBuffer: 1 << 30 });
if (res.status !== 0) throw new Error("ffmpeg decode failed: " + res.stderr);
const buf = res.stdout;
const pcm = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 2));
const nWin = Math.floor(pcm.length / winSamples);
const duration = pcm.length / SR;

// RMS envelope per window (0..1)
const rms = new Array(nWin);
for (let i = 0; i < nWin; i++) {
  let s = 0;
  for (let j = 0; j < winSamples; j++) { const v = pcm[i * winSamples + j] / 32768; s += v * v; }
  rms[i] = Math.sqrt(s / winSamples);
}
const maxRms = Math.max(...rms, 1e-9);
const env = rms.map((v) => v / maxRms);

// smooth (moving average ~0.5s) for section detection
const smoothN = Math.round(0.5 / HOP);
const smooth = env.map((_, i) => {
  let s = 0, c = 0;
  for (let k = -smoothN; k <= smoothN; k++) { const j = i + k; if (j >= 0 && j < env.length) { s += env[j]; c++; } }
  return s / c;
});

// classify each window: calm / normal / build
const CALM = 0.42, BUILD = 0.68;
const label = smooth.map((v) => (v < CALM ? "calm" : v > BUILD ? "build" : "normal"));

// merge into contiguous sections (min 2s)
const sections = [];
let start = 0;
for (let i = 1; i <= label.length; i++) {
  if (i === label.length || label[i] !== label[start]) {
    const t0 = start * HOP, t1 = i * HOP;
    if (t1 - t0 >= 2 || sections.length === 0) {
      sections.push({ kind: label[start], start: +t0.toFixed(2), end: +t1.toFixed(2), dur: +(t1 - t0).toFixed(2) });
    } else if (sections.length) {
      sections[sections.length - 1].end = +t1.toFixed(2);
      sections[sections.length - 1].dur = +(sections[sections.length - 1].end - sections[sections.length - 1].start).toFixed(2);
    }
    start = i;
  }
}

// coarse BPM: onset envelope (positive energy diff) autocorrelation over 60..180 BPM
const onset = env.map((v, i) => (i ? Math.max(0, v - env[i - 1]) : 0));
let bestBpm = 0, bestScore = -1;
for (let bpm = 60; bpm <= 180; bpm += 1) {
  const lag = Math.round((60 / bpm) / HOP);
  if (lag < 2) continue;
  let acc = 0;
  for (let i = lag; i < onset.length; i++) acc += onset[i] * onset[i - lag];
  if (acc > bestScore) { bestScore = acc; bestBpm = bpm; }
}

// Pick the strongest onset as a beat-grid phase, then expose auditable beat,
// downbeat (4 beats) and phrase (16 beats) boundaries for deterministic edits.
const beatSeconds = 60 / (bestBpm || 120);
const phaseBins = Math.max(1, Math.round(beatSeconds / HOP));
let phase = 0, phaseScore = -1;
for (let p = 0; p < phaseBins; p++) {
  let score = 0;
  for (let i = p; i < onset.length; i += phaseBins) score += onset[i];
  if (score > phaseScore) { phaseScore = score; phase = p * HOP; }
}
const grid = (every, kind) => {
  const rows = [];
  for (let index = 0, time = phase; time < duration; index++, time = phase + index * beatSeconds * every) {
    rows.push({ index, time: +time.toFixed(3), kind });
  }
  return rows;
};
const beats = grid(1, "beat");
const downbeats = grid(4, "downbeat");
const phrases = grid(16, "phrase");

const out = {
  analysisVersion: MUSIC_ANALYSIS_VERSION,
  file: inPath,
  duration: +duration.toFixed(2),
  hop: HOP,
  bpmEstimate: bestBpm,
  beatGrid: { source: "onset_phase", confidence: +Math.min(1, phaseScore / Math.max(0.001, onset.reduce((a, b) => a + b, 0))).toFixed(3), beatSeconds: +beatSeconds.toFixed(4), phase: +phase.toFixed(3) },
  beats, downbeats, phrases,
  energy: { mean: +(env.reduce((a, b) => a + b, 0) / env.length).toFixed(3), windows: env.length },
  sections,
  // convenience picks for the Director
  buildWindows: sections.filter((s) => s.kind === "build").map((s) => ({ start: s.start, end: s.end })),
  calmWindows: sections.filter((s) => s.kind === "calm").map((s) => ({ start: s.start, end: s.end })),
  envelope: env.map((v, i) => +v.toFixed(3)).filter((_, i) => i % 5 === 0), // ~2 pts/sec, for inspection
};

fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(out, null, 2));
console.log(`Wrote ${outPath}: ${out.duration}s, ~${out.bpmEstimate} BPM, ${sections.length} sections ` +
  `(${out.buildWindows.length} build / ${out.calmWindows.length} calm).`);
