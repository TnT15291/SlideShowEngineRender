import { toFfmpegPath } from "./fileUtils";
import { cssColor, quoteFilterPath } from "./ffmpegFilterUtils";
import type { CompiledCaption } from "./types";

// Font size per caption role, as a fraction of frame height.
const ROLE_SIZE_DIVISOR: Record<CompiledCaption["role"], number> = {
  title: 13,
  subtitle: 26,
  caption: 22,
};

/**
 * One drawtext filter for one caption. Text is read from a UTF-8 text file so
 * arbitrary content (Vietnamese, punctuation) needs no escaping. Supports role
 * sizing, custom font/size/color, outline, shadow, and fade / slide-up entrance.
 * Times are slide-local seconds (the slide video starts at t=0).
 */
export function buildCaptionFilter(c: CompiledCaption, frameHeight: number): string {
  const fontSize = c.size ?? Math.round(frameHeight / ROLE_SIZE_DIVISOR[c.role]);
  const start = c.start;
  const end = c.start + c.duration;
  const fade = Math.min(0.5, c.duration / 2);

  const baseY =
    c.position === "center"
      ? "(h-text_h)/2"
      : c.position === "top_center"
        ? "h/12"
        : "h-text_h-h/12";

  // FFmpeg filtergraph quoting: a Windows path needs both single quotes and a
  // backslash-escaped drive colon (fontfile='C\:/...').
  const parts = [
    `drawtext=fontfile=${quoteFilterPath(toFfmpegPath(c.fontFile))}`,
    `textfile=${quoteFilterPath(toFfmpegPath(c.textFile))}`,
    `fontcolor=${cssColor(c.color)}`,
    `fontsize=${fontSize}`,
    "x=(w-text_w)/2",
  ];

  if (c.animation === "none") {
    parts.push(`y=${baseY}`, `enable='between(t,${start},${end})'`);
  } else {
    const alpha =
      `if(lt(t,${start}),0,` +
      `if(lt(t,${start + fade}),(t-${start})/${fade},` +
      `if(lt(t,${end - fade}),1,` +
      `if(lt(t,${end}),(${end}-t)/${fade},0))))`;
    parts.push(`alpha='${alpha}'`);

    if (c.animation === "slide_up") {
      const rise = 0.6;
      const yExpr = `${baseY}+(h/20)*(1-min((t-${start})/${rise},1))`;
      parts.push(`y='${yExpr}'`);
    } else {
      parts.push(`y=${baseY}`);
    }
  }

  if (c.shadow) {
    parts.push("shadowcolor=black@0.6", "shadowx=2", "shadowy=2");
  }
  if (c.outline && c.outline.width > 0) {
    parts.push(
      `bordercolor=${cssColor(c.outline.color)}`,
      `borderw=${c.outline.width}`
    );
  }

  return parts.join(":");
}
