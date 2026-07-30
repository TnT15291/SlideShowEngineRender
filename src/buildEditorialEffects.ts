import { buildColorFilter, buildLetterboxFilter } from "./buildColorFilters";
import { canvasBackground, cssColor, quoteFilterPath } from "./ffmpegFilterHelpers";
import { toFfmpegPath } from "./fileUtils";
import { videoEncodeArgs } from "./quality";
import type { CompiledCaption, RenderSlideStep } from "./types";

// --- Dark film-look timeline scenes (memory_wall / dark_feather) ---
// Modeled on the "Dark Classic Minimalist Film Look" wedding-slideshow style:
// near-black background, a thin timeline rule, an elegant year + small caption
// lockup, and photos presented as physical prints / film negatives. Chain
// scenes with `slide_left` transitions for the pan-along-a-wall feel.

const WALL_LINE_Y = 0.62; // timeline rule, as a fraction of frame height

/** Deterministic side pick: even slide-id hash puts text left, photos right;
 *  odd mirrors the scene. Rename the slide id to flip a scene's layout. */
function textOnLeft(slideId: string): boolean {
  let sum = 0;
  for (let i = 0; i < slideId.length; i++) sum += slideId.charCodeAt(i);
  return sum % 2 === 0;
}

/** The thin timeline rule. Full-width for memory_wall (drawn under the photo
 *  layer); side-margin segments for dark_feather (drawn over the photo, so the
 *  gap makes it read as passing behind). */
export function lockupLineFilter(w: number, h: number, full: boolean): string {
  const lineY = Math.round(h * WALL_LINE_Y);
  const color = "0x8a8a8a@0.5";
  if (full) return `drawbox=x=0:y=${lineY}:w=${w}:h=2:color=${color}:t=fill`;
  const inset = Math.round(w * 0.115);
  return (
    `drawbox=x=0:y=${lineY}:w=${inset}:h=2:color=${color}:t=fill,` +
    `drawbox=x=${w - inset}:y=${lineY}:w=${inset}:h=2:color=${color}:t=fill`
  );
}

/**
 * Role-anchored lockup text (replaces generic centered captions for these
 * effects): title = large serif name above the rule, subtitle = year sitting
 * just above the rule, caption = small line(s) below the rule. All texts share
 * one side margin and fade in/out over their caption window.
 */
export function lockupTextFilters(step: RenderSlideStep): string[] {
  const { width: w, height: h } = step;
  const lineY = Math.round(h * WALL_LINE_Y);
  const mx = Math.round(w * 0.045);
  const x = textOnLeft(step.slideId) ? String(mx) : `w-text_w-${mx}`;

  const titles = step.captions.filter((c) => c.role === "title");
  const subtitles = step.captions.filter((c) => c.role === "subtitle");
  const smalls = step.captions.filter((c) => c.role === "caption");

  const out: string[] = [];
  const nearLine = Math.round(h * 0.022);
  const titleLift = subtitles.length > 0 ? Math.round(h * 0.12) : nearLine;
  for (const c of titles) {
    out.push(lockupDrawtext(c, x, `${lineY}-text_h-${titleLift}`, Math.round(h / 12)));
  }
  for (const c of subtitles) {
    out.push(lockupDrawtext(c, x, `${lineY}-text_h-${nearLine}`, Math.round(h / 22)));
  }
  smalls.forEach((c, i) => {
    const y = lineY + Math.round(h * 0.024) + i * Math.round(h * 0.052);
    out.push(lockupDrawtext(c, x, String(y), Math.round(h / 48)));
  });
  return out;
}

function lockupDrawtext(
  c: CompiledCaption,
  xExpr: string,
  yExpr: string,
  defaultSize: number
): string {
  const fontSize = c.size ?? defaultSize;
  const start = c.start;
  const end = c.start + c.duration;
  const fade = Math.min(0.4, c.duration / 2);
  const alpha =
    `if(lt(t,${start}),0,` +
    `if(lt(t,${start + fade}),(t-${start})/${fade},` +
    `if(lt(t,${end - fade}),1,` +
    `if(lt(t,${end}),(${end}-t)/${fade},0))))`;
  return [
    `drawtext=fontfile=${quoteFilterPath(toFfmpegPath(c.fontFile))}`,
    `textfile=${quoteFilterPath(toFfmpegPath(c.textFile))}`,
    `fontcolor=${cssColor(c.color)}`,
    `fontsize=${fontSize}`,
    `x=${xExpr}`,
    `y=${yExpr}`,
    `alpha='${alpha}'`,
  ].join(":");
}

/**
 * Dark feather: the photo at its own aspect (sized from the probed source
 * dimensions — no crop), centered on black, its edges melting into the
 * background via a luma/chroma ramp (background is black, so fading to black
 * equals an alpha feather), with a slow eased horizontal drift.
 */
