import { buildCaptionFilter } from "./captionFilter";
import { buildColorFilter, buildLetterboxFilter } from "./buildColorFilters";
import {
  darkFeatherFilter,
  lockupLineFilter,
  lockupTextFilters,
} from "./buildEditorialEffects";
import { buildTechnicalColorFilter, clamp01 } from "./ffmpegFilterHelpers";
import { FACE_CROP_MARGIN } from "./imageSize";
import type { MotionEasing, RenderSlideStep } from "./types";

// --- Motion tuning (see docs/ENGINE-ARCHITECTURE.md) ---
const ZOOM_MAX = 1.12; // slow_zoom_in ends here; slow_zoom_out starts here
const PAN_ZOOM = 1.12; // pans hold this zoom to leave slack to travel across
const BG_BLUR_SIGMA = 20; // portrait background blur strength
// Continuous Ken-Burns on an image layer: a 2x-oversampled cover fill driven by
// zoompan over the whole slide, reusing the same eased zoom/pan exprs as the
// whole-slide effects so layer motion matches the house style.
function layerMotionFilter(
  motion: string,
  w: number,
  h: number,
  fps: number,
  frames: number,
  strength = 0.08,
  focusX = 0.5,
  focusY = 0.5,
  easing?: MotionEasing,
  faceBox?: { x: number; y: number; width: number; height: number }
): string {
  // Same crop, same rule as zoompanFilter: the aspect-ratio crop is the destructive one,
  // so it takes the focus too. This function ALREADY had focusX/focusY and spent them only
  // on the zoom target below — steering a 12% zoom inside a frame whose edges had already
  // been thrown away at dead centre. Aiming carefully inside a photo that has already lost
  // the head is not face-safe framing.
  // The face-constrained offset contains commas (min/max/if); crop's expression
  // arguments must be quoted or ffmpeg splits the graph at the first comma.
  const base =
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,` +
    `crop=${w * 2}:${h * 2}:'${faceSafeCropOffset("iw", "ow", focusX, faceBox?.x, faceBox?.width)}':` +
    `'${faceSafeCropOffset("ih", "oh", focusY, faceBox?.y, faceBox?.height)}'`;
  const maxZoom = 1 + Math.min(0.12, Math.max(0.01, strength));
  const p = easedProgress(frames, easing);
  const targetX = `'(iw-iw/zoom)*${clamp01(focusX)}'`;
  const targetY = `'(ih-ih/zoom)*${clamp01(focusY)}'`;
  let z = maxZoom.toFixed(4);
  let x = targetX;
  let y = targetY;
  switch (motion) {
    case "zoom_in": z = `'min(1+${strength.toFixed(4)}*${p},${maxZoom.toFixed(4)})'`; break;
    case "zoom_out": z = `'max(${maxZoom.toFixed(4)}-${strength.toFixed(4)}*${p},1)'`; break;
    case "pan_left": x = `'(iw-iw/zoom)*(1-${p})'`; break;
    case "pan_right": x = `'(iw-iw/zoom)*${p}'`; break;
    case "pan_up": y = `'(ih-ih/zoom)*(1-${p})'`; break;
    case "pan_down": y = `'(ih-ih/zoom)*${p}'`; break;
  }
  return `${base},zoompan=z=${z}:x=${x}:y=${y}:d=${frames}:s=${w}x${h}:fps=${fps}`;
}

export function buildEffectFilter(step: RenderSlideStep): string {
  const chain = [buildFramingFilter(step)];
  const technical = buildTechnicalColorFilter(step.technicalColor);
  if (technical) chain.push(technical);

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
function buildFramingFilter(step: RenderSlideStep): string {
  const { effect, width: w, height: h, fps, duration } = step;
  const frames = Math.max(1, Math.round(duration * fps));
  const tail = `setsar=1,fps=${fps},format=yuv420p`;

  switch (effect) {
    case "portrait_blur_background":
      return portraitBlurFilter(w, h, fps);

    case "portrait_reflection":
      return portraitReflectionFilter(w, h, fps);

    case "floating_card_gallery":
      return floatingCardGalleryFilter(step);

    case "moving_background_echo":
      return movingBackgroundEchoFilter(step);

    case "panel_flip":
      return panelFlipFilter(step);

    case "polaroid":
      return polaroidFilter(w, h, fps, duration);

    case "circle_focus":
      return circleFocusFilter(w, h, fps);

    case "dark_feather":
      return darkFeatherFilter(step);

    case "tilt_shift":
      return tiltShiftFilter(step);

    case "dream_glow":
      return dreamGlowFilter(step);

    case "prism_split":
      return prismSplitFilter(step);

    case "spotlight_focus":
      return spotlightFocusFilter(step);

    case "mirror_split":
      return mirrorSplitFilter(step);

    case "slow_zoom_in":
      return zoompanFilter(w, h, fps, frames, zoomInExpr(frames, step.easing, faceSafeMaxZoom(step)), centerX(), centerY(), tail, step.focusX, step.focusY, step.faceBox);

    case "slow_zoom_out":
      return zoompanFilter(w, h, fps, frames, zoomOutExpr(frames, step.easing, faceSafeMaxZoom(step)), centerX(), centerY(), tail, step.focusX, step.focusY, step.faceBox);

    case "pan_left":
      return zoompanFilter(w, h, fps, frames, String(PAN_ZOOM), panXExpr(frames, "left", step.easing), centerY(), tail, step.focusX, step.focusY);
    case "pan_right":
      return zoompanFilter(w, h, fps, frames, String(PAN_ZOOM), panXExpr(frames, "right", step.easing), centerY(), tail, step.focusX, step.focusY);
    case "pan_up":
      return zoompanFilter(w, h, fps, frames, String(PAN_ZOOM), centerX(), panYExpr(frames, "up", step.easing), tail, step.focusX, step.focusY);
    case "pan_down":
      return zoompanFilter(w, h, fps, frames, String(PAN_ZOOM), centerX(), panYExpr(frames, "down", step.easing), tail, step.focusX, step.focusY);

    // Ken-burns gets the same face-safe treatment as slow_zoom: the diagonal drift
    // ends zoomed-in at a corner, which is exactly where it used to push a face out
    // of frame — the zoom cap and the face-aware crop keep the group visible.
    case "kenburns_tl":
      return zoompanFilter(w, h, fps, frames, zoomInExpr(frames, step.easing, faceSafeMaxZoom(step)), kenburnsExpr(frames, "iw", 0, step.easing), kenburnsExpr(frames, "ih", 0, step.easing), tail, step.focusX, step.focusY, step.faceBox);
    case "kenburns_tr":
      return zoompanFilter(w, h, fps, frames, zoomInExpr(frames, step.easing, faceSafeMaxZoom(step)), kenburnsExpr(frames, "iw", 1, step.easing), kenburnsExpr(frames, "ih", 0, step.easing), tail, step.focusX, step.focusY, step.faceBox);
    case "kenburns_bl":
      return zoompanFilter(w, h, fps, frames, zoomInExpr(frames, step.easing, faceSafeMaxZoom(step)), kenburnsExpr(frames, "iw", 0, step.easing), kenburnsExpr(frames, "ih", 1, step.easing), tail, step.focusX, step.focusY, step.faceBox);
    case "kenburns_br":
      return zoompanFilter(w, h, fps, frames, zoomInExpr(frames, step.easing, faceSafeMaxZoom(step)), kenburnsExpr(frames, "iw", 1, step.easing), kenburnsExpr(frames, "ih", 1, step.easing), tail, step.focusX, step.focusY, step.faceBox);

    case "still":
      // Cover-fill to 16:9, centered (docs: "scale/crop về 16:9"). Portrait
      // images are rerouted to portrait_blur_background upstream, so cropping
      // here only ever trims a centered landscape frame.
      return (
        `scale=${w}:${h}:force_original_aspect_ratio=increase,` +
        `crop=${w}:${h},${tail}`
      );

    default:
      // Every other EffectPreset (layer_scene, video_background, collage_grid,
      // double_exposure, mask_reveal, memory_wall, film_roll_*, photo_strip_*)
      // is routed to its own builder in buildSlideArgs before buildEffectFilter
      // is ever called, so a real EffectPreset value can never reach here.
      // Landing here means validation let something non-EffectPreset through —
      // silently rendering it as "still" would hide exactly that bug.
      throw new Error(`buildFramingFilter: unhandled effect "${effect}"`);
  }
}

function tiltShiftFilter(step: RenderSlideStep): string {
  const { height: h, fps } = step;
  const config = step.tiltShift ?? { focusY: 0.5, bandHeight: 0.22, blur: 14 };
  // A fixed centre band blurred the eyes whenever the subjects stood above or below
  // mid-frame. Prefer the detected face-group centre, then the analyzer's focal point;
  // the authored/default focus remains the fallback for photos with no subject data.
  const detectedFaceY = step.faceBox
    ? step.faceBox.y + step.faceBox.height / 2
    : undefined;
  const focusRatio = clamp01(detectedFaceY ?? step.focusY ?? config.focusY);
  // Keep the complete detected face group inside the sharp core. The same margin used
  // by face-safe cropping absorbs detector jitter and a little hair/chin breathing room.
  const faceBand = step.faceBox
    ? Math.min(0.65, step.faceBox.height + FACE_CROP_MARGIN * 2)
    : 0;
  const bandHeight = Math.max(config.bandHeight, faceBand);
  const focusY = Math.round(focusRatio * h);
  const halfBand = Math.max(1, Math.round((bandHeight * h) / 2));
  const feather = Math.max(12, Math.round(halfBand * 0.65));
  const outer = halfBand + feather;
  const maskExpr = `255*clip((${outer}-abs(Y-${focusY}))/${feather},0,1)`;

  return (
    `${coverFilter(step)},split=3[ts_sharp][ts_blur_src][ts_mask_src];` +
    `[ts_blur_src]gblur=sigma=${config.blur.toFixed(2)}[ts_blur];` +
    `[ts_mask_src]format=gray,geq=lum='${maskExpr}'[ts_mask];` +
    `[ts_blur][ts_sharp][ts_mask]maskedmerge,fps=${fps},format=yuv420p`
  );
}

// Whole-slide static effects (no zoompan motion) used dead-centre `crop=w:h` here even
// though every RenderSlideStep already carries focusX/focusY/faceBox (compileTimeline.ts
// sets them unconditionally) — mirror_split in particular would slice straight through an
// off-centre face at the split line. Reuses the same faceSafeCropOffset the zoompan/kenburns
// effects use so a subject-detected photo behaves the same way here.
function coverFilter(step: RenderSlideStep): string {
  const { width: w, height: h, focusX = 0.5, focusY = 0.5, faceBox } = step;
  const cropX = faceSafeCropOffset("iw", "ow", focusX, faceBox?.x, faceBox?.width);
  const cropY = faceSafeCropOffset("ih", "oh", focusY, faceBox?.y, faceBox?.height);
  return `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}:'${cropX}':'${cropY}',setsar=1`;
}

function dreamGlowFilter(step: RenderSlideStep): string {
  const { fps } = step;
  return (
    `${coverFilter(step)},split=2[dg_base][dg_soft_src];` +
    `[dg_soft_src]gblur=sigma=10,eq=brightness=0.06:saturation=1.12[dg_soft];` +
    `[dg_base][dg_soft]blend=all_mode=screen:all_opacity=0.32,` +
    `fps=${fps},format=yuv420p`
  );
}

function prismSplitFilter(step: RenderSlideStep): string {
  const { fps } = step;
  return (
    `${coverFilter(step)},rgbashift=rh=7:bh=-7:edge=smear,` +
    `eq=contrast=1.04:saturation=1.08,fps=${fps},format=yuv420p`
  );
}

function spotlightFocusFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps } = step;
  return (
    `${coverFilter(step)},vignette=angle=PI/3:x0=w/2:y0=h*0.46:aspect=${w}/${h},` +
    `eq=contrast=1.06:saturation=0.96,fps=${fps},format=yuv420p`
  );
}

function mirrorSplitFilter(step: RenderSlideStep): string {
  const { fps } = step;
  const face = step.faceBox;
  if (
    face &&
    face.x - FACE_CROP_MARGIN <= 0.5 &&
    face.x + face.width + FACE_CROP_MARGIN >= 0.5
  ) {
    // The mirror seam is destructive when it passes through a face: it duplicates
    // or removes half the subject and makes adjacent background lines jump. Keep the
    // same editorial contrast treatment, but fall back to the face-safe full frame.
    return spotlightFocusFilter(step);
  }
  return (
    `${coverFilter(step)},split=2[ms_left_src][ms_right_src];` +
    `[ms_left_src]crop=w=iw/2:h=ih:x=0:y=0[ms_left];` +
    `[ms_right_src]hflip,crop=w=iw/2:h=ih:x=0:y=0[ms_right];` +
    `[ms_left][ms_right]hstack=inputs=2,fps=${fps},format=yuv420p`
  );
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
  tail: string,
  focusX = 0.5,
  focusY = 0.5,
  faceBox?: { x: number; y: number; width: number; height: number }
): string {
  // THE CROP THAT DECIDES WHETHER A FACE SURVIVES is this one, not the zoompan below.
  // Cover-scaling a 3:4 portrait into a 16:9 frame throws away the top and bottom thirds,
  // and heads live at the top — so an un-offset crop beheads the couple before any pan
  // expression gets a say. It used to read `crop=${w*2}:${h*2}`: dead centre, always.
  //
  // Meanwhile analyzePhotos was running YuNet over every photo and writing a face-derived
  // focusX/focusY that reached nothing: the slide schema had no field for it, so the whole
  // face pipeline terminated in the analysis file. Measured on a real 130-photo album at
  // 16:9 — 59 principal faces cut in half or worse; honouring focus leaves 3.
  //
  // The pan/zoom exprs are unaffected: they address `iw`/`ih` of the CROPPED frame, so they
  // still travel the same distance, they just travel it across the right part of the photo.
  const cropX = faceSafeCropOffset("iw", "ow", focusX, faceBox?.x, faceBox?.width);
  const cropY = faceSafeCropOffset("ih", "oh", focusY, faceBox?.y, faceBox?.height);
  // Quoted: the face-constrained offset contains commas (min/max/if), and an
  // unquoted comma inside crop's expression splits the filter graph — the render
  // died with "No such filter: 'min(iw-ow'" the first time a face-bearing photo
  // landed on a zoompan slide.
  const base =
    `scale=${w * 2}:${h * 2}:force_original_aspect_ratio=increase,` +
    `crop=${w * 2}:${h * 2}:'${cropX}':'${cropY}'`;
  const zp =
    `zoompan=z=${z}:x=${x}:y=${y}:d=${frames}:s=${w}x${h}:fps=${fps}`;
  return `${base},${zp},${tail}`;
}

// Clamp the cover crop so the complete detected face group remains visible. A focal
// point alone cannot do this: its centre may be visible while a forehead or second face
// is outside the frame. The 4% source-space guard also absorbs the later 12% zoom.
function faceSafeCropOffset(
  input: "iw" | "ih",
  output: "ow" | "oh",
  focus: number,
  start?: number,
  size?: number
): string {
  const desired = `(${input}-${output})*${clamp01(focus)}`;
  if (!Number.isFinite(start) || !Number.isFinite(size)) return desired;
  const margin = FACE_CROP_MARGIN;
  const near = Math.max(0, (start as number) - margin);
  const far = Math.min(1, (start as number) + (size as number) + margin);
  const constrained = `min(max(${desired},${far.toFixed(4)}*${input}-${output}),${near.toFixed(4)}*${input})`;
  return `max(0,min(${input}-${output},if(lte(${(far - near).toFixed(4)}*${input},${output}),${constrained},${desired})))`;
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

export function zoomInExpr(frames: number, easing?: MotionEasing, maxZoom = ZOOM_MAX): string {
  const p = easedProgress(frames, easing);
  return `'min(1.0+${(maxZoom - 1).toFixed(4)}*${p},${maxZoom.toFixed(4)})'`;
}
function zoomOutExpr(frames: number, easing?: MotionEasing, maxZoom = ZOOM_MAX): string {
  const p = easedProgress(frames, easing);
  return `'max(${maxZoom.toFixed(4)}-${(maxZoom - 1).toFixed(4)}*${p},1.0)'`;
}

function faceSafeMaxZoom(step: RenderSlideStep): number {
  const box = step.faceBox;
  if (!box || !step.srcWidth || !step.srcHeight) return ZOOM_MAX;
  const sourceAspect = step.srcWidth / step.srcHeight;
  const frameAspect = step.width / step.height;
  const visibleWidth = sourceAspect > frameAspect ? frameAspect / sourceAspect : 1;
  const visibleHeight = sourceAspect > frameAspect ? 1 : sourceAspect / frameAspect;
  // Match faceSafeCropOffset's 4% guard on each side. If the face group is large,
  // reduce the motion rather than letting the final frames cut it.
  return Math.max(1, Math.min(ZOOM_MAX,
    visibleWidth / (box.width + 0.08), visibleHeight / (box.height + 0.08)));
}

// Center the crop window on both axes (used when that axis isn't panning).
export function centerX(): string {
  return `'iw/2-(iw/zoom/2)'`;
}
export function centerY(): string {
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
// Bright studio card with a soft floor reflection. Both the portrait and its
// reflection use contain-fit geometry, so faces and dresses are never cropped.
// The background is derived from the photo itself; no stock studio asset is required.
function portraitReflectionFilter(w: number, h: number, fps: number): string {
  const cardW = Math.round(w * 0.62);
  const cardH = Math.round(h * 0.68);
  const reflectionH = Math.round(cardH * 0.28);
  const photoY = Math.round(h * 0.06);
  const reflectionY = photoY + cardH + Math.round(h * 0.012);

  return [
    "split=3[pr_bg][pr_photo_src][pr_ref_src]",
    `[pr_bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
      "gblur=sigma=32,eq=brightness=0.22:contrast=0.72:saturation=0.42[pr_bg_soft]",
    `[pr_photo_src]scale=${cardW}:${cardH}:force_original_aspect_ratio=decrease,` +
      `pad=${cardW}:${cardH}:(ow-iw)/2:(oh-ih)/2:color=white,setsar=1[pr_photo]`,
    `[pr_ref_src]scale=${cardW}:${cardH}:force_original_aspect_ratio=decrease,` +
      `pad=${cardW}:${cardH}:(ow-iw)/2:(oh-ih)/2:color=white,vflip,` +
      `crop=${cardW}:${reflectionH}:0:0,gblur=sigma=2,format=rgba,` +
      "colorchannelmixer=aa=0.18[pr_reflection]",
    `[pr_bg_soft][pr_photo]overlay=(W-w)/2:${photoY}[pr_with_photo]`,
    `[pr_with_photo][pr_reflection]overlay=(W-w)/2:${reflectionY},` +
      `fps=${fps},format=yuv420p`,
  ].join(";");
}

