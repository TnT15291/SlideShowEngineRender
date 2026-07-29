import { toFfmpegPath } from "./fileUtils";
import { buildLayerGradeFilter, buildTechnicalColorFilter, clamp01, cssColor, quoteFilterPath } from "./ffmpegFilterHelpers";
import { videoEncodeArgs } from "./quality";
import type { RenderSlideStep } from "./types";

export function buildLayerSceneArgs(step: RenderSlideStep): string[] {
  const inputs: string[] = [
    "-f",
    "lavfi",
    "-i",
    `color=c=white:s=${step.width}x${step.height}:r=${step.fps}:d=${step.duration}`,
  ];

  for (const layer of step.layers) {
    if (layer.type === "image") {
      inputs.push("-loop", "1", "-t", String(step.duration), "-i", layer.absPath);
    }
  }

  return [
    "-y",
    ...inputs,
    "-filter_complex",
    buildLayerSceneFilter(step),
    "-map",
    "[vout]",
    "-t",
    String(step.duration),
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

function buildLayerSceneFilter(step: RenderSlideStep): string {
  const filters: string[] = ["[0:v]format=rgba[ls0]"];
  let current = "ls0";
  let imageInput = 1;
  let layerIndex = 0;

  for (const layer of step.layers) {
    const next = `ls${layerIndex + 1}`;
    if (layer.type === "rect") {
      filters.push(
        `[${current}]drawbox=x=${round(layer.x)}:y=${round(layer.y)}:` +
          `w=${round(layer.width)}:h=${round(layer.height)}:` +
          `color=${cssColor(layer.color)}@${layer.opacity}:t=fill:` +
          `enable='between(t,${layer.start},${layer.end})'[${next}]`
      );
    } else if (layer.type === "text") {
      filters.push(
        `[${current}]${buildLayerTextFilter(layer)}[${next}]`
      );
    } else {
      const prepared = `layer${layerIndex}`;
      const frames = Math.max(2, round(step.duration * step.fps));
      filters.push(
        `[${imageInput}:v]${buildLayerImageFilter(layer, prepared, frames, step.fps)}`
      );
      const en = `enable='between(t,${layer.start},${layer.end})'`;
      const px = layerPositionExpr(layer, "x");
      const py = layerPositionExpr(layer, "y");
      if (layer.frame?.shadow) {
        // Split the finished card: one copy becomes a soft, offset, blurred
        // dark silhouette drawn behind the photo.
        const sh = `sh${layerIndex}`;
        const ph = `ph${layerIndex}`;
        const mid = `lsm${layerIndex}`;
        const sx = layerPositionExpr(layer, "x", String(round(layer.x)));
        const sy = layerPositionExpr(layer, "y", String(round(layer.y + 18)));
        filters.push(`[${prepared}]split[${sh}][${ph}]`);
        filters.push(
          `[${sh}]lutrgb=r=0:g=0:b=0,gblur=sigma=16,colorchannelmixer=aa=0.38[${sh}b]`
        );
        filters.push(`[${current}][${sh}b]overlay=${sx}:${sy}:${en}[${mid}]`);
        filters.push(`[${mid}][${ph}]overlay=${px}:${py}:${en}[${next}]`);
      } else {
        filters.push(`[${current}][${prepared}]overlay=${px}:${py}:${en}[${next}]`);
      }
      imageInput++;
    }
    current = next;
    layerIndex++;
  }

  filters.push(`[${current}]fps=${step.fps},format=yuv420p[vout]`);
  return filters.join(";");
}

function buildLayerImageFilter(
  layer: Extract<RenderSlideStep["layers"][number], { type: "image" }>,
  out: string,
  frames: number,
  fps: number
): string {
  const w = round(layer.width);
  const h = round(layer.height);
  const frame = layer.frame;
  const border = frame?.border ? round(frame.border) : 0;
  const innerW = Math.max(2, w - border * 2);
  const innerH = Math.max(2, h - border * 2);

  // Layer-scene image layers use a static fit for FFmpeg compatibility.
  // Motion-based Ken Burns expressions are intentionally disabled here to avoid
  // filter-graph failures on older or narrower ffmpeg builds.
  const base =
    layer.fit === "stretch"
      ? `scale=${innerW}:${innerH}`
      : layer.fit === "contain"
        ? `scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease:force_divisible_by=2,` +
          `pad=${innerW}:${innerH}:(ow-iw)/2:(oh-ih)/2:color=black@0`
        : `scale=${innerW}:${innerH}:force_original_aspect_ratio=increase,` +
          `crop=${innerW}:${innerH}:(iw-ow)*${clamp01(layer.focusX)}:(ih-oh)*${clamp01(layer.focusY)}`;

  const parts = [base];
  const technical = buildTechnicalColorFilter(layer.technicalColor);
  if (technical) parts.push(technical);
  // The look's mood goes on AFTER the album correction, so the correction still does its
  // job (these photographs agreeing with each other) and the mood is applied to the result.
  const grade = buildLayerGradeFilter(layer.grade);
  if (grade) parts.push(grade);
  if (border > 0) {
    parts.push(`pad=${w}:${h}:${border}:${border}:color=${cssColor(frame!.borderColor ?? "white")}`);
  }
  parts.push("format=rgba");
  if (frame?.radius) parts.push(roundedMaskGeq(round(frame.radius)));
  if (layer.rotation && layer.rotation !== 0) {
    const radians = (layer.rotation * Math.PI) / 180;
    parts.push(`rotate=${radians.toFixed(6)}:c=none:ow=rotw(${radians.toFixed(6)}):oh=roth(${radians.toFixed(6)})`);
  }
  if (layer.opacity < 1) parts.push(`colorchannelmixer=aa=${layer.opacity}`);
  if (layer.animation !== "none") {
    const fade = layerFadeSeconds(layer);
    parts.push(`fade=t=in:st=${layer.start}:d=${fade}:alpha=1`);
    if (layer.end - fade > layer.start) {
      parts.push(`fade=t=out:st=${layer.end - fade}:d=${fade}:alpha=1`);
    }
  }
  parts.push(`setsar=1[${out}]`);
  return parts.join(",");
}

// Rounded-corner alpha mask for an rgba stream: keep the pixel's alpha inside a
// rounded rectangle of the given corner radius, feathered by 1px. Expressions
// are single-quoted so their commas survive the filtergraph parser.
function roundedMaskGeq(radius: number): string {
  const r = radius;
  const dx = `max(max(${r}-X,X-(W-1-${r})),0)`;
  const dy = `max(max(${r}-Y,Y-(H-1-${r})),0)`;
  const dist = `hypot(${dx},${dy})`;
  return (
    `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':` +
    `a='alpha(X,Y)*clip(${r}+0.5-${dist},0,1)'`
  );
}

function buildLayerTextFilter(
  layer: Extract<RenderSlideStep["layers"][number], { type: "text" }>
): string {
  const x =
    layer.align === "center"
      ? `${round(layer.x)}+(${round(layer.width)}-text_w)/2`
      : layer.align === "right"
        ? `${round(layer.x)}+${round(layer.width)}-text_w`
        : String(round(layer.x));
  const parts = [
    `drawtext=fontfile=${quoteFilterPath(toFfmpegPath(layer.fontFile))}`,
    `textfile=${quoteFilterPath(toFfmpegPath(layer.textFile))}`,
    `fontcolor=${cssColor(layer.color)}`,
    `fontsize=${layer.size}`,
    `x=${layerPositionExpr(layer, "x", x)}`,
    `y=${layerPositionExpr(layer, "y")}`,
  ];

  if (layer.lineSpacing !== undefined) parts.push(`line_spacing=${layer.lineSpacing}`);
  if (layer.letterSpacing !== undefined) parts.push(`text_shaping=1`);

  if (layer.animation !== "none") {
    parts.push(`alpha='${layerAlphaExpr(layer)}'`);
  } else if (layer.opacity < 1) {
    parts.push(`alpha='${layer.opacity}'`);
  } else {
    parts.push(`enable='between(t,${layer.start},${layer.end})'`);
  }

  return parts.join(":");
}

function layerPositionExpr(
  layer: RenderSlideStep["layers"][number],
  axis: "x" | "y",
  baseExpr?: string
): string {
  const base = baseExpr ?? String(round(axis === "x" ? layer.x : layer.y));
  const offset = 90;
  const p = layerProgressExpr(layer);

  if (axis === "x" && layer.animation === "slide_left") return `'(${base})+${offset}*(1-${p})'`;
  if (axis === "x" && layer.animation === "slide_right") return `'(${base})-${offset}*(1-${p})'`;
  if (axis === "y" && layer.animation === "slide_up") return `'(${base})+${offset}*(1-${p})'`;
  if (axis === "y" && layer.animation === "slide_down") return `'(${base})-${offset}*(1-${p})'`;

  return baseExpr ? base : String(round(axis === "x" ? layer.x : layer.y));
}

function layerProgressExpr(layer: RenderSlideStep["layers"][number]): string {
  const d = Math.min(0.8, Math.max(0.1, layer.end - layer.start));
  const t = `min(max((t-${layer.start})/${d},0),1)`;
  return `(${t}*${t}*(3-2*${t}))`;
}

function layerAlphaExpr(layer: RenderSlideStep["layers"][number]): string {
  const fade = layerFadeSeconds(layer);
  return (
    `if(lt(t,${layer.start}),0,` +
    `if(lt(t,${layer.start + fade}),${layer.opacity}*(t-${layer.start})/${fade},` +
    `if(lt(t,${layer.end - fade}),${layer.opacity},` +
    `if(lt(t,${layer.end}),${layer.opacity}*(${layer.end}-t)/${fade},0))))`
  );
}

function layerFadeSeconds(layer: RenderSlideStep["layers"][number]): number {
  return Math.min(0.5, Math.max(0.05, (layer.end - layer.start) / 2));
}

function round(n: number): number {
  return Math.round(n);
}
