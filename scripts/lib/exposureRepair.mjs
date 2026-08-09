// What to do about a scene qaClip found too dark, too bright, or flat.
//
// THE REPAIR THIS REPLACED. qaLoop used to swap the scene's hero photograph for a brighter
// or darker one. It could not work and mostly never ran: it required a layer carrying
// `motion` (montages and single-photo slides have no layers at all, and a card's photo need
// not move) AND an UNUSED replacement of the same orientation — but a Lite film spends every
// photograph in the album, so `!used.has(file)` was false for all of them. Three too_bright
// scenes reached the end of the loop unrepaired on a real job and it shipped
// `delivered_with_flags`.
//
// Exposure is also the proportionate answer. A frame half a stop hot is the right photograph
// badly exposed, not the wrong photograph; swapping it throws away an assignment the solver
// computed against duplicate and adjacency constraints to fix something `eq=brightness`
// fixes exactly.
//
// WHERE THE GRADE GOES is not a detail. src/buildLayerSceneCommand.ts applies `layer.grade`
// and never reads `slide.color` at all — `buildSlideArgs` returns early for layer_scene,
// before the slide-level colour filter every other effect path runs. A scene-level grade on
// a card would be written to the timeline, validate against the schema, and do nothing. So
// the grade lands wherever qaClip measured: on the photograph for a card, on the slide for
// everything else.
import {
  FRAME_DARK_YAVG, FRAME_DARK_LENIENT_YAVG, FRAME_BRIGHT_YAVG, FRAME_FLAT_RANGE,
  EXPOSURE_REPAIR_MARGIN, EXPOSURE_REPAIR_MAX, CONTRAST_REPAIR_MAX,
} from "./rules/thresholds.mjs";

// The schema's artistic range for an authored look; a slide grade may travel further.
const LAYER_BRIGHTNESS_LIMIT = 0.3;

/**
 * @returns {{layer: number|null, holder: "grade"|"color", next: object, notes: string[]}|null}
 *          null when there is nothing deterministic to do.
 */
export function planExposureRepair({ slide, problem }) {
  if (!slide || !problem) return null;
  const onLayer = Number.isInteger(problem.layer);
  const target = onLayer ? slide.layers?.[problem.layer] : slide;
  if (!target) return null;
  if (onLayer && target.type !== "image") return null;

  const holder = onLayer ? "grade" : "color";
  const limit = Math.min(EXPOSURE_REPAIR_MAX, onLayer ? LAYER_BRIGHTNESS_LIMIT : 1);
  const before = { ...(target[holder] || {}) };
  const next = { ...before };
  const notes = [];
  const flags = problem.flags || [];
  const exposed = (flags.includes("too_dark") || flags.includes("too_bright"))
    && Number.isFinite(problem.yavg);
  const flat = flags.includes("flat_or_empty") && problem.range > 0;
  if (!exposed && !flat) return null;

  // CONTRAST FIRST, because brightness has to know about it. ffmpeg's eq is
  // `out = (in - 0.5) * contrast + 0.5 + brightness` on the normalised luma — contrast
  // pivots about the MIDPOINT, so on an off-centre frame it moves the mean too. Computed
  // independently, the two corrections fought: a blown-out frame measured at 232 came back
  // from `brightness -0.08, contrast 1.4` at **252**, brighter than it started.
  //
  // And on a frame that is BOTH, exposure wins outright. A blown-out frame is flat because
  // its highlights are clipped — the flatness is the symptom, not a second defect — and
  // stretching contrast around the midpoint drives the mean further out than the bounded
  // brightness correction can pull it back: at range 14 the pair lands at 231 against a 224
  // line, with brightness already pinned to its cap. Fix the exposure; if the frame is still
  // flat after the re-render, that is a judgement for a person.
  const contrast = Number(before.contrast || 1);
  let nextContrast = contrast;
  if (flat && !exposed) {
    nextContrast = Math.min(CONTRAST_REPAIR_MAX, contrast * ((FRAME_FLAT_RANGE + EXPOSURE_REPAIR_MARGIN) / problem.range));
    if (nextContrast > contrast) {
      next.contrast = +nextContrast.toFixed(3);
      notes.push(`contrast ${contrast.toFixed(3)} -> ${next.contrast} (range ${problem.range})`);
    } else nextContrast = contrast;
  }

  if (Number.isFinite(problem.yavg)) {
    const mean = problem.yavg / 255;
    // qaClip measured the RENDERED frame, so any grade already on this target was applied
    // before the measurement. Undo it to recover the source mean, or a second correction
    // would be computed as though the first had never happened.
    const source = (mean - 0.5 - Number(before.brightness || 0)) / contrast + 0.5;
    let aim = mean;
    if (exposed) {
      const bright = flags.includes("too_bright");
      // Montages and full-bleed frames are allowed to run darker by design — the same
      // allowance qaClip makes when it raises the flag, so the two cannot disagree.
      const lenient = slide.effect !== "layer_scene";
      const bound = bright ? FRAME_BRIGHT_YAVG : (lenient ? FRAME_DARK_LENIENT_YAVG : FRAME_DARK_YAVG);
      // Aim PAST the line by a margin: fix-once means there is no second attempt, so landing
      // exactly on the threshold would come straight back after the re-render.
      aim = (bright ? bound - EXPOSURE_REPAIR_MARGIN : bound + EXPOSURE_REPAIR_MARGIN) / 255;
    }
    // Solve the filter for the brightness that puts the mean where we want it. With no
    // exposure flag this simply holds the mean where it already is, so a contrast bump for
    // a flat frame cannot push a well-exposed photograph over the too_bright line.
    const solved = aim - ((source - 0.5) * nextContrast + 0.5);
    const bounded = Math.max(-limit, Math.min(limit, solved));
    if (Math.abs(bounded - Number(before.brightness || 0)) > 0.0005) {
      next.brightness = +bounded.toFixed(3);
      notes.push(`brightness ${Number(before.brightness || 0).toFixed(3)} -> ${next.brightness} (yavg ${problem.yavg})`);
    }
  }

  if (!notes.length) return null;
  return { layer: onLayer ? problem.layer : null, holder, next, notes };
}
