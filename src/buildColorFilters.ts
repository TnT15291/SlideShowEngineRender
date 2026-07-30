import { toFfmpegPath } from "./fileUtils";
import { quoteFilterPath } from "./ffmpegFilterHelpers";
import type { ColorGrade, DuotoneGrade, RenderSlideStep } from "./types";

/** "#rrggbb" -> 0..255 components (validateTimeline already rejects anything else). */
function parseHexColor(hex: string): { r: number; g: number; b: number } {
  const n = parseInt(hex.slice(1), 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/** BT.601 full-range RGB -> YCbCr, to build geq expressions that stay in the
 *  filter chain's native yuv space (matches the geq style already used by
 *  circleFocusFilter/darkFeatherFilter instead of round-tripping through rgb). */
function hexToYCbCr(hex: string): { y: number; cb: number; cr: number } {
  const { r, g, b } = parseHexColor(hex);
  return {
    y: 0.299 * r + 0.587 * g + 0.114 * b,
    cb: 128 - 0.168736 * r - 0.331264 * g + 0.5 * b,
    cr: 128 + 0.5 * r - 0.418688 * g - 0.081312 * b,
  };
}

/**
 * Gradient-map the graded image between two flat colors by luma: dark pixels
 * take `shadow`, bright pixels take `highlight`, everything between is a
 * linear blend. A stylized, poster-flat look — distinct from `temperature`
 * (which shifts a photo's own colors) or `curves` (which reshapes tone but
 * keeps hue). geq re-samples `lum(X,Y)` of the CURRENT frame (already graded
 * by whatever ran before this in the chain) as the 0..255 blend position.
 */
function duotoneFilter(g: DuotoneGrade): string {
  const sh = hexToYCbCr(g.shadow);
  const hi = hexToYCbCr(g.highlight);
  const mix = (a: number, b: number) => `(${a.toFixed(3)}+(${(b - a).toFixed(3)})*(lum(X,Y)/255))`;
  return (
    `format=yuv444p,geq=` +
    `lum='${mix(sh.y, hi.y)}':` +
    `cb='${mix(sh.cb, hi.cb)}':` +
    `cr='${mix(sh.cr, hi.cr)}'`
  );
}

/**
 * Halation: the warm/red halo real film stock scatters around bright light
 * sources (windows, fairy lights, backlit hair) — the defining texture of the
 * 2026 "film emulation" wedding-video look. Distinct from `glow`: thresholded
 * to highlights only (glow blooms every tone) and tinted warm rather than
 * neutral, via the same format=gbrp/split/screen-blend shape `glow` uses.
 */
function halationFilter(strength: number): string {
  const level = 178; // ~0.7 * 255 — isolates bright highlights, not midtones
  const opacity = (0.5 * Math.min(strength, 1)).toFixed(3);
  return (
    `format=gbrp,split[hlA][hlB];` +
    `[hlB]lutrgb=r='if(gte(val,${level}),val,0)':g='if(gte(val,${level}),val,0)':b='if(gte(val,${level}),val,0)',` +
    `gblur=sigma=22,colorbalance=rm=0.32:gm=0.04:bm=-0.22:rh=0.18[hlGlow];` +
    `[hlA][hlGlow]blend=all_mode=screen:all_opacity=${opacity},format=yuv420p`
  );
}

/**
 * Retro camcorder texture: chroma smear (rgbashift, the same primitive
 * `prism_split` uses, at a much subtler offset), scanline darkening (geq luma
 * multiplier on alternating line pairs) and a slight tracking-style vertical
 * jitter (pad+crop with a sine offset, the same technique `dark_feather` uses
 * for its drift). Self-contained — reads convincingly VHS with `grain: 0`.
 */
function vhsFilter(strength: number): string {
  const s = Math.min(Math.max(strength, 0), 1);
  const scan = (0.16 * s).toFixed(3);
  const chroma = Math.max(1, Math.round(3 * s));
  const jitter = (2.2 * s).toFixed(3);
  const noiseAmt = Math.max(1, Math.round(4 * s));
  const pad = Math.max(2, Math.ceil(2.2 * s) + 1);
  return (
    `pad=iw+${pad * 2}:ih:${pad}:0:color=black,` +
    `crop=iw-${pad * 2}:ih:'${pad}+${jitter}*sin(2*PI*t*13)':0,` +
    `rgbashift=rh=${chroma}:bh=${-chroma}:edge=smear,` +
    `format=yuv444p,geq=lum='lum(X,Y)*(1-${scan}*mod(floor(Y/2),2))':cb='cb(X,Y)':cr='cr(X,Y)',` +
    `eq=contrast=0.93:saturation=0.82,` +
    `noise=alls=${noiseAmt}:allf=t+u,format=yuv420p`
  );
}

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

  if (g.halation !== undefined && g.halation > 0) parts.push(halationFilter(g.halation));

  // Duotone remaps color from the luma this pass has produced so far, so it
  // reads the eq/curves/lut/temperature/glow/halation adjustments above it;
  // it runs before vignette/sharpen/blur/flicker/vhs/grain so those texture
  // passes still land on top of the final look, same as every other field.
  if (g.duotone) parts.push(duotoneFilter(g.duotone));

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

  if (g.vhs !== undefined && g.vhs > 0) parts.push(vhsFilter(g.vhs));

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
