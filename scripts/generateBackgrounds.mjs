// Generate procedural champagne-silk backdrops for the white_weddings look.
// No stock footage: a warm ivory base with slow drifting satin folds and soft
// dappled leaf shadows, rendered in Node to an RGB buffer and piped to ffmpeg
// (upscaled + gently blurred so the folds read as silk, never as banding).
//
// Output: assets/backgrounds/<name>.mp4 (1920x1080, loopable, ~10s).
// Usage: node scripts/generateBackgrounds.mjs [--only silk_champagne_leaf]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url), root = process.cwd();
let ffmpeg = process.env.FFMPEG_PATH;
if (!ffmpeg) { try { const p = require("ffmpeg-static"); if (p && fs.existsSync(p)) ffmpeg = p; } catch {} }
if (!ffmpeg) ffmpeg = "ffmpeg";

const W = 480, H = 270, OW = 1920, OH = 1080, FPS = 30, DUR = 10, FRAMES = DUR * FPS;
const onlyAt = process.argv.indexOf("--only"), only = onlyAt >= 0 ? process.argv[onlyAt + 1] : "";

// smooth value-noise (hashed lattice + smoothstep) — aperiodic, no blocky cells.
const smooth = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));
const hash = (x, y, s = 0) => { const n = Math.sin(x * 127.1 + y * 311.7 + s * 74.7) * 43758.5453; return n - Math.floor(n); };
const vnoise = (x, y, s) => {
  const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x, y, s) => 0.6 * vnoise(x / 60, y / 60, s) + 0.28 * vnoise(x / 26, y / 26, s + 7) + 0.12 * vnoise(x / 12, y / 12, s + 13);

// Champagne palette (linear-ish sRGB bytes). Base ivory, warm shadow, bright fold.
const IVORY = [251, 246, 237];   // #FBF6ED — matches white_weddings theme bg
const SHADOW = [232, 219, 190];  // warm champagne shadow in a fold
const HILIGHT = [253, 250, 244]; // near-white satin highlight

// mix a..b by t (0..1), per channel
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// Botanical leaf shadows: a few branches, each carrying pointed leaves, tucked
// into the corners like foliage backlit onto the silk. Individual leaf shapes
// (not blobs) — the heavy post-blur turns the silhouettes into soft shadow.
const BRANCHES = [
  { bx: -10, by: -10, ang: 0.55, len: 260, n: 9 },   // top-left, reaching in
  { bx: W + 10, by: -14, ang: Math.PI - 0.5, len: 240, n: 8 }, // top-right
  { bx: W + 14, by: H + 12, ang: -Math.PI + 0.6, len: 210, n: 7 }, // bottom-right
  { bx: -12, by: H + 10, ang: -0.5, len: 180, n: 6 }, // bottom-left, smaller
];
const LEAVES = [];
for (let b = 0; b < BRANCHES.length; b++) {
  const br = BRANCHES[b];
  for (let k = 0; k < br.n; k++) {
    const s = b * 17 + k;
    const along = (k + 0.6) / br.n;                    // fraction down the branch
    const px = br.bx + Math.cos(br.ang) * br.len * along;
    const py = br.by + Math.sin(br.ang) * br.len * along;
    const side = k % 2 === 0 ? 1 : -1;                 // alternate sides
    LEAVES.push({
      x: px, y: py,
      ang: br.ang + side * (0.7 + hash(s, 1, 61) * 0.5), // leaf splays off the branch
      len: 20 + hash(s, 2, 62) * 16,                    // leaf half-length
      wid: 8 + hash(s, 3, 63) * 5,                       // leaf half-width
      sway: 0.12 + hash(s, 4, 64) * 0.14,                // gentle sway amplitude (rad)
      seed: 70 + s,
      depth: 0.09 + hash(s, 5, 65) * 0.06,               // subtle shading (max ~0.15)
    });
  }
}