export function darkFeatherFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const ar =
    step.srcWidth && step.srcHeight ? step.srcWidth / step.srcHeight : 1.5;
  const maxW = w * 0.74;
  const maxH = h * 0.76;
  const innerW = 2 * Math.round(Math.min(maxW, maxH * ar) / 2);
  const innerH = 2 * Math.round(innerW / ar / 2);

  const slack = 28; // horizontal drift room
  const padW = w + slack;
  const px0 = Math.round((padW - innerW) / 2);
  const py0 = Math.round((h - innerH) / 2);
  const px1 = px0 + innerW;
  const py1 = py0 + innerH;
  const feather = Math.round(Math.min(w, h) * 0.05);

  // 0 outside the photo, ramping to 1 `feather` px inside its edges.
  const ramp =
    `clip((min(min(X-${px0},${px1}-X),min(Y-${py0},${py1}-Y)))/${feather},0,1)`;

  const t = `min(t/${duration.toFixed(4)},1)`;
  const drift = `(${t}*${t}*(3-2*${t}))`;

  return (
    `scale=${innerW}:${innerH},setsar=1,` +
    `pad=${padW}:${h}:${px0}:${py0}:color=black,` +
    `format=yuv444p,` +
    `geq=lum='lum(X,Y)*${ramp}':` +
    `cb='128+(cb(X,Y)-128)*${ramp}':` +
    `cr='128+(cr(X,Y)-128)*${ramp}',` +
    `crop=${w}:${h}:x='${slack}-${slack}*${drift}':y=0,` +
    `fps=${fps},format=yuv420p`
  );
}

// One scatter arrangement per photo count. cx/cy = card center (fractions of
// the frame), fh = photo height fraction, deg = tilt, ar = crop aspect,
// film = negative-style frame (vs white print). Tuned so clusters stay clear
// of the text side (left) — the whole scene mirrors when text sits right.
interface WallSlot {
  cx: number;
  cy: number;
  fh: number;
  deg: number;
  ar: number;
  film: boolean;
}

const WALL_LAYOUTS: Record<number, WallSlot[]> = {
  1: [{ cx: 0.66, cy: 0.44, fh: 0.52, deg: -2.2, ar: 1.35, film: true }],
  2: [
    { cx: 0.57, cy: 0.35, fh: 0.4, deg: -3, ar: 0.82, film: true },
    { cx: 0.76, cy: 0.56, fh: 0.38, deg: 2.5, ar: 1.4, film: false },
  ],
  3: [
    { cx: 0.54, cy: 0.27, fh: 0.33, deg: -3, ar: 1.42, film: false },
    { cx: 0.72, cy: 0.36, fh: 0.36, deg: 2, ar: 0.8, film: true },
    { cx: 0.62, cy: 0.64, fh: 0.34, deg: -2, ar: 1.35, film: true },
  ],
  4: [
    { cx: 0.5, cy: 0.28, fh: 0.32, deg: -2.5, ar: 1.4, film: false },
    { cx: 0.67, cy: 0.25, fh: 0.31, deg: 3, ar: 0.82, film: true },
    { cx: 0.57, cy: 0.6, fh: 0.33, deg: -1.8, ar: 1.35, film: true },
    { cx: 0.79, cy: 0.55, fh: 0.33, deg: 2.2, ar: 0.8, film: false },
  ],
  5: [
    { cx: 0.48, cy: 0.28, fh: 0.3, deg: -2.5, ar: 1.4, film: false },
    { cx: 0.64, cy: 0.24, fh: 0.29, deg: 3, ar: 0.82, film: true },
    { cx: 0.55, cy: 0.6, fh: 0.31, deg: -1.8, ar: 1.35, film: true },
    { cx: 0.76, cy: 0.56, fh: 0.31, deg: 2.2, ar: 0.8, film: false },
    { cx: 0.88, cy: 0.28, fh: 0.28, deg: -3, ar: 0.84, film: true },
  ],
  6: [
    { cx: 0.48, cy: 0.27, fh: 0.28, deg: -2.5, ar: 1.4, film: false },
    { cx: 0.66, cy: 0.24, fh: 0.27, deg: 2.5, ar: 0.82, film: true },
    { cx: 0.84, cy: 0.28, fh: 0.27, deg: -2, ar: 1.35, film: false },
    { cx: 0.5, cy: 0.61, fh: 0.28, deg: 2, ar: 0.82, film: true },
    { cx: 0.69, cy: 0.58, fh: 0.29, deg: -2.2, ar: 1.4, film: false },
    { cx: 0.87, cy: 0.62, fh: 0.27, deg: 2.5, ar: 0.84, film: true },
  ],
};

/** Cover-crop one photo into its slot and frame it as a white print or a
 *  film negative (charcoal border, faint outline, sprocket holes). */
