import { toFfmpegPath } from "./fileUtils";
import { quoteFilterPath } from "./ffmpegFilterUtils";
import type { ColorGrade, RenderSlideStep } from "./types";

export function buildColorFilter(
  g: RenderSlideStep["color"]
): string | undefined {
  if (!g) return undefined;
  const parts: string[] = [];

  const eq: string[] = [];
  if (g.brightness !== undefined && g.brightness !== 0)
    eq.push(`brightness=${g.brightness}`);
  if (g.contrast !== undefined && g.contrast !== 1)
    eq.push(`contrast=${g.contrast}`);
  if (g.saturation !== undefined && g.saturation !== 1)
    eq.push(`saturation=${g.saturation}`);
  if (g.gamma !== undefined && g.gamma !== 1) eq.push(`gamma=${g.gamma}`);
  if (eq.length > 0) parts.push(`eq=${eq.join(":")}`);

  if (g.curves) parts.push(`curves=preset=${g.curves}`);
  if (g.lut) parts.push(`lut3d=${quoteFilterPath(toFfmpegPath(g.lut))}`);

  if (g.temperature !== undefined && g.temperature !== 6500)
    parts.push(`colortemperature=temperature=${Math.round(g.temperature)}`);

  if (g.glow !== undefined && g.glow > 0) {
    // Dreamy bloom: screen-blend a blurred copy over the image. Bright areas
    // halate softly (the "pro-mist" wedding look); opacity = glow strength.
    // Screen math is only correct in planar RGB (in YUV the chroma planes
    // shift toward magenta), so blend in gbrp and convert straight back.
    const opacity = Math.min(g.glow, 1).toFixed(3);
    parts.push(
      `format=gbrp,split[glwa][glwb];[glwb]gblur=sigma=25[glwc];` +
        `[glwa][glwc]blend=all_mode=screen:all_opacity=${opacity},format=yuv420p`
    );
  }

  if (g.vignette) {
    const angle = typeof g.vignette === "number" ? g.vignette : Math.PI / 5;
    parts.push(`vignette=a=${angle.toFixed(4)}`);
  }

  if (g.sharpen !== undefined && g.sharpen > 0)
    parts.push(`unsharp=5:5:${Math.min(g.sharpen, 2)}`);
  if (g.blur !== undefined && g.blur > 0) parts.push(`gblur=sigma=${g.blur}`);

  // Analog exposure flicker (Super-8 pulse): a slow sine wobble plus a small
  // per-frame random jitter on luma. eval=frame re-evaluates the expression
  // every frame; amplitude maps flicker 0..1 to a subtle 0..0.08 brightness
  // swing so even full strength reads as vintage, not strobing.
  if (g.flicker !== undefined && g.flicker > 0) {
    const amp = (0.08 * Math.min(g.flicker, 1)).toFixed(4);
    parts.push(
      `eq=brightness='${amp}*(0.6*sin(2*PI*t*9)+0.4*(random(1)-0.5))':eval=frame`
    );
  }

  // Grain last so it sits on top of the whole look, like real film stock.
  if (g.grain !== undefined && g.grain > 0)
    parts.push(`noise=alls=${Math.min(Math.round(g.grain), 30)}:allf=t+u`);

  return parts.length > 0 ? parts.join(",") : undefined;
}

/**
 * Cinematic letterbox: two black bars that mask the 16:9 frame down to a wider
 * aspect (default 2.39:1). Drawn after the grade and before the captions, so
 * bottom captions sit inside the bar like film subtitles. Applied per slide —
 * every slide shares the merged global grade, so bars stay put across xfades.
 */
export function buildLetterboxFilter(
  g: RenderSlideStep["color"],
  w: number,
  h: number
): string | undefined {
  if (!g || !g.letterbox) return undefined;
  const aspect = typeof g.letterbox === "number" ? g.letterbox : 2.39;
  const barH = Math.round((h - w / aspect) / 2);
  if (barH <= 0) return undefined;
  return (
    `drawbox=x=0:y=0:w=${w}:h=${barH}:color=black:t=fill,` +
    `drawbox=x=0:y=${h - barH}:w=${w}:h=${barH}:color=black:t=fill`
  );
}
