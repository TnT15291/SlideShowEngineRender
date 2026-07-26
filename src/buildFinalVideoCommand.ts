import { videoEncodeArgs } from "./quality";
import type { QualityProfile } from "./quality";
import { XFADE_BY_TRANSITION } from "./types";
import type { CompiledOverlay, OverlayPosition, RenderSlideStep } from "./types";

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
