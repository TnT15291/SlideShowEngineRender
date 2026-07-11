// Generate reveal-mask videos for the engine's `mask_reveal` effect
// (assets/masks/*.mp4). A mask is a grayscale clip: white = photo visible,
// black = hidden. Unlike the overlay generators these do NOT loop — a mask
// plays once and the engine holds its final (fully white) frame via tpad.
//
// particle_gather — "hạt sáng tích tụ dần": glowing dots pop in around the
// centre and spread outward, each one staying lit and slowly growing; a global
// fill ramp then guarantees a complete reveal. Rendered in Node onto a
// persistent low-res accumulation buffer (procedural, no AE / no assets),
// piped to ffmpeg as raw gray frames.
//
// Usage: node scripts/generateMasks.mjs [--only particle_gather]
import fs from "node:fs";
import os from "node:os";
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

const W = 480;
const H = 270;
const OUT_W = 1920;
const OUT_H = 1080;
const FPS = 30;

// Deterministic PRNG so regenerating the asset is reproducible.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function generateParticleGather() {
  const DURATION = 4.5;
  const frames = Math.round(DURATION * FPS);
  const rand = mulberry32(20260711);
  const accum = new Float32Array(W * H); // persistent: particles stay lit
  const out = Buffer.alloc(W * H * frames);

  // Pre-plan particles: birth frame ramps up (few early, dense later),
  // position spreads centre -> edges as the reveal progresses.
  const PARTICLES = 1900;
  const parts = [];
  for (let i = 0; i < PARTICLES; i++) {
    const birthT = Math.pow(rand(), 0.6) * 0.82; // fraction of timeline, ease-in density
    const spread = 0.15 + 0.95 * birthT; // how far from centre this dot may land
    const ang = rand() * Math.PI * 2;
    const dist = Math.pow(rand(), 0.7) * spread;
    parts.push({
      birth: Math.floor(birthT * frames),
      x: W / 2 + Math.cos(ang) * dist * (W / 2) * 1.15,
      y: H / 2 + Math.sin(ang) * dist * (H / 2) * 1.15,
      r: 0.55 + rand() * 2.2, // fine grains; upscales to roughly 2..11 output px
      grow: 5 + Math.floor(rand() * 10),
    });
  }

  // Soft gaussian stamp, additive into the persistent buffer.
  function stamp(x, y, r, gain) {
    const x0 = Math.max(0, Math.floor(x - r * 2));
    const x1 = Math.min(W - 1, Math.ceil(x + r * 2));
    const y0 = Math.max(0, Math.floor(y - r * 2));
    const y1 = Math.min(H - 1, Math.ceil(y + r * 2));
    const d2 = 2 * r * r;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const g = gain * Math.exp(-((px - x) ** 2 + (py - y) ** 2) / d2);
        const idx = py * W + px;
        accum[idx] = Math.min(1, accum[idx] + g);
      }
    }
  }

  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);

    // Grow every particle already born (incremental additive growth reads as
    // the dot swelling + brightening in place).
    for (const p of parts) {
      if (f < p.birth) continue;
      const age = f - p.birth;
      if (age <= p.grow) {
        const k = (age + 1) / (p.grow + 1);
        stamp(p.x, p.y, Math.max(0.38, p.r * k), 0.2);
      }
    }

    // Global fill ramp from 72% -> 96% of the timeline guarantees the photo
    // is fully revealed no matter how the dots landed.
    const fill = t < 0.72 ? 0 : Math.min(1, (t - 0.72) / 0.24);
    const fillV = fill * fill * (3 - 2 * fill);

    const frame = out.subarray(f * W * H, (f + 1) * W * H);
    for (let i = 0; i < W * H; i++) {
      const v = Math.max(accum[i], fillV);
      frame[i] = Math.round(v * 255);
    }

    // Transient sparkle pops on freshly-born dots (bright pixel bursts that
    // do NOT persist — drawn straight into the frame, not the accumulator).
    for (const p of parts) {
      const age = f - p.birth;
      if (age < 0 || age > 2) continue;
      const cx = Math.round(p.x);
      const cy = Math.round(p.y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = cx + dx;
          const py = cy + dy;
          if (px < 0 || px >= W || py < 0 || py >= H) continue;
          if (Math.abs(dx) + Math.abs(dy) > 1) continue; // plus-shape
          frame[py * W + px] = 255;
        }
      }
    }
  }

  return { name: "particle_gather", raw: out, frames, duration: DURATION };
}

