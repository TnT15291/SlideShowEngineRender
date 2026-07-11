import { toFfmpegPath } from "./fileUtils";
import { audioEncodeArgs, videoEncodeArgs } from "./quality";
import type { QualityProfile } from "./quality";
import { XFADE_BY_TRANSITION } from "./types";
import type {
  AudioAutomationPoint,
  CompiledCaption,
  CompiledOverlay,
  EffectPreset,
  MotionEasing,
  MusicTrack,
  OverlayPosition,
  RenderSlideStep,
  VoiceoverConfig,
} from "./types";

// Pure functions that build ffmpeg argument arrays (for child_process.spawn).
// No AI, no free-text, no shell strings — only preset-driven arguments.

// All per-slide effect presets are implemented. Crossfade transitions (which
// span two slides) and captions are handled elsewhere / in a later milestone.
const IMPLEMENTED_EFFECTS: ReadonlySet<EffectPreset> = new Set([
  "still",
  "slow_zoom_in",
  "slow_zoom_out",
  "pan_left",
  "pan_right",
  "pan_up",
  "pan_down",
  "kenburns_tl",
  "kenburns_tr",
  "kenburns_bl",
  "kenburns_br",
  "portrait_blur_background",
  "polaroid",
  "circle_focus",
  "memory_wall",
  "dark_feather",
  "film_roll_up",
  "film_roll_left",
  "film_roll_right",
  "video_background",
  "collage_grid",
  "double_exposure",
  "layer_scene",
]);

export function isImplementedEffect(effect: EffectPreset): boolean {
  return IMPLEMENTED_EFFECTS.has(effect);
}

// --- Motion tuning (see docs/ENGINE-ARCHITECTURE.md) ---
const ZOOM_MAX = 1.12; // slow_zoom_in ends here; slow_zoom_out starts here
const PAN_ZOOM = 1.12; // pans hold this zoom to leave slack to travel across
const BG_BLUR_SIGMA = 20; // portrait background blur strength
const DECOR_FONT = "C:/Windows/Fonts/arial.ttf";

/**
 * A single image -> a fixed-length slide video. The surrounding encode args are
 * identical for every preset; only the video filtergraph (-vf) changes, so the
 * outputs stay stream-compatible for a fast concat later.
 */