function wallCardFilter(slot: WallSlot, h: number): { chain: string; outerW: number; outerH: number } {
  const ih = Math.round(h * slot.fh);
  const iw = Math.round(ih * slot.ar);
  const parts: string[] = [
    `scale=${iw}:${ih}:force_original_aspect_ratio=increase,crop=${iw}:${ih}`,
  ];

  let outerW: number;
  let outerH: number;
  // Every small archive photo uses the same slim ivory matte. Mixing white prints
  // and branded negative frames inside one wall made one template look like two kits.
  const b = Math.max(6, Math.round(ih * 0.025));
  outerW = iw + b * 2;
  outerH = ih + b * 2;
  parts.push(`pad=${outerW}:${outerH}:${b}:${b}:color=0xfaf6ed`);

  const rad = (slot.deg * Math.PI) / 180;
  parts.push(
    `setsar=1,format=rgba,` +
      `rotate=${rad.toFixed(5)}:c=none:ow=rotw(${rad.toFixed(5)}):oh=roth(${rad.toFixed(5)})`
  );

  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return {
    chain: parts.join(","),
    outerW: Math.ceil(cos * outerW + sin * outerH),
    outerH: Math.ceil(sin * outerW + cos * outerH),
  };
}

function sprocketHoles(
  outerW: number,
  outerH: number,
  rail: number,
  dir: "horizontal" | "vertical"
): string {
  const boxes: string[] = [];
  if (dir === "horizontal") {
    const holeW = Math.round(outerW * 0.06);
    const holeH = Math.round(rail * 0.48);
    const stepX = outerW / 5;
    const firstX = Math.round((stepX - holeW) / 2);
    const yTop = Math.round((rail - holeH) / 2);
    const yBot = outerH - rail + yTop;
    for (let i = 0; i < 5; i++) {
      const x = firstX + Math.round(i * stepX);
      boxes.push(`drawbox=x=${x}:y=${yTop}:w=${holeW}:h=${holeH}:color=0x2b2b2b:t=fill`);
      boxes.push(`drawbox=x=${x}:y=${yBot}:w=${holeW}:h=${holeH}:color=0x2b2b2b:t=fill`);
    }
  } else {
    const holeH = Math.round(outerH * 0.06);
    const holeW = Math.round(rail * 0.48);
    const stepY = outerH / 4;
    const firstY = Math.round((stepY - holeH) / 2);
    const xLeft = Math.round((rail - holeW) / 2);
    const xRight = outerW - rail + xLeft;
    for (let i = 0; i < 4; i++) {
      const y = firstY + Math.round(i * stepY);
      boxes.push(`drawbox=x=${xLeft}:y=${y}:w=${holeW}:h=${holeH}:color=0x2b2b2b:t=fill`);
      boxes.push(`drawbox=x=${xRight}:y=${y}:w=${holeW}:h=${holeH}:color=0x2b2b2b:t=fill`);
    }
  }
  return boxes.join(",");
}

function buildMemoryWallFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const mirror = !textOnLeft(step.slideId);
  const slots = WALL_LAYOUTS[Math.min(step.inputs.length, 6)];
  const filters: string[] = [];

  filters.push(
    `color=c=${canvasBackground(step)}:s=${w}x${h}:r=${fps}:d=${duration}[wbgbase]`,
    `[wbgbase]${lockupLineFilter(w, h, true)}[wbg]`,
    `color=c=black@0.0:s=${w}x${h}:r=${fps}:d=${duration},format=rgba[wcv0]`
  );

  slots.forEach((raw, i) => {
    const slot = mirror ? { ...raw, cx: 1 - raw.cx, deg: -raw.deg } : raw;
    const card = wallCardFilter(slot, h);
    const x = Math.round(slot.cx * w - card.outerW / 2);
    const y = Math.round(slot.cy * h - card.outerH / 2);
    filters.push(`[${i}:v]${card.chain}[wc${i}]`);
    filters.push(`[wcv${i}][wc${i}]overlay=${x}:${y}[wcv${i + 1}]`);
  });

  // The whole photo cluster drifts ~26px with smoothstep easing; text stays put.
  const t = `min(t/${duration.toFixed(4)},1)`;
  const drift = `(${t}*${t}*(3-2*${t}))`;
  filters.push(
    `[wbg][wcv${slots.length}]overlay=x='-13+26*${drift}':y=0:shortest=1,` +
      `fps=${fps},format=yuv420p[wall0]`
  );

  const post = [
    buildColorFilter(step.color),
    buildLetterboxFilter(step.color, w, h),
    ...lockupTextFilters(step),
  ].filter((f): f is string => Boolean(f));
  let current = "wall0";
  post.forEach((filter, i) => {
    const next = `wall${i + 1}`;
    filters.push(`[${current}]${filter}[${next}]`);
    current = next;
  });
  filters.push(`[${current}]trim=duration=${duration},fps=${fps},format=yuv420p[vout]`);

  return filters.join(";");
}

export function buildMemoryWallArgs(step: RenderSlideStep): string[] {
  const slots = WALL_LAYOUTS[Math.min(step.inputs.length, 6)];
  const inputs: string[] = [];
  for (const input of step.inputs.slice(0, slots.length)) {
    inputs.push("-loop", "1", "-t", String(step.duration), "-i", input);
  }

  return [
    "-y",
    ...inputs,
    "-filter_complex",
    buildMemoryWallFilter(step),
    "-map",
    "[vout]",
    "-t",
    String(step.duration),
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}