function generateHeartWand() {
  // "Đũa phép quơ hình trái tim": a wand draws the classic heart curve as a
  // glowing stroke (sparkle head, transient trail), the interior then blooms
  // full from the centre — clipped to the exact drawn shape so the notch
  // between the lobes stays black — and finally the reveal expands past the
  // heart to fill the frame. A late global ramp guarantees full white.
  const DURATION = 5.0;
  const frames = Math.round(DURATION * FPS);
  const rand = mulberry32(20260711);
  const accum = new Float32Array(W * H); // persistent: stroke + fills only grow
  const out = Buffer.alloc(W * H * frames);

  // Classic parametric heart, normalised to |x| <= ~0.94. Screen y flips.
  const U = 84; // smaller heart leaves room for the visible wand flourish
  const N = 1440;
  const pts = [];
  let yMin = Infinity;
  let yMax = -Infinity;
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const x = Math.pow(Math.sin(t), 3) * (16 / 17);
    const y =
      (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 17;
    yMin = Math.min(yMin, y);
    yMax = Math.max(yMax, y);
    pts.push({ x, y });
  }
  const cx = W / 2;
  const cy = H / 2 + (U * (yMin + yMax)) / 2; // centre the vertical extent
  const poly = pts.map((p) => ({ x: cx + p.x * U, y: cy - p.y * U }));

  // Exact interior via even-odd scanline fill — radial scaling of the curve
  // would paint the notch between the lobes (scaled-down lobes sweep through
  // it), so the bloom is a radial wipe CLIPPED to this precomputed region.
  const inside = new Uint8Array(W * H);
  for (let py = 0; py < H; py++) {
    const yMid = py + 0.5;
    const xs = [];
    for (let i = 0; i < poly.length - 1; i++) {
      const a = poly[i];
      const b = poly[i + 1];
      if (a.y <= yMid === b.y <= yMid) continue;
      xs.push(a.x + ((yMid - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const x0 = Math.max(0, Math.ceil(xs[k] - 0.5));
      const x1 = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      for (let px = x0; px <= x1; px++) inside[py * W + px] = 1;
    }
  }

  // Distance from frame centre, for the bloom + expand wipes.
  const dist = new Float32Array(W * H);
  for (let py = 0; py < H; py++)
    for (let px = 0; px < W; px++)
      dist[py * W + px] = Math.hypot(px - cx, py - (H / 2));

  const smooth = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));

  // Soft gaussian stamp into the persistent buffer (same as particle_gather).
  function stamp(x, y, r, gain) {
    const x0 = Math.max(0, Math.floor(x - r * 2));
    const x1 = Math.min(W - 1, Math.ceil(x + r * 2));
    const y0 = Math.max(0, Math.floor(y - r * 2));
    const y1 = Math.min(H - 1, Math.ceil(y + r * 2));
    const d2 = 2 * r * r;
    for (let py = y0; py <= y1; py++) {
      for (let px = x0; px <= x1; px++) {
        const g = gain * Math.exp(-((px - x) ** 2 + (py - y) ** 2) / d2);
        const idx = py * W + px;
        accum[idx] = Math.min(1, accum[idx] + g);
      }
    }
  }

  const headAt = (p) => {
    // p in [0,1] along the stroke, starting/ending at the top dip (t=0).
    const i = Math.min(N, Math.floor(p * N));
    return poly[i];
  };

  function drawTransientWand(frame, p) {
    const h = headAt(p);
    const before = headAt(Math.max(0, p - 0.006));
    const angle = Math.atan2(h.y - before.y, h.x - before.x);
    // Small wand trails behind the drawing tip, angled along the curve tangent.
    const length = 19;
    const offset = 5;
    const nx = -Math.sin(angle) * offset;
    const ny = Math.cos(angle) * offset;
    const x0 = h.x - Math.cos(angle) * length + nx;
    const y0 = h.y - Math.sin(angle) * length + ny;
    for (let s = 0; s <= length; s++) {
      const x = Math.round(x0 + Math.cos(angle) * s);
      const y = Math.round(y0 + Math.sin(angle) * s);
      if (x < 0 || x >= W || y < 0 || y >= H) continue;
      const v = s > length - 4 ? 255 : 185;
      frame[y * W + x] = Math.max(frame[y * W + x], v);
      if (s < length - 4 && y + 1 < H) frame[(y + 1) * W + x] = Math.max(frame[(y + 1) * W + x], 110);
    }
    const pommelX = Math.round(x0);
    const pommelY = Math.round(y0);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = pommelX + dx;
      const y = pommelY + dy;
      if (x >= 0 && x < W && y >= 0 && y < H) frame[y * W + x] = Math.max(frame[y * W + x], 150);
    }
  }

  const DRAW_END = 0.46;
  const R_HEART = 92;
  const R_FRAME = Math.hypot(W / 2, H / 2) + 12;
  let prevP = 0;

  for (let f = 0; f < frames; f++) {
    const u = f / (frames - 1);

    // Phase 1 — wand draws the outline (ease-in-out flourish). Sub-step so
    // consecutive stamps overlap even on the fast middle section.
    if (u <= DRAW_END) {
      const p = smooth(u / DRAW_END);
      const STEPS = 14;
      for (let s = 1; s <= STEPS; s++) {
        const q = prevP + ((p - prevP) * s) / STEPS;
        const h = headAt(q);
        const wob = Math.sin(q * 61) * 0.6; // slight hand wobble
        stamp(h.x + wob, h.y + wob * 0.5, 2.6, 0.5); // core stroke
        stamp(h.x, h.y, 6, 0.045); // soft glow halo
      }
      prevP = p;
    }

    // Phase 2 — bloom: radial wipe from centre, clipped to the heart.
    const bloomR = smooth((u - 0.53) / 0.22) * R_HEART;
    // Phase 3 — expand past the heart to the whole frame.
    const expandR = 22 + smooth((u - 0.72) / 0.24) * (R_FRAME - 22);
    // Guarantee ramp, same contract as particle_gather.
    const fillV = smooth((u - 0.88) / 0.1);

    const frame = out.subarray(f * W * H, (f + 1) * W * H);
    for (let i = 0; i < W * H; i++) {
      let v = accum[i];
      if (bloomR > 0 && inside[i]) v = Math.max(v, Math.min(1, (bloomR - dist[i]) / 5));
      if (u >= 0.72) v = Math.max(v, Math.min(1, (expandR - dist[i]) / 12));
      v = Math.max(v, fillV);
      frame[i] = Math.round(Math.max(0, Math.min(1, v)) * 255);
    }

    // Transient sparkles at the wand head (drawn into the frame only).
    if (u <= DRAW_END) {
      drawTransientWand(frame, prevP);
      const h = headAt(prevP);
      const cxh = Math.round(h.x);
      const cyh = Math.round(h.y);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (Math.abs(dx) + Math.abs(dy) > 1) continue; // plus-shape head
          const px = cxh + dx;
          const py = cyh + dy;
          if (px >= 0 && px < W && py >= 0 && py < H) frame[py * W + px] = 255;
        }
      }
      for (let k = 0; k < 3; k++) {
        // twinkles scattered just behind the head
        const back = Math.max(0, prevP - rand() * 0.03);
        const b = headAt(back);
        const px = Math.round(b.x + (rand() - 0.5) * 8);
        const py = Math.round(b.y + (rand() - 0.5) * 8);
        if (px >= 0 && px < W && py >= 0 && py < H && rand() < 0.7) frame[py * W + px] = 255;
      }
    }

    // After the wand completes, fine light grains bloom around the heart and
    // fade away while the radial mask expands to reveal the complete photo.
    if (u > DRAW_END && u < 0.86) {
      const phase = (u - DRAW_END) / (0.86 - DRAW_END);
      const alpha = Math.sin(Math.PI * phase);
      const count = Math.round(90 * alpha);
      for (let k = 0; k < count; k++) {
        const a = rand() * Math.PI * 2;
        const radius = (30 + rand() * 105) * (0.45 + phase * 0.75);
        const px = Math.round(cx + Math.cos(a) * radius);
        const py = Math.round(H / 2 + Math.sin(a) * radius * 0.72);
        if (px < 0 || px >= W || py < 0 || py >= H) continue;
        frame[py * W + px] = Math.max(frame[py * W + px], Math.round(150 + 105 * alpha));
      }
    }
  }

  return { name: "heart_wand", raw: out, frames, duration: DURATION };
}

