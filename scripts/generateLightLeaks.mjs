// Generate the bundled light-leak overlay assets (overlays/light_leak_*.mp4).
// Fully procedural — no licensed footage: soft Gaussian light blobs drift on a
// black background, tinted per variant, built with geq at low resolution and
// upscaled through a heavy blur so they read as organic analog leaks. Every
// motion term is sin/cos with period == clip duration, so the loop is seamless
// (the engine plays overlay videos with -stream_loop -1).
//
// Usage: node scripts/generateLightLeaks.mjs [--only warm|soft|sunset]
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

// Low-res generation canvas (geq is per-pixel; the blur+upscale hides it).
const W = 384;
const H = 216;
const OUT_W = 1920;
const OUT_H = 1080;
const FPS = 30;
const DURATION = 10; // seconds; all motion has this exact period

const cyc = (phase) => `(2*PI*T/${DURATION}+${phase})`;

/** A soft elliptical light blob whose center orbits with the loop period. */
function blob({ cx, cy, ax, ay, sx, sy, phase }) {
  const cxE = `(${(cx * W).toFixed(1)}+${(ax * W).toFixed(1)}*sin${cyc(phase)})`;
  const cyE = `(${(cy * H).toFixed(1)}+${(ay * H).toFixed(1)}*cos${cyc(phase)})`;
  const dx2 = (2 * (sx * W) ** 2).toFixed(1);
  const dy2 = (2 * (sy * H) ** 2).toFixed(1);
  return `exp(-(pow(X-${cxE},2)/${dx2}+pow(Y-${cyE},2)/${dy2}))`;
}

/** Slow global intensity "breathing", also loop-periodic. */
function breath(base, amp, phase) {
  return `(${base}+${amp}*sin${cyc(phase)})`;
}

// Each variant: one or two tinted intensity groups (r/g/b weights per group).
// Peak channel value stays <= ~245 so screen/add blends don't clip hard.
const VARIANTS = {
  // Vàng ấm — classic warm golden corner leak, top-right.
  warm: () => {
    const a = blob({ cx: 0.88, cy: 0.1, ax: 0.06, ay: 0.08, sx: 0.28, sy: 0.35, phase: 0 });
    const b = blob({ cx: 1.02, cy: 0.55, ax: 0.05, ay: 0.1, sx: 0.18, sy: 0.3, phase: 2.1 });
    const i = `min((${a}+0.55*${b})*${breath(0.8, 0.2, 4.0)},1)`;
    return { groups: [{ i, tint: [1.0, 0.74, 0.38], gain: 245 }] };
  },
  // Trắng nhẹ — gentle near-white wash bleeding from the top edge.
  soft: () => {
    const bandY = `(${(0.02 * H).toFixed(1)}+${(0.05 * H).toFixed(1)}*sin${cyc(0)})`;
    const band = `exp(-pow(Y-${bandY},2)/${(2 * (0.22 * H) ** 2).toFixed(1)})`;
    const a = blob({ cx: 0.18, cy: 0.08, ax: 0.08, ay: 0.06, sx: 0.3, sy: 0.3, phase: 1.3 });
    const i = `min((0.7*${band}+0.8*${a})*${breath(0.75, 0.25, 2.5)},1)`;
    return { groups: [{ i, tint: [1.0, 0.97, 0.93], gain: 235 }] };
  },
  // Cam hoàng hôn — sunset orange sweep with a magenta echo, left side.
  sunset: () => {
    const orange = blob({ cx: 0.08, cy: 0.45, ax: 0.07, ay: 0.12, sx: 0.3, sy: 0.42, phase: 0.9 });
    const magenta = blob({ cx: 0.25, cy: 0.75, ax: 0.09, ay: 0.08, sx: 0.22, sy: 0.28, phase: 2.8 });
    const br = breath(0.78, 0.22, 5.2);
    return {
      groups: [
        { i: `min(${orange}*${br},1)`, tint: [1.0, 0.45, 0.16], gain: 250 },
        { i: `min(${magenta}*${br},1)`, tint: [0.92, 0.25, 0.42], gain: 250 },
      ],
    };
  },
};

function channelExpr(groups, ch) {
  const terms = groups.map((g) => `${(g.gain * g.tint[ch]).toFixed(1)}*${g.i}`);
  const sum = terms.length === 1 ? terms[0] : `min(${terms.join("+")},255)`;
  return sum;
}

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

fs.mkdirSync(path.resolve(root, "overlays"), { recursive: true });

for (const [name, make] of Object.entries(VARIANTS)) {
  if (only && only !== name) continue;
  const { groups } = make();
  const out = path.resolve(root, "overlays", `light_leak_${name}.mp4`);
  const filter = [
    `color=c=black:s=${W}x${H}:r=${FPS}:d=${DURATION}`,
    "format=gbrp",
    `geq=r='${channelExpr(groups, 0)}':g='${channelExpr(groups, 1)}':b='${channelExpr(groups, 2)}'`,
    "gblur=sigma=8",
    // No grain here: full-frame temporal noise makes x264 output ~80 MB per
    // loop. The gradients band slightly, but screen-blending at 0.4-0.7
    // opacity over photo texture hides it (add film grain via color.grain).
    `scale=${OUT_W}:${OUT_H}:flags=bicubic`,
    "format=yuv420p",
  ].join(",");

  const args = [
    "-y", "-f", "lavfi", "-i", filter,
    "-t", String(DURATION), "-r", String(FPS),
    "-c:v", "libx264", "-preset", "medium", "-crf", "17",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart",
    out,
  ];
  process.stdout.write(`light_leak_${name}: rendering... `);
  const r = spawnSync(ffmpeg, args, { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) {
    console.error(`FAILED\n${(r.stderr || "").split("\n").slice(-12).join("\n")}`);
    process.exit(1);
  }
  const kb = Math.round(fs.statSync(out).size / 1024);
  console.log(`ok (${kb} KB) -> overlays/light_leak_${name}.mp4`);
}
