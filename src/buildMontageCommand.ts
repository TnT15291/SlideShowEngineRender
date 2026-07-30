import { buildCaptionFilter } from "./captionFilter";
import { buildColorFilter, buildLetterboxFilter } from "./buildColorFilters";
import { toFfmpegPath } from "./fileUtils";
import { buildTechnicalColorFilter, quoteFilterPath } from "./ffmpegFilterHelpers";
import { videoEncodeArgs } from "./quality";
import type { EffectPreset, RenderSlideStep } from "./types";

const BG_BLUR_SIGMA = 20;
const DECOR_FONT = "C:/Windows/Fonts/arial.ttf";

export function buildCollageGridArgs(step: RenderSlideStep): string[] {
  const inputs: string[] = [];
  for (const input of step.inputs) {
    inputs.push("-loop", "1", "-t", String(step.duration), "-i", input);
  }

  return [
    "-y",
    ...inputs,
    "-filter_complex",
    buildCollageGridFilter(step),
    "-map",
    "[vout]",
    "-t",
    String(step.duration),
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

export function buildFilmRollArgs(step: RenderSlideStep): string[] {
  const inputs: string[] = [];
  for (const input of step.inputs) {
    inputs.push("-loop", "1", "-t", String(step.duration), "-i", input);
  }

  return [
    "-y",
    ...inputs,
    "-filter_complex",
    buildFilmRollFilter(step),
    "-map",
    "[vout]",
    "-t",
    String(step.duration),
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

/**
 * Build the -vf filtergraph for a slide's effect. Returns one graph with a
 * single video input and single output (usable directly as -vf).
 *
 * Commas/colons inside zoompan expressions are wrapped in single quotes so
 * ffmpeg's filtergraph tokenizer doesn't mistake them for filter separators.
 */
function buildCollageGridFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const count = step.inputs.length;
  const cols = count <= 2 ? count : count <= 4 ? 2 : 3;
  const rows = Math.ceil(count / cols);
  const margin = 70;
  const gap = 34;
  const cellW = Math.floor((w - margin * 2 - gap * (cols - 1)) / cols);
  const cellH = Math.floor((h - margin * 2 - gap * (rows - 1)) / rows);
  const photoW = cellW - 24;
  const photoH = cellH - 24;
  const filters: string[] = [];

  filters.push(
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},gblur=sigma=${BG_BLUR_SIGMA},` +
      `eq=brightness=-0.08:contrast=0.9:saturation=0.85,` +
      `setsar=1,fps=${fps},format=yuv420p[bg]`
  );

  let current = "bg";
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const rowStart = row * cols;
    const rowCount = Math.min(cols, count - rowStart);
    const col = i - rowStart;
    const rowOffset = Math.floor(((cols - rowCount) * (cellW + gap)) / 2);
    const x = margin + rowOffset + col * (cellW + gap);
    const y = margin + row * (cellH + gap);
    const prepared = `c${i}`;
    const next = `cg${i}`;
    filters.push(
      `[${i}:v]scale=${photoW}:${photoH}:force_original_aspect_ratio=decrease,` +
        `pad=${cellW}:${cellH}:(ow-iw)/2:(oh-ih)/2:color=white,` +
        `drawbox=x=0:y=0:w=${cellW}:h=${cellH}:color=0xffffff@0.85:t=8,` +
        `setsar=1,fps=${fps},format=yuv420p[${prepared}]`
    );
    filters.push(`[${current}][${prepared}]overlay=${x}:${y}:shortest=1[${next}]`);
    current = next;
  }

  const post = [
    buildTechnicalColorFilter(step.technicalColor),
    buildColorFilter(step.color),
    buildLetterboxFilter(step.color, w, h),
    ...step.captions.map((c) => buildCaptionFilter(c, h)),
  ].filter((f): f is string => Boolean(f));
  post.forEach((filter, i) => {
    const next = `cgpost${i}`;
    filters.push(`[${current}]${filter}[${next}]`);
    current = next;
  });
  filters.push(`[${current}]trim=duration=${duration},fps=${fps},format=yuv420p[vout]`);

  return filters.join(";");
}

function buildFilmRollFilter(step: RenderSlideStep): string {
  if (isPhotoStripEffect(step.effect)) return buildPhotoStripFilter(step);
  if (step.effect === "film_roll_left" || step.effect === "film_roll_right") {
    return buildHorizontalFilmRollFilter(step, step.effect === "film_roll_left" ? "left" : "right");
  }

  const { width: w, height: h, fps, duration } = step;
  const cardW = Math.round(w * 0.52);
  const cardH = Math.round(h * 0.45);
  const sideRail = Math.round(cardW * 0.052);
  const framePadX = 10;
  const framePadY = 12;
  const imageX = sideRail + framePadX;
  const imageY = framePadY;
  const innerW = cardW - sideRail * 2 - framePadX * 2;
  const innerH = cardH - framePadY * 2;
  const filters: string[] = [];

  filters.push(
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},gblur=sigma=${BG_BLUR_SIGMA},` +
      `eq=brightness=-0.05:contrast=0.9:saturation=0.85,` +
      `setsar=1,fps=${fps},format=yuv420p[bg]`
  );

  for (let i = 0; i < step.inputs.length; i++) {
    filters.push(
      `[${i}:v]scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease,` +
        `pad=${innerW}:${innerH}:(ow-iw)/2:(oh-ih)/2:color=0x111111,setsar=1[photo${i}]`
    );
    filters.push(
      `color=c=0x101010:s=${cardW}x${cardH}:r=${fps}:d=${duration}[filmBase${i}]`
    );
    filters.push(
      `[filmBase${i}][photo${i}]overlay=${imageX}:${imageY},` +
        buildFilmFrameDecorations(cardW, cardH, sideRail, i) +
        `,fps=${fps},format=yuv420p[p${i}]`
    );
  }

  const stackInputs = step.inputs.map((_, i) => `[p${i}]`).join("");
  filters.push(`${stackInputs}vstack=inputs=${step.inputs.length}[strip]`);
  filters.push(
    `[bg][strip]overlay=x=(W-w)/2:` +
      `y='(H-h)/2+(0.5-t/${duration.toFixed(4)})*H*0.62':shortest=1,` +
      `fps=${fps},format=yuv420p[roll0]`
  );

  const post = [
    buildColorFilter(step.color),
    buildLetterboxFilter(step.color, w, h),
    ...step.captions.map((c) => buildCaptionFilter(c, h)),
  ].filter((f): f is string => Boolean(f));
  let current = "roll0";
  post.forEach((filter, i) => {
    const next = `roll${i + 1}`;
    filters.push(`[${current}]${filter}[${next}]`);
    current = next;
  });
  filters.push(`[${current}]format=yuv420p[vout]`);

  return filters.join(";");
}

function buildHorizontalFilmRollFilter(
  step: RenderSlideStep,
  direction: "left" | "right"
): string {
  const { width: w, height: h, fps, duration } = step;
  const cardW = Math.round(w * 0.38);
  const cardH = Math.round(h * 0.58);
  const railH = Math.round(cardH * 0.055);
  const framePadX = 12;
  const framePadY = 10;
  const imageX = framePadX;
  const imageY = railH + framePadY;
  const innerW = cardW - framePadX * 2;
  const innerH = cardH - railH * 2 - framePadY * 2;
  const filters: string[] = [];

  filters.push(
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},gblur=sigma=${BG_BLUR_SIGMA},` +
      `eq=brightness=-0.05:contrast=0.9:saturation=0.85,` +
      `setsar=1,fps=${fps},format=yuv420p[bg]`
  );

  for (let i = 0; i < step.inputs.length; i++) {
    filters.push(
      `[${i}:v]scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease,` +
        `pad=${innerW}:${innerH}:(ow-iw)/2:(oh-ih)/2:color=0x111111,setsar=1[photo${i}]`
    );
    filters.push(
      `color=c=0x101010:s=${cardW}x${cardH}:r=${fps}:d=${duration}[filmBase${i}]`
    );
    filters.push(
      `[filmBase${i}][photo${i}]overlay=${imageX}:${imageY},` +
        buildHorizontalFilmFrameDecorations(cardW, cardH, railH, i) +
        `,fps=${fps},format=yuv420p[p${i}]`
    );
  }

  const stackInputs = step.inputs.map((_, i) => `[p${i}]`).join("");
  filters.push(`${stackInputs}hstack=inputs=${step.inputs.length}[strip]`);

  const y = `(H-h)/2`;
  const x =
    direction === "left"
      ? `'(W-w)/2+(0.5-t/${duration.toFixed(4)})*W*0.68'`
      : `'(W-w)/2+(-0.5+t/${duration.toFixed(4)})*W*0.68'`;
  filters.push(
    `[bg][strip]overlay=x=${x}:y=${y}:shortest=1,` +
      `fps=${fps},format=yuv420p[roll0]`
  );

  const post = [
    buildColorFilter(step.color),
    buildLetterboxFilter(step.color, w, h),
    ...step.captions.map((c) => buildCaptionFilter(c, h)),
  ].filter((f): f is string => Boolean(f));
  let current = "roll0";
  post.forEach((filter, i) => {
    const next = `roll${i + 1}`;
    filters.push(`[${current}]${filter}[${next}]`);
    current = next;
  });
  filters.push(`[${current}]format=yuv420p[vout]`);

  return filters.join(";");
}

/** A clean editorial ribbon: photos touch edge-to-edge with only a hairline gap.
 * The first image also supplies the full-frame hero backdrop, so a vertical strip can
 * sit left/centre/right while the couple remains visible in the unused space. */
function buildPhotoStripFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const vertical = step.effect === "photo_strip_up";
  const gap = 4;
  const cellW = vertical ? Math.round(w * 0.31) : Math.round(w * 0.32);
  const cellH = vertical ? Math.round(h * 0.42) : Math.round(h * 0.64);
  const stripColor = "0xf7f2e8";
  // The outer mat: photos still touch edge-to-edge with just the hairline `gap`
  // between them (the "clean ribbon" look), but the assembled strip as a whole
  // now sits inside one visible frame instead of floating borderless.
  const border = Math.max(10, Math.round(Math.min(cellW, cellH) * 0.03));
  const filters: string[] = [];

  filters.push(
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
      `gblur=sigma=10,eq=brightness=-0.12:contrast=0.94:saturation=0.82,` +
      `setsar=1,fps=${fps},format=yuv420p[bg]`
  );
  for (let i = 0; i < step.inputs.length; i++) {
    filters.push(
      `[${i}:v]scale=${cellW}:${cellH}:force_original_aspect_ratio=increase,` +
        `crop=${cellW}:${cellH},pad=${cellW + (vertical ? 0 : gap)}:${cellH + (vertical ? gap : 0)}:0:0:color=${stripColor},` +
        `setsar=1,fps=${fps},format=yuv420p[ps${i}]`
    );
  }
  const stackInputs = step.inputs.map((_, i) => `[ps${i}]`).join("");
  filters.push(`${stackInputs}${vertical ? "vstack" : "hstack"}=inputs=${step.inputs.length}[strip]`);
  filters.push(`[strip]pad=iw+${border * 2}:ih+${border * 2}:${border}:${border}:color=${stripColor}[stripframed]`);

  if (vertical) {
    const position = String(step.rendererParams.position ?? "center");
    const x = position === "left" ? Math.round(w * 0.06) : position === "right" ? `W-w-${Math.round(w * 0.06)}` : `(W-w)/2`;
    filters.push(
      `[bg][stripframed]overlay=x=${x}:y='(H-h)/2+(0.5-t/${duration.toFixed(4)})*H*0.58':shortest=1,` +
        `fps=${fps},format=yuv420p[strip0]`
    );
  } else {
    const progress = step.effect === "photo_strip_left"
      ? `(0.5-t/${duration.toFixed(4)})`
      : `(-0.5+t/${duration.toFixed(4)})`;
    filters.push(
      `[bg][stripframed]overlay=x='(W-w)/2+${progress}*W*0.62':y=(H-h)/2:shortest=1,` +
        `fps=${fps},format=yuv420p[strip0]`
    );
  }

  const post = [
    buildColorFilter(step.color),
    buildLetterboxFilter(step.color, w, h),
    ...step.captions.map((c) => buildCaptionFilter(c, h)),
  ].filter((f): f is string => Boolean(f));
  let current = "strip0";
  post.forEach((filter, i) => {
    const next = `strippost${i}`;
    filters.push(`[${current}]${filter}[${next}]`);
    current = next;
  });
  filters.push(`[${current}]format=yuv420p[vout]`);
  return filters.join(";");
}

function buildFilmFrameDecorations(
  cardW: number,
  cardH: number,
  sideRail: number,
  index: number
): string {
  const holeW = Math.round(sideRail * 0.45);
  const holeH = 34;
  const holeXLeft = Math.round((sideRail - holeW) / 2);
  const holeXRight = cardW - sideRail + holeXLeft;
  const step = Math.round(cardH / 5);
  const firstY = Math.round((step - holeH) / 2);
  const parts = [
    `drawbox=x=0:y=0:w=${sideRail}:h=${cardH}:color=black@0.72:t=fill`,
    `drawbox=x=${cardW - sideRail}:y=0:w=${sideRail}:h=${cardH}:color=black@0.72:t=fill`,
    `drawbox=x=${sideRail}:y=0:w=2:h=${cardH}:color=0x777777@0.45:t=fill`,
    `drawbox=x=${cardW - sideRail - 2}:y=0:w=2:h=${cardH}:color=0x777777@0.45:t=fill`,
  ];

  for (let i = 0; i < 5; i++) {
    const y = firstY + i * step;
    parts.push(`drawbox=x=${holeXLeft}:y=${y}:w=${holeW}:h=${holeH}:color=0xf4eee0:t=fill`);
    parts.push(`drawbox=x=${holeXRight}:y=${y}:w=${holeW}:h=${holeH}:color=0xf4eee0:t=fill`);
  }

  parts.push(`drawtext=fontfile=${quoteFilterPath(toFfmpegPath(DECOR_FONT))}:text='${String(index + 1).padStart(2, "0")}':fontcolor=0xd8c9a8:fontsize=14:x=${sideRail + 8}:y=${cardH - 18}`);

  return parts.join(",");
}

function buildHorizontalFilmFrameDecorations(
  cardW: number,
  cardH: number,
  railH: number,
  index: number
): string {
  const holeW = 42;
  const holeH = Math.round(railH * 0.45);
  const holeYTop = Math.round((railH - holeH) / 2);
  const holeYBottom = cardH - railH + holeYTop;
  const step = Math.round(cardW / 5);
  const firstX = Math.round((step - holeW) / 2);
  const parts = [
    `drawbox=x=0:y=0:w=${cardW}:h=${railH}:color=black@0.72:t=fill`,
    `drawbox=x=0:y=${cardH - railH}:w=${cardW}:h=${railH}:color=black@0.72:t=fill`,
    `drawbox=x=0:y=${railH}:w=${cardW}:h=2:color=0x777777@0.45:t=fill`,
    `drawbox=x=0:y=${cardH - railH - 2}:w=${cardW}:h=2:color=0x777777@0.45:t=fill`,
  ];

  for (let i = 0; i < 5; i++) {
    const x = firstX + i * step;
    parts.push(`drawbox=x=${x}:y=${holeYTop}:w=${holeW}:h=${holeH}:color=0xf4eee0:t=fill`);
    parts.push(`drawbox=x=${x}:y=${holeYBottom}:w=${holeW}:h=${holeH}:color=0xf4eee0:t=fill`);
  }

  parts.push(`drawtext=fontfile=${quoteFilterPath(toFfmpegPath(DECOR_FONT))}:text='${String(index + 1).padStart(2, "0")}':fontcolor=0xd8c9a8:fontsize=14:x=${cardW - 28}:y=${cardH - railH + 3}`);

  return parts.join(",");
}

export function isFilmRollEffect(effect: EffectPreset): boolean {
  return effect === "film_roll_up" || effect === "film_roll_left" || effect === "film_roll_right";
}

export function isPhotoStripEffect(effect: EffectPreset): boolean {
  return effect === "photo_strip_up" || effect === "photo_strip_left" || effect === "photo_strip_right";
}