function generateBrushStroke() {
  // "Bàn chải sơn": the photo appears through five broad horizontal paint
  // swipes on black, alternating direction like painting a wall. The natural
  // look lives in the mask texture: ragged multi-octave band edges, thin
  // dry-brush streaks along the stroke direction, bristle tips leading the
  // head, and paint spatter. A late ramp fills the deliberate gaps.
  const DURATION = 5.0;
  const frames = Math.round(DURATION * FPS);
  const rand = mulberry32(20260712);
  const accum = new Float32Array(W * H);
  const out = Buffer.alloc(W * H * frames);

  // Aperiodic 2-D value noise (hashed lattice + smoothstep interpolation).
  // Summed sines were tried first and read as window blinds — any periodic
  // texture is instantly visible in a full-frame mask.
  function makeNoise2(cellX, cellY) {
    const ox = rand() * 1000;
    const oy = rand() * 1000;
    const hash = (i, j) => {
      const s = Math.sin(i * 127.1 + j * 311.7 + ox * 0.017 + oy) * 43758.5453;
      return s - Math.floor(s);
    };
    const sm = (v) => v * v * (3 - 2 * v);
    return (x, y) => {
      const gx = (x + ox) / cellX;
      const gy = (y + oy) / cellY;
      const i = Math.floor(gx);
      const j = Math.floor(gy);
      const fx = sm(gx - i);
      const fy = sm(gy - j);
      const a = hash(i, j) * (1 - fx) + hash(i + 1, j) * fx;
      const b = hash(i, j + 1) * (1 - fx) + hash(i + 1, j + 1) * fx;
      return a * (1 - fy) + b * fy; // [0, 1]
    };
  }

  const smooth = (v) => (v <= 0 ? 0 : v >= 1 ? 1 : v * v * (3 - 2 * v));
  const STROKES = 5;
  const bandH = H / STROKES;
  const strokes = [];
  for (let k = 0; k < STROKES; k++) {
    const eCoarse = makeNoise2(34, 1);
    const eFine = makeNoise2(9, 1);
    const streakN = makeNoise2(190, 0.75); // finer separated bristle fibres
    const leadN = makeNoise2(1, 2.2);
    // Bristle tips are fixed on the brush, so the lead profile is per-row
    // and constant for the whole sweep.
    const lead = new Float32Array(H);
    for (let y = 0; y < H; y++) lead[y] = 1 + 8 * leadN(0, y);
    strokes.push({
      yc: (k + 0.5) * bandH,
      hh: bandH * 0.64, // bands overlap so no black seams between swipes
      isFirst: k === 0,
      isLast: k === STROKES - 1,
      dir: k % 2 === 0 ? 1 : -1,
      start: 0.04 + k * 0.145,
      dur: 0.2,
      edgeTop: (x) => (eCoarse(x, 0) - 0.5) * 15 + (eFine(x, 0) - 0.5) * 6,
      edgeBot: (x) => (eCoarse(x, 500) - 0.5) * 15 + (eFine(x, 500) - 0.5) * 6,
      // Mostly solid paint; sparse deep dips = dry-brush streaks that appear
      // and die out along the sweep (2-D noise, not a per-row constant).
      texture: (x, y) => 1 - 0.9 * smooth((streakN(x, y) - 0.72) / 0.055),
      lead,
    });
  }

  function paintColumn(st, x, gain) {
    if (x < 0 || x >= W || gain <= 0) return;
    // Outer bands paint past the frame edge — the swipe must cover the frame
    // corners itself, not leave them for the guarantee ramp.
    const top = st.isFirst ? -4 : st.yc - st.hh + st.edgeTop(x);
    const bot = st.isLast ? H + 4 : st.yc + st.hh + st.edgeBot(x);
    const y0 = Math.max(0, Math.floor(top));
    const y1 = Math.min(H - 1, Math.ceil(bot));
    for (let y = y0; y <= y1; y++) {
      const feather = Math.min(1, Math.min(y - top, bot - y) / 1.5);
      if (feather <= 0) continue;
      const v = gain * feather * st.texture(x, y);
      const idx = y * W + x;
      if (v > accum[idx]) accum[idx] = v;
    }
  }

  // Ragged leading edge: rows keep painting a short fading run past the head
  // (persistent — the advancing head overwrites it with full paint via max).
  function paintTips(st, headX) {
    const top = st.yc - st.hh + st.edgeTop(headX);
    const bot = st.yc + st.hh + st.edgeBot(headX);
    const y0 = Math.max(0, Math.floor(top));
    const y1 = Math.min(H - 1, Math.ceil(bot));
    for (let y = y0; y <= y1; y++) {
      const L = st.lead[y];
      for (let d = 1; d <= L; d++) {
        const x = Math.round(headX + st.dir * d);
        if (x < 0 || x >= W) break;
        const v = (1 - d / (L + 1)) * 0.85 * st.texture(x, y);
        const idx = y * W + x;
        if (v > accum[idx]) accum[idx] = v;
      }
    }
  }

  for (let f = 0; f < frames; f++) {
    const u = f / (frames - 1);
    const heads = [];

    for (const st of strokes) {
      const tl = (u - st.start) / st.dur;
      const tlPrev = (u - 1 / (frames - 1) - st.start) / st.dur;
      if (tl <= 0 || tlPrev >= 1) continue;
      const pos = (q) => {
        const c = Math.max(0, Math.min(1, q));
        return st.dir > 0 ? -20 + c * (W + 40) : W + 20 - c * (W + 40);
      };
      const xPrev = pos(tlPrev);
      const xCur = pos(tl);
      const from = Math.round(Math.min(xPrev, xCur));
      const to = Math.round(Math.max(xPrev, xCur));
      for (let x = from; x <= to; x++) paintColumn(st, x, 1);
      if (tl < 1) {
        paintTips(st, xCur);
        heads.push({ st, x: xCur });
      }
    }

    // Guarantee ramp closes the dry-brush gaps and any missed seam.
    const fillV = smooth((u - 0.84) / 0.12);

    const frame = out.subarray(f * W * H, (f + 1) * W * H);
    for (let i = 0; i < W * H; i++) {
      const v = Math.max(accum[i], fillV);
      frame[i] = Math.round(Math.min(1, v) * 255);
    }

    // Transient paint spatter just ahead of each live head (frame only).
    for (const { st, x } of heads) {
      for (let k = 0; k < 4; k++) {
        const px = Math.round(x + st.dir * (4 + rand() * 16));
        const py = Math.round(st.yc + (rand() - 0.5) * st.hh * 2.1);
        if (px < 1 || px >= W - 1 || py < 1 || py >= H - 1 || rand() > 0.75) continue;
        frame[py * W + px] = 255;
        frame[py * W + px + 1] = 255;
        frame[(py + 1) * W + px] = 255;
      }
    }
  }

  return { name: "brush_stroke", raw: out, frames, duration: DURATION };
}

