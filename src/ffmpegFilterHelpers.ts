export function buildTechnicalColorFilter(c?: {
  brightness: number;
  saturation: number;
  redBalance: number;
  blueBalance: number;
}): string | undefined {
  if (!c) return undefined;
  return `eq=brightness=${c.brightness}:saturation=${c.saturation},colorbalance=rs=${c.redBalance}:bs=${c.blueBalance}`;
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
import type { RenderSlideStep } from "./types";