export function buildSlideArgs(step: RenderSlideStep): string[] {
  if (step.effect === "layer_scene") return buildLayerSceneArgs(step);
  if (step.effect === "video_background") return buildVideoBackgroundArgs(step);
  if (step.effect === "collage_grid") return buildCollageGridArgs(step);
  if (step.effect === "double_exposure") return buildDoubleExposureArgs(step);
  if (step.effect === "mask_reveal") return buildMaskRevealArgs(step);
  if (step.effect === "memory_wall") return buildMemoryWallArgs(step);
  if (isFilmRollEffect(step.effect)) return buildFilmRollArgs(step);

  const vf = buildEffectFilter(step);

  return [
    "-y",
    "-loop",
    "1",
    "-i",
    step.input,
    "-t",
    String(step.duration),
    "-vf",
    vf,
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

function buildLayerSceneArgs(step: RenderSlideStep): string[] {
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

  // Base fill at inner size: continuous Ken-Burns motion, or a static fit.
  const base =
    layer.motion && layer.motion !== "none"
      ? layerMotionFilter(layer.motion, innerW, innerH, fps, frames)
      : layer.fit === "stretch"
        ? `scale=${innerW}:${innerH}`
        : layer.fit === "contain"
          ? `scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease,` +
            `pad=${innerW}:${innerH}:(ow-iw)/2:(oh-ih)/2:color=black@0`
          : `scale=${innerW}:${innerH}:force_original_aspect_ratio=increase,` +
            `crop=${innerW}:${innerH}:(iw-ow)*${clamp01(layer.focusX)}:(ih-oh)*${clamp01(layer.focusY)}`;

  const parts = [base];
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

// Continuous Ken-Burns on an image layer: a 2x-oversampled cover fill driven by
// zoompan over the whole slide, reusing the same eased zoom/pan exprs as the
// whole-slide effects so layer motion matches the house style.
function layerMotionFilter(
  motion: string,
  w: number,
  h: number,
  fps: number,
  frames: number
): string {
  const base =
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,crop=${w * 2}:${h * 2}`;
  let z = String(PAN_ZOOM);
  let x = centerX();
  let y = centerY();
  switch (motion) {
    case "zoom_in": z = zoomInExpr(frames); break;
    case "zoom_out": z = zoomOutExpr(frames); break;
    case "pan_left": x = panXExpr(frames, "left"); break;
    case "pan_right": x = panXExpr(frames, "right"); break;
    case "pan_up": y = panYExpr(frames, "up"); break;
    case "pan_down": y = panYExpr(frames, "down"); break;
  }
  return `${base},zoompan=z=${z}:x=${x}:y=${y}:d=${frames}:s=${w}x${h}:fps=${fps}`;
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

// Cover-crop focal point: 0..1, default 0.5 (center). Rounded to 3 decimals so
// the ffmpeg crop expression stays short.
function clamp01(n: number | undefined): number {
  if (n === undefined || Number.isNaN(n)) return 0.5;
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}

function buildVideoBackgroundArgs(step: RenderSlideStep): string[] {
  return [
    "-y",
    "-stream_loop",
    "-1",
    "-i",
    step.input,
    "-t",
    String(step.duration),
    "-vf",
    buildVideoBackgroundFilter(step),
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

function buildCollageGridArgs(step: RenderSlideStep): string[] {
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

function buildDoubleExposureArgs(step: RenderSlideStep): string[] {
  const inputs: string[] = [];
  for (const input of step.inputs.slice(0, 2)) {
    inputs.push("-loop", "1", "-t", String(step.duration), "-i", input);
  }

  return [
    "-y",
    ...inputs,
    "-filter_complex",
    buildDoubleExposureFilter(step),
    "-map",
    "[vout]",
    "-t",
    String(step.duration),
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

function buildMaskRevealArgs(step: RenderSlideStep): string[] {
  if (!step.mask) {
    throw new Error(`slide ${step.slideId}: mask_reveal step is missing mask`);
  }
  return [
    "-y",
    "-loop",
    "1",
    "-t",
    String(step.duration),
    "-i",
    step.input,
    "-i",
    step.mask,
    "-filter_complex",
    buildMaskRevealFilter(step),
    "-map",
    "[vout]",
    "-t",
    String(step.duration),
    ...videoEncodeArgs(step.quality, step.fps),
    step.output,
  ];
}

/**
 * mask_reveal: the photo appears through the luma of a grayscale mask video
 * (white = photo, black = hidden) over a black background. The mask plays
 * once; tpad clones its final frame so a 4s reveal simply holds fully-open
 * for the rest of a longer slide. Grade/letterbox/captions run after the
 * composite, same as the other filter_complex effects.
 */
function buildMaskRevealFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const filters: string[] = [];

  filters.push(`color=c=black:s=${w}x${h}:r=${fps}:d=${duration}[mrbg]`);
  filters.push(
    `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},setsar=1,format=rgba[mrph]`
  );
  filters.push(
    `[1:v]fps=${fps},scale=${w}:${h},format=gray,setsar=1,` +
      `tpad=stop=-1:stop_mode=clone[mrmk]`
  );
  filters.push(`[mrph][mrmk]alphamerge[mrrev]`);
  filters.push(`[mrbg][mrrev]overlay=0:0[mr0]`);

  let current = "mr0";
  const post = [
    buildColorFilter(step.color),
    buildLetterboxFilter(step.color, w, h),
    ...step.captions.map((c) => buildCaptionFilter(c, h)),
  ].filter((f): f is string => Boolean(f));
  post.forEach((filter, i) => {
    const next = `mrpost${i}`;
    filters.push(`[${current}]${filter}[${next}]`);
    current = next;
  });
  filters.push(
    `[${current}]trim=duration=${duration},fps=${fps},format=yuv420p[vout]`
  );

  return filters.join(";");
}

function buildFilmRollArgs(step: RenderSlideStep): string[] {
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
export function buildEffectFilter(step: RenderSlideStep): string {
  const chain = [buildFramingFilter(step)];

  // Grade the image first so captions stay at their authored colors.
  const grade = buildColorFilter(step.color);
  if (grade) chain.push(grade);

  // Cinematic bars go under the captions so text can sit inside them.
  const bars = buildLetterboxFilter(step.color, step.width, step.height);
  if (bars) chain.push(bars);

  if (step.effect === "dark_feather") {
    // Timeline lockup replaces the generic centered captions: a thin rule in
    // the side margins (reads as passing behind the photo) plus role-anchored
    // text — title/year above the rule, small caption below it.
    chain.push(lockupLineFilter(step.width, step.height, false));
    chain.push(...lockupTextFilters(step));
  } else {
    // Captions are baked into the slide so they survive concat/xfade unchanged.
    for (const c of step.captions) chain.push(buildCaptionFilter(c, step.height));
  }

  return chain.join(",");
}

/**
 * Color pipeline for one slide: eq (brightness/contrast/saturation/gamma) ->
 * curves preset -> 3D LUT -> temperature -> glow -> vignette -> sharpen/
 * soft-blur -> grain. Returns undefined when the grade is empty so ungraded
 * slides skip the pass entirely.
 *
 * The glow segment contains labeled sub-chains (split/blend), so the returned
 * string may hold `;` — it still forms a valid 1-in/1-out graph fragment for
 * every call site (-vf chains and [in]...[out] filter_complex slots alike).
 */
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

function buildFramingFilter(step: RenderSlideStep): string {
  const { effect, width: w, height: h, fps, duration } = step;
  const frames = Math.max(1, Math.round(duration * fps));
  const tail = `setsar=1,fps=${fps},format=yuv420p`;

  switch (effect) {
    case "portrait_blur_background":
      return portraitBlurFilter(w, h, fps);

    case "polaroid":
      return polaroidFilter(w, h, fps, duration);

    case "circle_focus":
      return circleFocusFilter(w, h, fps);

    case "dark_feather":
      return darkFeatherFilter(step);

    case "slow_zoom_in":
      return zoompanFilter(w, h, fps, frames, zoomInExpr(frames, step.easing), centerX(), centerY(), tail);

    case "slow_zoom_out":
      return zoompanFilter(w, h, fps, frames, zoomOutExpr(frames, step.easing), centerX(), centerY(), tail);

    case "pan_left":
      return zoompanFilter(w, h, fps, frames, String(PAN_ZOOM), panXExpr(frames, "left", step.easing), centerY(), tail);
    case "pan_right":
      return zoompanFilter(w, h, fps, frames, String(PAN_ZOOM), panXExpr(frames, "right", step.easing), centerY(), tail);
    case "pan_up":
      return zoompanFilter(w, h, fps, frames, String(PAN_ZOOM), centerX(), panYExpr(frames, "up", step.easing), tail);
    case "pan_down":
      return zoompanFilter(w, h, fps, frames, String(PAN_ZOOM), centerX(), panYExpr(frames, "down", step.easing), tail);

    case "kenburns_tl":
      return zoompanFilter(w, h, fps, frames, zoomInExpr(frames, step.easing), kenburnsExpr(frames, "iw", 0, step.easing), kenburnsExpr(frames, "ih", 0, step.easing), tail);
    case "kenburns_tr":
      return zoompanFilter(w, h, fps, frames, zoomInExpr(frames, step.easing), kenburnsExpr(frames, "iw", 1, step.easing), kenburnsExpr(frames, "ih", 0, step.easing), tail);
    case "kenburns_bl":
      return zoompanFilter(w, h, fps, frames, zoomInExpr(frames, step.easing), kenburnsExpr(frames, "iw", 0, step.easing), kenburnsExpr(frames, "ih", 1, step.easing), tail);
    case "kenburns_br":
      return zoompanFilter(w, h, fps, frames, zoomInExpr(frames, step.easing), kenburnsExpr(frames, "iw", 1, step.easing), kenburnsExpr(frames, "ih", 1, step.easing), tail);

    case "still":
    default:
      // Cover-fill to 16:9, centered (docs: "scale/crop về 16:9"). Portrait
      // images are rerouted to portrait_blur_background upstream, so cropping
      // here only ever trims a centered landscape frame.
      return (
        `scale=${w}:${h}:force_original_aspect_ratio=increase,` +
        `crop=${w}:${h},${tail}`
      );
  }
}

// zoompan operates on a 2x-oversampled cover-filled canvas: the extra pixels
// keep slow zooms/pans smooth and hide integer-crop jitter.
function zoompanFilter(
  w: number,
  h: number,
  fps: number,
  frames: number,
  z: string,
  x: string,
  y: string,
  tail: string
): string {
  const base =
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,` +
    `crop=${w * 2}:${h * 2}`;
  const zp =
    `zoompan=z=${z}:x=${x}:y=${y}:d=${frames}:s=${w}x${h}:fps=${fps}`;
  return `${base},${zp},${tail}`;
}

// Motion progress 0..1 driven by the output frame number `on` (0..frames-1) so
// it is deterministic and fps-independent, not accumulator-based. The default
// smoothstep easing (t²(3-2t)) gives the gentle start/stop drift of pro
// slideshow motion; linear motion reads as mechanical. Optional variants
// (slide `easing`) recolor that motion without touching its travel range:
//   gentle — smootherstep t³(6t²-15t+10): even softer start/stop, for calm beats
//   snap   — ease-out quart 1-(1-t)⁴: launches fast, settles decisively
//   bounce — ease-out-back (s=1.5) NORMALIZED so its overshoot peak is exactly
//            1.0: motion runs to full range then relaxes back ~7%. Keeping the
//            peak at 1.0 means every zoom clamp and pan-slack expression stays
//            valid (zoompan would silently flatten a >1 overshoot at the edge).
function easedProgress(frames: number, easing?: MotionEasing): string {
  const t = `(on/${frames - 1})`;
  switch (easing) {
    case "gentle":
      return `(${t}*${t}*${t}*(${t}*(${t}*6-15)+10))`;
    case "snap":
      return `(1-pow(1-${t},4))`;
    case "bounce":
      // f(t)=1+2.5(t-1)³+1.5(t-1)², peak 1.08 at t=0.6 -> /1.08 pins peak to 1.
      return `((1+2.5*pow(${t}-1,3)+1.5*pow(${t}-1,2))/1.08)`;
    default:
      return `(${t}*${t}*(3-2*${t}))`;
  }
}

function zoomInExpr(frames: number, easing?: MotionEasing): string {
  const p = easedProgress(frames, easing);
  return `'min(1.0+${(ZOOM_MAX - 1).toFixed(4)}*${p},${ZOOM_MAX})'`;
}
function zoomOutExpr(frames: number, easing?: MotionEasing): string {
  const p = easedProgress(frames, easing);
  return `'max(${ZOOM_MAX}-${(ZOOM_MAX - 1).toFixed(4)}*${p},1.0)'`;
}

// Center the crop window on both axes (used when that axis isn't panning).
function centerX(): string {
  return `'iw/2-(iw/zoom/2)'`;
}
function centerY(): string {
  return `'ih/2-(ih/zoom/2)'`;
}

// Pan travels the full horizontal/vertical slack available at PAN_ZOOM.
function panXExpr(frames: number, dir: "left" | "right", easing?: MotionEasing): string {
  const e = easedProgress(frames, easing);
  const p = dir === "right" ? e : `(1-${e})`;
  return `'(iw-iw/zoom)*${p}'`;
}
function panYExpr(frames: number, dir: "up" | "down", easing?: MotionEasing): string {
  const e = easedProgress(frames, easing);
  const p = dir === "down" ? e : `(1-${e})`;
  return `'(ih-ih/zoom)*${p}'`;
}

// Ken Burns: zoom in while the crop window drifts from center toward a corner
// (target 0 or 1 per axis). At zoom=1 there is no slack, so the drift fades in
// naturally with the zoom.
function kenburnsExpr(
  frames: number,
  dim: "iw" | "ih",
  target: 0 | 1,
  easing?: MotionEasing
): string {
  const p = easedProgress(frames, easing);
  return `'(${dim}-${dim}/zoom)*(0.5+(${target}-0.5)*${p})'`;
}

// Portrait: blurred, cover-filled copy behind the untouched image fit inside
// the frame, so no person is ever cropped (ENGINE-ARCHITECTURE "Xử lý ảnh dọc").
function portraitBlurFilter(w: number, h: number, fps: number): string {
  return [
    "split[bg][fg]",
    `[bg]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},gblur=sigma=${BG_BLUR_SIGMA},setsar=1[bgb]`,
    `[fg]scale=${w}:${h}:force_original_aspect_ratio=decrease,setsar=1[fgf]`,
    `[bgb][fgf]overlay=(W-w)/2:(H-h)/2,fps=${fps},format=yuv420p`,
  ].join(";");
}

// Polaroid: the photo fit inside a white instant-photo card (thick bottom
// border), tilted a few degrees, floating gently over a blurred darkened copy
// of itself. The photo is FIT (never cropped) — leftover space reads as white
// matte, so faces are always safe.
const POLAROID_TILT = -0.044; // radians ≈ -2.5°; fillcolor=none keeps corners transparent

function polaroidFilter(w: number, h: number, fps: number, duration: number): string {
  const cardH = Math.round(h * 0.72);
  const cardW = Math.round(cardH * 0.82);
  const border = Math.round(cardW * 0.045);
  const bottom = Math.round(cardH * 0.16);
  const innerW = cardW - border * 2;
  const innerH = cardH - border - bottom;

  // Gentle eased float: starts 8px low, settles 8px high over the slide.
  const t = `min(t/${duration.toFixed(4)},1)`;
  const drift = `(${t}*${t}*(3-2*${t}))`;
  const yExpr = `'(H-h)/2+8-16*${drift}'`;

  return [
    "split[plbg][plfg]",
    `[plbg]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},gblur=sigma=${BG_BLUR_SIGMA},` +
      `eq=brightness=-0.06:contrast=0.92:saturation=0.85,setsar=1[plbgb]`,
    `[plfg]scale=${innerW}:${innerH}:force_original_aspect_ratio=decrease,` +
      `pad=${innerW}:${innerH}:(ow-iw)/2:(oh-ih)/2:color=white,` +
      `pad=${cardW}:${cardH}:${border}:${border}:color=white,setsar=1,` +
      `format=rgba,rotate=${POLAROID_TILT}:c=none:` +
      `ow=rotw(${POLAROID_TILT}):oh=roth(${POLAROID_TILT})[plcard]`,
    `[plbgb][plcard]overlay=x=(W-w)/2:y=${yExpr},fps=${fps},format=yuv420p`,
  ].join(";");
}

// Circle focus: center-square crop of the photo inside a circular mask with a
// white ring, over a blurred copy of itself. geq paints the ring zone white and
// carves the circular alpha (2px feathered edge); yuva444p keeps the chroma
// planes full-res so the mask edge stays clean.
function circleFocusFilter(w: number, h: number, fps: number): string {
  const diameter = 2 * Math.round((Math.min(w, h) * 0.62) / 2);
  const ring = Math.max(6, Math.round(diameter * 0.035));
  const canvas = diameter + ring * 2;
  const dist = "hypot(X-W/2,Y-H/2)";
  const inRing = `gt(${dist},W/2-${ring})`;

  return [
    "split[cfbg][cffg]",
    `[cfbg]scale=${w}:${h}:force_original_aspect_ratio=increase,` +
      `crop=${w}:${h},gblur=sigma=${BG_BLUR_SIGMA},` +
      `eq=brightness=-0.06:contrast=0.92:saturation=0.85,setsar=1[cfbgb]`,
    `[cffg]crop=w='min(iw,ih)':h='min(iw,ih)',scale=${diameter}:${diameter},` +
      `pad=${canvas}:${canvas}:${ring}:${ring}:color=white,setsar=1,` +
      `format=yuva444p,` +
      `geq=lum='if(${inRing},235,lum(X,Y))':` +
      `cb='if(${inRing},128,cb(X,Y))':` +
      `cr='if(${inRing},128,cr(X,Y))':` +
      `a='255*clip((W/2-${dist})/2,0,1)'[cfdot]`,
    `[cfbgb][cfdot]overlay=(W-w)/2:(H-h)/2,fps=${fps},format=yuv420p`,
  ].join(";");
}

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
function lockupLineFilter(w: number, h: number, full: boolean): string {
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
function lockupTextFilters(step: RenderSlideStep): string[] {
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
function darkFeatherFilter(step: RenderSlideStep): string {
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
  if (!slot.film) {
    const b = Math.round(ih * 0.05);
    outerW = iw + b * 2;
    outerH = ih + b * 2;
    parts.push(`pad=${outerW}:${outerH}:${b}:${b}:color=white`);
  } else if (slot.ar >= 1) {
    // 35mm-style landscape negative: sprocket rails top and bottom.
    const rail = Math.round(ih * 0.16);
    const side = Math.round(ih * 0.05);
    outerW = iw + side * 2;
    outerH = ih + rail * 2;
    parts.push(`pad=${outerW}:${outerH}:${side}:${rail}:color=0x111111`);
    parts.push(sprocketHoles(outerW, outerH, rail, "horizontal"));
  } else {
    // Portrait negative: rails left and right.
    const rail = Math.round(iw * 0.16);
    const side = Math.round(iw * 0.05);
    outerW = iw + rail * 2;
    outerH = ih + side * 2;
    parts.push(`pad=${outerW}:${outerH}:${rail}:${side}:color=0x111111`);
    parts.push(sprocketHoles(outerW, outerH, rail, "vertical"));
  }
  if (slot.film) {
    parts.push(`drawbox=x=0:y=0:w=${outerW}:h=${outerH}:color=0x3a3a3a@0.7:t=2`);
  }

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
  const slots = WALL_LAYOUTS[Math.min(step.inputs.length, 5)];
  const filters: string[] = [];

  filters.push(
    `color=c=black:s=${w}x${h}:r=${fps}:d=${duration}[wbgbase]`,
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

function buildMemoryWallArgs(step: RenderSlideStep): string[] {
  const slots = WALL_LAYOUTS[Math.min(step.inputs.length, 5)];
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

function buildVideoBackgroundFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps } = step;
  const chain = [
    `scale=${w}:${h}:force_original_aspect_ratio=increase`,
    `crop=${w}:${h}`,
    `setsar=1`,
    `fps=${fps}`,
    `format=yuv420p`,
  ];

  const grade = buildColorFilter(step.color);
  if (grade) chain.push(grade);
  const bars = buildLetterboxFilter(step.color, w, h);
  if (bars) chain.push(bars);
  for (const c of step.captions) chain.push(buildCaptionFilter(c, h));

  return chain.join(",");
}

/**
 * Double exposure: the second image screen-blends over the first at partial
 * opacity (a dreamy superimposition — silhouette + texture in the classic
 * wedding-template style), then the composite gets a slow eased zoom-in.
 * Both layers are 2x-oversampled cover-fills so blend sizes always match and
 * the zoom stays smooth; gbrp keeps the screen blend from tinting (both blend
 * inputs must share one planar RGB format).
 */
function buildDoubleExposureFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const frames = Math.max(1, Math.round(duration * fps));
  const cover =
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,` +
    `crop=${w * 2}:${h * 2},setsar=1,format=gbrp`;
  const filters: string[] = [];

  filters.push(`[0:v]${cover}[dxbase]`);
  filters.push(`[1:v]${cover},eq=saturation=0.85[dxtop]`);
  filters.push(
    `[dxbase][dxtop]blend=all_mode=screen:all_opacity=0.45[dxmix]`
  );
  filters.push(
    `[dxmix]zoompan=z=${zoomInExpr(frames)}:x=${centerX()}:y=${centerY()}:` +
      `d=${frames}:s=${w}x${h}:fps=${fps},setsar=1,fps=${fps},format=yuv420p[dx0]`
  );

  const post = [
    buildColorFilter(step.color),
    buildLetterboxFilter(step.color, w, h),
    ...step.captions.map((c) => buildCaptionFilter(c, h)),
  ].filter((f): f is string => Boolean(f));
  let current = "dx0";
  post.forEach((filter, i) => {
    const next = `dx${i + 1}`;
    filters.push(`[${current}]${filter}[${next}]`);
    current = next;
  });
  filters.push(`[${current}]format=yuv420p[vout]`);

  return filters.join(";");
}

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
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = margin + col * (cellW + gap);
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
  if (step.effect === "film_roll_left" || step.effect === "film_roll_right") {
    return buildHorizontalFilmRollFilter(step, step.effect === "film_roll_left" ? "left" : "right");
  }

  const { width: w, height: h, fps, duration } = step;
  const cardW = Math.round(w * 0.52);
  const cardH = Math.round(h * 0.45);
  const sideRail = Math.round(cardW * 0.1);
  const framePadX = 18;
  const framePadY = 28;
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
      `y='H-(t/${duration.toFixed(4)})*(H+h)':shortest=1,` +
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
  const railH = Math.round(cardH * 0.12);
  const framePadX = 28;
  const framePadY = 18;
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
      ? `'W-(t/${duration.toFixed(4)})*(W+w)'`
      : `'-w+(t/${duration.toFixed(4)})*(W+w)'`;
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

  parts.push(
    `drawtext=fontfile=${quoteFilterPath(toFfmpegPath(DECOR_FONT))}:text='FUJIFILM 400':fontcolor=0xf6d36f:fontsize=22:x=${sideRail + 22}:y=${cardH - 26}`,
    `drawtext=fontfile=${quoteFilterPath(toFfmpegPath(DECOR_FONT))}:text='${String(index + 1).padStart(2, "0")}':fontcolor=0xf6d36f:fontsize=22:x=${cardW - sideRail - 54}:y=${cardH - 26}`
  );

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

  parts.push(
    `drawtext=fontfile=${quoteFilterPath(toFfmpegPath(DECOR_FONT))}:text='FUJIFILM 400':fontcolor=0xf6d36f:fontsize=20:x=24:y=${railH - 26}`,
    `drawtext=fontfile=${quoteFilterPath(toFfmpegPath(DECOR_FONT))}:text='${String(index + 1).padStart(2, "0")}':fontcolor=0xf6d36f:fontsize=20:x=${cardW - 54}:y=${cardH - railH + 8}`
  );

  return parts.join(",");
}

function isFilmRollEffect(effect: EffectPreset): boolean {
  return effect === "film_roll_up" || effect === "film_roll_left" || effect === "film_roll_right";
}

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
function buildCaptionFilter(c: CompiledCaption, frameHeight: number): string {
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

  // ffmpeg filtergraph quoting (verified against this build): a Windows path
  // needs BOTH single quotes AND a backslash-escaped drive colon
  // (fontfile='C\:/...'); value expressions only need single quotes to protect
  // their commas. Single-quoting alone (unescaped colon) fails.
  const parts = [
    `drawtext=fontfile=${quoteFilterPath(toFfmpegPath(c.fontFile))}`,
    `textfile=${quoteFilterPath(toFfmpegPath(c.textFile))}`,
    `fontcolor=${cssColor(c.color)}`,
    `fontsize=${fontSize}`,
    `x=(w-text_w)/2`,
  ];

  // Entrance/exit animation.
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
      // Rise ~h/20 px while fading in, then rest at baseY.
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

/** "#rrggbb" -> "0xrrggbb" (ffmpeg syntax); named colors pass through. */
function cssColor(color: string): string {
  return color.startsWith("#") ? `0x${color.slice(1)}` : color;
}

function quoteFilterPath(p: string): string {
  return `'${p.replace(/:/g, "\\:")}'`;
}

// --- Transitions (xfade) ---
// The full catalog lives in types.ts (XFADE_BY_TRANSITION); "none" renders as a
// ~1-frame fade so a mixed sequence can still be joined by a single xfade chain.

/** True if any slide (except the last) asks for a real transition into the next. */
export function hasTransitions(steps: RenderSlideStep[]): boolean {
  return steps.slice(0, -1).some((s) => s.transition.type !== "none");
}

/**
 * Chain all slide videos with `xfade`, overlapping each pair by its transition
 * duration. Because overlaps shrink the timeline, this also returns the true
 * total duration (needed to trim/fade the music correctly).
 *
 * Requires re-encode (xfade can't stream-copy). Only used when at least one
 * boundary is a real transition; pure "none" sequences take the fast concat path.
 */
export function buildXfadeArgs(
  steps: RenderSlideStep[],
  output: string,
  quality: QualityProfile
): { args: string[]; totalDuration: number } {
  const fps = steps[0].fps;
  const minDur = 1 / fps; // a "none" boundary becomes a 1-frame fade ≈ hard cut

  const inputs: string[] = [];
  for (const s of steps) inputs.push("-i", s.output);

  const filters: string[] = [];
  let prevLabel = "0";
  let acc = steps[0].duration; // running length of the combined stream

  for (let i = 0; i < steps.length - 1; i++) {
    const t = steps[i].transition;
    const type = t.type === "none" ? "fade" : XFADE_BY_TRANSITION[t.type];
    const dur = t.type === "none" ? minDur : Math.max(t.duration, minDur);
    const offset = acc - dur;
    const outLabel = i === steps.length - 2 ? "vout" : `v${i + 1}`;
    const left = i === 0 ? "[0]" : `[${prevLabel}]`;

    filters.push(
      `${left}[${i + 1}]xfade=transition=${type}:` +
        `duration=${dur.toFixed(4)}:offset=${offset.toFixed(4)}[${outLabel}]`
    );

    prevLabel = outLabel;
    acc = acc + steps[i + 1].duration - dur;
  }

  const args = [
    "-y",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    ...videoEncodeArgs(quality, fps),
    output,
  ];

  return { args, totalDuration: acc };
}

// --- Overlays (logo / watermark / frame / particle loops) ---

const OVERLAY_XY: Record<Exclude<OverlayPosition, "fullscreen">, (m: number) => string> = {
  top_left: (m) => `${m}:${m}`,
  top_right: (m) => `W-w-${m}:${m}`,
  bottom_left: (m) => `${m}:H-h-${m}`,
  bottom_right: (m) => `W-w-${m}:H-h-${m}`,
  center: () => `(W-w)/2:(H-h)/2`,
};

/**
 * Composite every overlay onto the combined (already transitioned) video in one
 * pass. Image assets hold their frame for the whole window; video assets loop.
 * "alpha" blend respects the asset's transparency; "screen" is for black-
 * background light/bokeh/particle loops. Time windows use enable=between().
 */
export function buildOverlayArgs(
  videoIn: string,
  overlays: CompiledOverlay[],
  width: number,
  height: number,
  videoDuration: number,
  fps: number,
  output: string,
  quality: QualityProfile
): string[] {
  const inputs: string[] = ["-i", videoIn];
  for (const ov of overlays) {
    if (ov.isVideo) inputs.push("-stream_loop", "-1", "-i", ov.absPath);
    else inputs.push("-loop", "1", "-i", ov.absPath);
  }

  const filters: string[] = [];
  let base = "[0:v]";

  overlays.forEach((ov, i) => {
    const inLabel = `[${i + 1}:v]`;
    const prepped = `[ov${i}]`;
    const outLabel = i === overlays.length - 1 ? "[vout]" : `[b${i}]`;
    const end = ov.end ?? videoDuration;
    const enable = `enable='between(t,${ov.start},${end})'`;

    // Normalize the asset: trim/hold to video length, size it, apply opacity.
    const isBlendMode = ov.blend === "screen" || ov.blend === "add";
    const prep: string[] = [`trim=duration=${videoDuration}`, "setpts=PTS-STARTPTS"];
    if (ov.position === "fullscreen" || isBlendMode) {
      prep.push(`scale=${width}:${height}`);
    } else if (ov.scale !== undefined) {
      prep.push(`scale=${Math.round(width * ov.scale)}:-1`);
    }

    if (isBlendMode) {
      // blend needs both inputs in the SAME planar RGB format — mixing rgba
      // with a yuv base tints the whole frame. Opacity rides on the blend.
      // "screen" is the soft light-leak/bokeh composite; "add" is the same
      // idea but hotter (sums channels, clips sooner — use lower opacity).
      const mode = ov.blend === "add" ? "addition" : "screen";
      prep.push("format=gbrp", `fps=${fps}`);
      filters.push(`${inLabel}${prep.join(",")}${prepped}`);
      filters.push(`${base}format=gbrp[bf${i}]`);
      filters.push(
        `[bf${i}]${prepped}blend=all_mode=${mode}:all_opacity=${ov.opacity}:` +
          `${enable},format=yuv420p${outLabel}`
      );
    } else {
      prep.push("format=rgba");
      if (ov.opacity < 1) prep.push(`colorchannelmixer=aa=${ov.opacity}`);
      prep.push(`fps=${fps}`);
      filters.push(`${inLabel}${prep.join(",")}${prepped}`);
      const xy =
        ov.position === "fullscreen"
          ? "0:0"
          : OVERLAY_XY[ov.position](ov.margin);
      filters.push(`${base}${prepped}overlay=${xy}:${enable}${outLabel}`);
    }
    base = outLabel;
  });

  return [
    "-y",
    ...inputs,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-t",
    String(videoDuration),
    ...videoEncodeArgs(quality, fps),
    output,
  ];
}

/** Concatenate identically-encoded slide videos (stream copy — fast, no re-encode). */
export function buildConcatArgs(concatListPath: string, output: string): string[] {
  return [
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    concatListPath,
    "-c",
    "copy",
    output,
  ];
}

// --- Audio graph: playlist + crossfade + automation + fades + voiceover ---

export interface AudioMuxSpec {
  tracks: MusicTrack[]; // absolute paths, ≥1
  trackDurations: number[]; // probed seconds, parallel to tracks
  fadeIn: number;
  fadeOut: number;
  crossfade: number;
  automation?: AudioAutomationPoint[];
  voiceover?: VoiceoverConfig; // absolute path
}

/**
 * Mux the full audio bed onto a (silent) video:
 *
 *   tracks -> [loop playlist to cover video] -> acrossfade joins -> master
 *   automation envelope -> fade in/out -> [duck under voiceover] -> mix.
 *
 * The playlist is repeated whole until it covers `videoDuration`, then trimmed,
 * so the video is never truncated by short music (and never outlived by it).
 */
export function buildAudioMuxArgs(
  videoPath: string,
  spec: AudioMuxSpec,
  videoDuration: number,
  output: string,
  quality: QualityProfile
): string[] {
  const cf = spec.crossfade;
  const filters: string[] = [];

  // 1) Repeat the playlist until it covers the video.
  const single = spec.tracks.length === 1;
  const playlistDur =
    spec.trackDurations.reduce((s, d) => s + d, 0) -
    cf * (spec.tracks.length - 1);
  const repeats = single
    ? 1
    : Math.min(50, Math.max(1, Math.ceil(videoDuration / Math.max(playlistDur, 1))));

  const inputs: string[] = ["-i", videoPath];
  if (single) {
    // Fast path: demuxer-level infinite loop, no playlist math needed.
    inputs.push("-stream_loop", "-1", "-i", spec.tracks[0].path);
  } else {
    for (let r = 0; r < repeats; r++) {
      for (const t of spec.tracks) inputs.push("-i", t.path);
    }
  }

  // 2) Per-track gain, then join with acrossfade (or concat when crossfade=0).
  const n = single ? 1 : spec.tracks.length * repeats;
  for (let i = 0; i < n; i++) {
    const vol = spec.tracks[i % spec.tracks.length].volume;
    filters.push(`[${i + 1}:a]volume=${vol}[t${i}]`);
  }
  let bed: string;
  if (n === 1) {
    bed = "t0";
  } else if (cf > 0) {
    let prev = "t0";
    for (let i = 1; i < n; i++) {
      const out = i === n - 1 ? "joined" : `j${i}`;
      filters.push(`[${prev}][t${i}]acrossfade=d=${cf}:c1=tri:c2=tri[${out}]`);
      prev = out;
    }
    bed = "joined";
  } else {
    const labels = Array.from({ length: n }, (_, i) => `[t${i}]`).join("");
    filters.push(`${labels}concat=n=${n}:v=0:a=1[joined]`);
    bed = "joined";
  }

  // 3) Trim to video length, master automation, edge fades.
  const chain: string[] = [`atrim=0:${videoDuration}`, "asetpts=PTS-STARTPTS"];
  if (spec.automation && spec.automation.length > 0) {
    chain.push(`volume='${automationExpr(spec.automation)}':eval=frame`);
  }
  if (spec.fadeIn > 0) chain.push(`afade=t=in:st=0:d=${spec.fadeIn}`);
  if (spec.fadeOut > 0) {
    const st = Math.max(0, videoDuration - spec.fadeOut);
    chain.push(`afade=t=out:st=${st}:d=${spec.fadeOut}`);
  }
  filters.push(`[${bed}]${chain.join(",")}[bed]`);

  // 4) Voiceover: delay into place, optionally duck the music under it.
  let master = "bed";
  if (spec.voiceover) {
    const vo = spec.voiceover;
    const delayMs = Math.round(vo.start * 1000);
    const voIdx = single ? 2 : 1 + n;
    // apad to the full video length: sidechaincompress/amix stop at their
    // shortest input, so an unpadded voice would cut the music short.
    filters.push(
      `[${voIdx}:a]volume=${vo.volume},adelay=${delayMs}|${delayMs},` +
        `apad=whole_dur=${videoDuration},atrim=0:${videoDuration}[vo]`
    );
    if (vo.ducking) {
      filters.push("[vo]asplit[voKey][voMix]");
      filters.push(
        "[bed][voKey]sidechaincompress=threshold=0.03:ratio=10:attack=100:release=500[ducked]"
      );
      filters.push("[ducked][voMix]amix=inputs=2:normalize=0[aout]");
    } else {
      filters.push("[bed][vo]amix=inputs=2:normalize=0[aout]");
    }
    master = "aout";
  }

  const args = [
    "-y",
    ...inputs,
    ...(spec.voiceover ? ["-i", spec.voiceover.path] : []),
    "-filter_complex",
    filters.join(";"),
    "-map",
    "0:v",
    "-map",
    `[${master}]`,
    "-c:v",
    "copy",
    ...audioEncodeArgs(quality),
    "-t",
    String(videoDuration),
    output,
  ];
  return args;
}

/**
 * Piecewise-linear master-volume expression from automation points: holds the
 * first value before the first point, ramps linearly between points, holds the
 * last value afterwards. Points are assumed sorted by `at` (validated).
 */
function automationExpr(points: AudioAutomationPoint[]): string {
  const last = points[points.length - 1];
  let expr = String(last.volume);
  for (let i = points.length - 2; i >= 0; i--) {
    const a = points[i];
    const b = points[i + 1];
    const span = Math.max(b.at - a.at, 0.001);
    const lerp = `${a.volume}+(${b.volume}-${a.volume})*(t-${a.at})/${span}`;
    expr = `if(lt(t,${b.at}),${lerp},${expr})`;
  }
  return `if(lt(t,${points[0].at}),${points[0].volume},${expr})`;
}