const GENERATORS = {
  particle_gather: generateParticleGather,
  heart_wand: generateHeartWand,
  brush_stroke: generateBrushStroke,
};

const onlyIdx = process.argv.indexOf("--only");
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;

const outDir = path.resolve(root, "assets/masks");
fs.mkdirSync(outDir, { recursive: true });

for (const [name, gen] of Object.entries(GENERATORS)) {
  if (only && only !== name) continue;
  process.stdout.write(`${name}: generating frames... `);
  const { raw, duration } = gen();

  const rawPath = path.join(os.tmpdir(), `mask_${name}.gray`);
  fs.writeFileSync(rawPath, raw);
  const outPath = path.join(outDir, `${name}.mp4`);

  const r = spawnSync(
    ffmpeg,
    [
      "-y",
      "-f", "rawvideo", "-pix_fmt", "gray", "-s", `${W}x${H}`, "-r", String(FPS),
      "-i", rawPath,
      "-vf", `gblur=sigma=${name === "particle_gather" ? 0.55 : name === "heart_wand" ? 0.7 : 0.4},scale=${OUT_W}:${OUT_H}:flags=bicubic,format=yuv420p`,
      "-t", String(duration),
      "-c:v", "libx264", "-preset", "medium", "-crf", "16",
      "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      outPath,
    ],
    { encoding: "utf8", maxBuffer: 1 << 26 }
  );
  fs.rmSync(rawPath, { force: true });
  if (r.status !== 0) {
    console.error(`FAILED\n${(r.stderr || "").split("\n").slice(-12).join("\n")}`);
    process.exit(1);
  }
  console.log(
    `ok (${Math.round(fs.statSync(outPath).size / 1024)} KB, ${duration}s) -> assets/masks/${name}.mp4`
  );
}
