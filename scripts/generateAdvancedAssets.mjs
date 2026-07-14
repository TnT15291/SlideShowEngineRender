// Generate advanced reveal masks and screen-blend overlays without external assets.
// Masks are grayscale (white reveals the photo) and always finish fully white.
// Overlays are RGB clips on black, designed for screen/add blending.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url), root = process.cwd();
let ffmpeg = process.env.FFMPEG_PATH;
if (!ffmpeg) { try { const p = require("ffmpeg-static"); if (p && fs.existsSync(p)) ffmpeg = p; } catch {} }
if (!ffmpeg) ffmpeg = "ffmpeg";
const W = 320, H = 180, OW = 1920, OH = 1080, FPS = 30, D = 4.5, FRAMES = Math.round(D * FPS);
const onlyAt = process.argv.indexOf("--only"), only = onlyAt >= 0 ? process.argv[onlyAt + 1] : "";
const smooth = (v) => v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v);
const hash = (x, y, seed = 0) => { const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return n - Math.floor(n); };
// Smoothstep-interpolated lattice noise: continuous, no blocky cells even after 6x upscale.
const vnoise = (x, y, seed) => {
  const xi = Math.floor(x), yi = Math.floor(y), u = smooth(x - xi), v = smooth(y - yi);
  const a = hash(xi, yi, seed), b = hash(xi + 1, yi, seed), c = hash(xi, yi + 1, seed), d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
};
const fbm = (x, y, seed) => 0.62 * vnoise(x / 24, y / 24, seed) + 0.26 * vnoise(x / 10, y / 10, seed + 7) + 0.12 * vnoise(x / 4.3, y / 4.3, seed + 13);

const seeds = Array.from({ length: 34 }, (_, i) => ({
  x: hash(i, 2, 1) * W, y: hash(i, 3, 2) * H, birth: hash(i, 5, 3) * 0.7,
  r: 10 + hash(i, 7, 4) * 34,
}));

// Watercolor spreads from a few staggered pools that merge, like paint dropped on wet paper.
const POOLS = [[W * 0.36, H * 0.42, 0], [W * 0.68, H * 0.6, 0.12], [W * 0.5, H * 0.26, 0.24]];

// Gold dust: soft twinkling particles that drift in along a diagonal sweep front.
const dust = Array.from({ length: 1500 }, (_, i) => ({
  x: hash(i, 1, 51) * (W + 40) - 20, y: hash(i, 2, 52) * H,
  r: 0.9 + hash(i, 3, 53) * 2.1,
  tw: 3 + hash(i, 4, 54) * 7, ph: hash(i, 5, 55) * 6.283,
  dx: 5 + hash(i, 6, 56) * 12, dy: (hash(i, 7, 57) - 0.5) * 9,
}));
// Static organic wobble for the gold-dust wash edge, so the front never reads as a ruler line.
const wob = new Float32Array(W * H);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) wob[y * W + x] = (fbm(x, y, 71) - 0.5) * 18;

const MASKS = {
  ink_reveal(x, y, p) {
    let v = 0; for (const s of seeds) if (p > s.birth) v = Math.max(v, 1 - Math.hypot(x - s.x, y - s.y) / (s.r * smooth((p - s.birth) / 0.24)));
    return v;
  },
  watercolor_reveal(x, y, p) {
    let v = 0;
    for (let i = 0; i < POOLS.length; i++) {
      const [cx, cy, birth] = POOLS[i];
      if (p <= birth) continue;
      const g = smooth((p - birth) / (1 - birth));
      const n = (fbm(x, y, 11 + i * 17) - 0.5) * 44;
      v = Math.max(v, smooth((g * W * 0.7 - Math.hypot(x - cx, y - cy) + n) / 22));
    }
    return v;
  },
  torn_paper_reveal(x, y, p) {
    const edge = p * (W + 50) - 25 + 15 * Math.sin(y * 0.12) + 7 * Math.sin(y * 0.37);
    return smooth((edge - x) / 7);
  },
  petal_reveal(x, y, p) {
    const dx = x - W / 2, dy = y - H / 2, a = Math.atan2(dy, dx), r = Math.hypot(dx, dy);
    const petals = 0.45 + 0.55 * Math.abs(Math.cos(a * 4));
    return smooth((p * W * 0.68 * petals - r) / 13);
  },
  // Frame-splat mask: sparkle band leads a soft wash along a diagonal sweep.
  gold_dust_reveal: {
    render(F, p, t) {
      const front = p * (W + 140) - 50;
      for (let y = 0; y < H; y++) {
        const row = y * W, skew = (y - H / 2) * 0.22;
        for (let x = 0; x < W; x++) F[row + x] = smooth((front - 26 - (x + skew) + wob[row + x]) / 34);
      }
      for (const d of dust) {
        const px = d.x + d.dx * p, py = d.y + d.dy * p;
        const lead = front - (px + (py - H / 2) * 0.22);
        if (lead < -14) continue;
        const a = smooth((lead + 14) / 18) * (1 - smooth((lead - 40) / 60)) * (0.55 + 0.45 * Math.sin(t * d.tw + d.ph));
        if (a <= 0.03) continue;
        const R = d.r * 2, x0 = Math.max(0, Math.ceil(px - R)), x1 = Math.min(W - 1, Math.floor(px + R));
        const y0 = Math.max(0, Math.ceil(py - R)), y1 = Math.min(H - 1, Math.floor(py + R));
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
          const q = ((xx - px) ** 2 + (yy - py) ** 2) / (d.r * d.r);
          if (q >= 4) continue;
          const i2 = yy * W + xx, g = a * Math.exp(-q * 1.6);
          if (g > F[i2]) F[i2] = g;
        }
      }
    },
  },
  stained_glass_reveal(x, y, p) {
    const cellX = Math.floor(x / 32), cellY = Math.floor(y / 30), order = hash(cellX, cellY, 41);
    const border = Math.min(x % 32, 31 - (x % 32), y % 30, 29 - (y % 30));
    return order < p * 1.15 ? smooth(border / 3) : 0;
  },
  geometric_teal_wipe(x, y, p) {
    const band = x + y * 0.72 + 24 * Math.sin(y / 27);
    return smooth((p * (W + H * 0.72 + 60) - band) / 9);
  },
};

