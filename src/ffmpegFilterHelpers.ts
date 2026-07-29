import type { RenderSlideStep } from "./types";

export function buildTechnicalColorFilter(c?: {
  brightness: number;
  saturation: number;
  redBalance: number;
  blueBalance: number;
}): string | undefined {
  if (!c) return undefined;
  return `eq=brightness=${c.brightness}:saturation=${c.saturation},colorbalance=rs=${c.redBalance}:bs=${c.blueBalance}`;
}

/**
 * A recipe look's authored grade on one image layer (types.ts LayerGrade).
 *
 * Same `eq` filter the technical correction uses, deliberately emitted as its own pass:
 * the correction runs first and this runs on its result, so a look's mood never has to be
 * folded into -- and bounded by -- an automatic album correction.
 */
export function buildLayerGradeFilter(g?: {
  saturation?: number;
  contrast?: number;
  brightness?: number;
}): string | undefined {
  if (!g) return undefined;
  const terms: string[] = [];
  if (g.brightness != null) terms.push(`brightness=${g.brightness}`);
  if (g.contrast != null) terms.push(`contrast=${g.contrast}`);
  if (g.saturation != null) terms.push(`saturation=${g.saturation}`);
  return terms.length ? `eq=${terms.join(":")}` : undefined;
}

/** Clamp a normalized focal point and keep FFmpeg expressions compact. */
export function clamp01(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 0.5;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

export function canvasBackground(step: RenderSlideStep): string {
  const raw = step.rendererParams?.background;
  const match = typeof raw === "string" ? /^#?([0-9a-fA-F]{6})$/.exec(raw.trim()) : null;
  return match ? `0x${match[1]}` : "black";
}

/** "#rrggbb" -> "0xrrggbb" (FFmpeg syntax); named colors pass through. */
export function cssColor(color: string): string {
  return color.startsWith("#") ? `0x${color.slice(1)}` : color;
}

/** Quote a path for use inside an FFmpeg filtergraph, including Windows drives. */
export function quoteFilterPath(path: string): string {
  return `'${path.replace(/:/g, "\\:")}'`;
}