// One photograph becomes three physical cards at different apparent depths.
// Small counter-moving drifts create parallax without requiring a 3D renderer.
function floatingCardGalleryFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const backW = Math.round(w * 0.28);
  const backH = Math.round(h * 0.58);
  const heroW = Math.round(w * 0.39);
  const heroH = Math.round(h * 0.76);
  const p = `min(t/${duration.toFixed(4)},1)`;
  const ease = `(${p}*${p}*(3-2*${p}))`;

  return [
    "split=4[fc_bg][fc_left_src][fc_hero_src][fc_right_src]",
    `[fc_bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
      "gblur=sigma=36,eq=brightness=0.19:contrast=0.74:saturation=0.5[fc_canvas]",
    `[fc_left_src]scale=${backW}:${backH}:force_original_aspect_ratio=decrease,` +
      `pad=${backW}:${backH}:(ow-iw)/2:(oh-ih)/2:color=white,` +
      "rotate=-0.045:fillcolor=none:ow=rotw(-0.045):oh=roth(-0.045),format=rgba,colorchannelmixer=aa=0.58[fc_left]",
    `[fc_right_src]scale=${backW}:${backH}:force_original_aspect_ratio=decrease,` +
      `pad=${backW}:${backH}:(ow-iw)/2:(oh-ih)/2:color=white,` +
      "rotate=0.045:fillcolor=none:ow=rotw(0.045):oh=roth(0.045),format=rgba,colorchannelmixer=aa=0.58[fc_right]",
    `[fc_hero_src]scale=${heroW}:${heroH}:force_original_aspect_ratio=decrease,` +
      `pad=${heroW}:${heroH}:(ow-iw)/2:(oh-ih)/2:color=white,format=rgba[fc_hero]`,
    `[fc_canvas][fc_left]overlay=x='${Math.round(w * 0.08)}+28*${ease}':y='${Math.round(h * 0.22)}-10*${ease}'[fc_l]`,
    `[fc_l][fc_right]overlay=x='W-w-${Math.round(w * 0.08)}-28*${ease}':y='${Math.round(h * 0.2)}+12*${ease}'[fc_lr]`,
    `[fc_lr][fc_hero]overlay=x='(W-w)/2':y='${Math.round(h * 0.1)}-14*${ease}',fps=${fps},format=yuv420p`,
  ].join(";");
}

// The center photograph stays sharp while two enlarged, blurred echoes move
// behind it in opposite directions. This matches the common studio-slideshow
// depth cue without needing extra background assets.
function movingBackgroundEchoFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const echoW = Math.round(w * 0.58);
  const echoH = Math.round(h * 0.9);
  const heroW = Math.round(w * 0.38);
  const heroH = Math.round(h * 0.78);
  const p = `min(t/${duration.toFixed(4)},1)`;
  const ease = `(${p}*${p}*(3-2*${p}))`;

  return [
    "split=4[me_bg][me_left_src][me_right_src][me_hero_src]",
    `[me_bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
      "gblur=sigma=42,eq=brightness=0.24:contrast=0.66:saturation=0.35[me_canvas]",
    `[me_left_src]scale=${echoW}:${echoH}:force_original_aspect_ratio=increase,crop=${echoW}:${echoH},` +
      "gblur=sigma=18,format=rgba,colorchannelmixer=aa=0.22[me_left]",
    `[me_right_src]scale=${echoW}:${echoH}:force_original_aspect_ratio=increase,crop=${echoW}:${echoH},` +
      "gblur=sigma=18,format=rgba,colorchannelmixer=aa=0.22[me_right]",
    `[me_hero_src]scale=${heroW}:${heroH}:force_original_aspect_ratio=decrease,` +
      `pad=${heroW}:${heroH}:(ow-iw)/2:(oh-ih)/2:color=white,format=rgba[me_hero]`,
    `[me_canvas][me_left]overlay=x='-${Math.round(echoW * 0.42)}+42*${ease}':y='(H-h)/2'[me_l]`,
    `[me_l][me_right]overlay=x='W-w+${Math.round(echoW * 0.42)}-42*${ease}':y='(H-h)/2'[me_lr]`,
    `[me_lr][me_hero]overlay=x='(W-w)/2':y='(H-h)/2',fps=${fps},format=yuv420p`,
  ].join(";");
}

// A 2D album-panel flip: horizontal foreshortening closes the card to a thin
// edge at mid-scene, then opens it again. The blurred canvas prevents a black
// gap while the panel is edge-on.
function panelFlipFilter(step: RenderSlideStep): string {
  const { width: w, height: h, fps, duration } = step;
  const cardW = Math.round(w * 0.68);
  const cardH = Math.round(h * 0.82);
  const phase = `(PI*t/${duration.toFixed(4)})`;

  return [
    "split[pf_bg][pf_panel_src]",
    `[pf_bg]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},` +
      "gblur=sigma=34,eq=brightness=0.16:contrast=0.78:saturation=0.55[pf_canvas]",
    `[pf_panel_src]scale=${cardW}:${cardH}:force_original_aspect_ratio=decrease,` +
      `pad=${cardW}:${cardH}:(ow-iw)/2:(oh-ih)/2:color=white,` +
      `scale=w='max(8,iw*abs(cos(${phase})))':h=ih:eval=frame,format=rgba[pf_panel]`,
    `[pf_canvas][pf_panel]overlay=x='(W-w)/2':y='(H-h)/2',fps=${fps},format=yuv420p`,
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