function renderMask(name, fn) {
  const raw = Buffer.alloc(W * H * FRAMES), F = new Float32Array(W * H);
  for (let f = 0; f < FRAMES; f++) {
    const p = f / (FRAMES - 1), final = smooth((p - 0.88) / 0.1), off = f * W * H;
    if (typeof fn === "function") {
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) raw[off + y * W + x] = Math.round(255 * Math.max(final, Math.min(1, fn(x, y, p))));
    } else {
      F.fill(0); fn.render(F, p, p * D);
      for (let i = 0; i < W * H; i++) raw[off + i] = Math.round(255 * Math.max(final, Math.min(1, F[i])));
    }
  }
  const tmp = path.join(os.tmpdir(), `${name}.gray`), out = path.resolve(root, "assets/masks", `${name}.mp4`);
  fs.writeFileSync(tmp, raw); fs.mkdirSync(path.dirname(out), { recursive: true });
  const r = spawnSync(ffmpeg, ["-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${W}x${H}`, "-r", String(FPS), "-i", tmp,
    "-vf", `gblur=sigma=0.45,scale=${OW}:${OH}:flags=bicubic,format=yuv420p`, "-t", String(D), "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", out], { encoding: "utf8", maxBuffer: 1 << 26 });
  fs.rmSync(tmp, { force: true }); if (r.status !== 0) throw new Error(`${name}: ${r.stderr}`);
  console.log(`${name}: ${Math.round(fs.statSync(out).size / 1024)} KB`);
}

const OVERLAYS = {
  light_sweep: "r='245*exp(-pow(X-W*(0.05+0.9*T/6),2)/(2*pow(W*.07,2)))':g='225*exp(-pow(X-W*(0.05+0.9*T/6),2)/(2*pow(W*.07,2)))':b='190*exp(-pow(X-W*(0.05+0.9*T/6),2)/(2*pow(W*.07,2)))'",
  vintage_projector: "r='55*(.45+.15*sin(T*8))+180*lt(random(1),.0005)':g='43*(.45+.15*sin(T*8))+160*lt(random(1),.0005)':b='25*(.45+.15*sin(T*8))+110*lt(random(1),.0005)'",
  film_burn: "r='250*exp(-(pow(X-W*(.1+.8*T/6),2)/pow(W*.22,2)+pow(Y-H*.5,2)/pow(H*.7,2)))':g='95*exp(-(pow(X-W*(.1+.8*T/6),2)/pow(W*.18,2)+pow(Y-H*.5,2)/pow(H*.6,2)))':b='25*exp(-(pow(X-W*(.1+.8*T/6),2)/pow(W*.12,2)+pow(Y-H*.5,2)/pow(H*.5,2)))'",
  floral_frame_animation: "r='80*max(exp(-pow(X-W*.04,2)/pow(W*.025,2)),exp(-pow(X-W*.96,2)/pow(W*.025,2)))*(0.7+.3*sin(T*1.4))':g='145*max(exp(-pow(X-W*.04,2)/pow(W*.025,2)),exp(-pow(X-W*.96,2)/pow(W*.025,2)))*(0.7+.3*sin(T*1.4))':b='70*max(exp(-pow(X-W*.04,2)/pow(W*.025,2)),exp(-pow(X-W*.96,2)/pow(W*.025,2)))*(0.7+.3*sin(T*1.4))'",
};

function renderOverlay(name, expr) {
  const out = path.resolve(root, "overlays", `${name}.mp4`); fs.mkdirSync(path.dirname(out), { recursive: true });
  const filter = `color=black:s=384x216:r=30:d=6,format=gbrp,geq=${expr},gblur=sigma=3,scale=${OW}:${OH}:flags=bicubic,format=yuv420p`;
  const r = spawnSync(ffmpeg, ["-y", "-f", "lavfi", "-i", filter, "-t", "6", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p", out], { encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error(`${name}: ${r.stderr}`); console.log(`${name}: ${Math.round(fs.statSync(out).size / 1024)} KB`);
}

for (const [name, fn] of Object.entries(MASKS)) if (!only || only === name) renderMask(name, fn);
for (const [name, expr] of Object.entries(OVERLAYS)) if (!only || only === name) renderOverlay(name, expr);