function silkLuma(x, y, t) {
  // Diagonal satin folds: two low-freq travelling waves + a broad soft gradient.
  const diag = (x * 0.9 + y * 0.42);
  const f1 = Math.sin(diag * 0.018 + t * 0.55);
  const f2 = Math.sin(diag * 0.043 - t * 0.35 + 1.7);
  const f3 = Math.sin((x * 0.3 - y * 0.8) * 0.02 + t * 0.22);
  let fold = 0.55 * f1 + 0.3 * f2 + 0.15 * f3;      // -1..1
  // soften the fold field with a little noise so ridges aren't perfectly regular
  fold += (fbm(x + t * 6, y, 3) - 0.5) * 0.5;
  // gentle vignette: edges a touch deeper
  const dx = (x - W / 2) / (W / 2), dy = (y - H / 2) / (H / 2);
  const vig = -0.18 * (dx * dx * 0.6 + dy * dy);
  return fold * 0.5 + vig; // roughly -0.7..0.7
}

function leafShade(x, y, t) {
  // Each leaf is a pointed lens (ellipse tapered at both ends). Leaves sway
  // together on a slow breeze. Max over leaves, so overlaps read as fuller shade.
  let shade = 0;
  const breeze = Math.sin((t / DUR) * Math.PI * 2);      // -1..1, seamless over loop
  for (const L of LEAVES) {
    const a = L.ang + breeze * L.sway;
    const dx = x - L.x, dy = y - L.y;
    const u = dx * Math.cos(a) + dy * Math.sin(a);        // along leaf
    const v = -dx * Math.sin(a) + dy * Math.cos(a);       // across leaf
    if (Math.abs(u) >= L.len) continue;
    const halfW = L.wid * (1 - (u / L.len) * (u / L.len)); // pointed ends
    if (halfW <= 0.5 || Math.abs(v) >= halfW) continue;
    const body = smooth(1 - Math.abs(v) / halfW) * smooth(1 - Math.abs(u) / L.len + 0.15);
    shade = Math.max(shade, body * L.depth);
  }
  return shade; // 0..~0.15 warm darkening
}

function renderSilk(name) {
  const raw = Buffer.alloc(W * H * 3 * FRAMES);
  for (let f = 0; f < FRAMES; f++) {
    const t = (f / FRAMES) * DUR;
    // loop-seamless time for the folds: use an angle so end meets start
    const off = f * W * H * 3;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const L = silkLuma(x, y, t);        // -0.7..0.7
        // map fold luma to a champagne ramp: shadow <- ivory -> highlight
        let col;
        if (L >= 0) col = mix(IVORY, HILIGHT, smooth(L / 0.7));
        else col = mix(IVORY, SHADOW, smooth(-L / 0.7));
        // leaf shadow darkens the result, warm (blue drops a touch more so the
        // shade stays champagne, never a cold grey).
        const sh = leafShade(x, y, t);
        const i = off + (y * W + x) * 3;
        raw[i] = Math.max(0, Math.min(255, Math.round(col[0] * (1 - sh * 0.92))));
        raw[i + 1] = Math.max(0, Math.min(255, Math.round(col[1] * (1 - sh * 0.98))));
        raw[i + 2] = Math.max(0, Math.min(255, Math.round(col[2] * (1 - sh * 1.12))));
      }
    }
  }
  const tmp = path.join(os.tmpdir(), `${name}.rgb`), out = path.resolve(root, "assets/backgrounds", `${name}.mp4`);
  fs.writeFileSync(tmp, raw); fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(ffmpeg, ["-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(FPS), "-i", tmp,
    "-vf", `scale=${OW}:${OH}:flags=bicubic,gblur=sigma=6,format=yuv420p`,
    "-t", String(DUR), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
    { encoding: "utf8", maxBuffer: 1 << 28 });
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) throw new Error(`${name}: ${r.stderr}`);
  console.log(`${name}: ${Math.round(fs.statSync(out).size / 1024)} KB, ${DUR}s -> assets/backgrounds/${name}.mp4`);
}

const BACKGROUNDS = { silk_champagne_leaf: renderSilk };
for (const [name, fn] of Object.entries(BACKGROUNDS)) if (!only || only === name) fn(name);
