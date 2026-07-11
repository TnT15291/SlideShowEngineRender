// Generate the bundled film-damage overlay (overlays/film_damage.mp4) — fully
// procedural like generateLightLeaks.mjs: white dust specks that pop for a
// single frame plus two faint vertical scratches that wander and blink, on a
// black background for screen-blend compositing. All periodic motion uses the
// clip duration as its period so the -stream_loop -1 loop is seamless (the
// per-frame dust is random anyway, so no seam is visible there).
//
// Usage: node scripts/generateFilmDamage.mjs
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

let ffmpeg = process.env.FFMPEG_PATH;
if (!ffmpeg) {
  try {
    const p = require("ffmpeg-static");
    if (p && fs.existsSync(p)) ffmpeg = p;
  } catch {}
}
if (!ffmpeg) ffmpeg = "ffmpeg";

// Low-res canvas; specks/scratches upscale into soft organic marks.
const W = 480;
const H = 270;
const OUT_W = 1920;
const OUT_H = 1080;
const FPS = 30;
const DURATION = 6;

const cyc = (mult, phase) => `(2*PI*T/${DURATION}*${mult}+${phase})`;

// One thin vertical scratch: gaussian line profile around a wandering x,
// gated so it appears only in bursts (like a print running over a splice).
function scratch({ x, wander, gauss, gate, gain, phase }) {
  const xE = `(${(x * W).toFixed(1)}+${(wander * W).toFixed(1)}*sin${cyc(1, phase)})`;
  const line = `exp(-pow(X-${xE},2)/${(2 * gauss ** 2).toFixed(2)})`;
  const gateE = `gt(sin${cyc(gate, phase + 1.7)},${(1 - 0.5).toFixed(2)})`;
  return `${gain}*${line}*${gateE}`;
}

// Dust: per-pixel-per-frame random pops. Threshold keeps it sparse.
const dust = `0.9*lt(random(0),0.00028)`;

const s1 = scratch({ x: 0.22, wander: 0.012, gauss: 0.9, gate: 3, gain: 0.5, phase: 0.6 });
const s2 = scratch({ x: 0.73, wander: 0.02, gauss: 0.7, gate: 4, gain: 0.35, phase: 3.4 });

const intensity = `min((${dust}+${s1}+${s2}),1)*235`;

const filter = [
  `color=c=black:s=${W}x${H}:r=${FPS}:d=${DURATION}`,
  "format=gray",
  `geq=lum='${intensity}'`,
  "gblur=sigma=0.6",
  `scale=${OUT_W}:${OUT_H}:flags=bilinear`,
  "format=yuv420p",
].join(",");

const out = path.resolve(root, "overlays", "film_damage.mp4");
fs.mkdirSync(path.dirname(out), { recursive: true });

const args = [
  "-y", "-f", "lavfi", "-i", filter,
  "-t", String(DURATION), "-r", String(FPS),
  "-c:v", "libx264", "-preset", "medium", "-crf", "18",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  out,
];
process.stdout.write("film_damage: rendering... ");
const r = spawnSync(ffmpeg, args, { encoding: "utf8", maxBuffer: 1 << 26 });
if (r.status !== 0) {
  console.error(`FAILED\n${(r.stderr || "").split("\n").slice(-12).join("\n")}`);
  process.exit(1);
}
console.log(`ok (${Math.round(fs.statSync(out).size / 1024)} KB) -> overlays/film_damage.mp4`);
