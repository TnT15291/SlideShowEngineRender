import fs from "node:fs";
import path from "node:path";
import {
  buildAudioMuxArgs,
  buildConcatArgs,
  buildOverlayArgs,
  buildXfadeArgs,
  hasTransitions,
} from "./buildFfmpegCommand";
import {
  ensureDir,
  FfmpegError,
  Logger,
  probeDurationSeconds,
  runFfmpeg,
  toFfmpegPath,
} from "./fileUtils";
import type { RenderPlan } from "./types";

/**
 * Combine the rendered slides and (if present) mux in background music,
 * producing the final MP4.
 *
 * Two join strategies:
 *   - No transitions  -> concat demuxer with stream copy (fast, no re-encode).
 *   - Any transition  -> xfade filter chain (re-encode; slides overlap).
 * The chosen strategy also determines the true video length used to fit music.
 */
export async function renderFinal(
  plan: RenderPlan,
  tempDir: string,
  logger: Logger,
  dryRun = false
): Promise<void> {
  ensureDir(path.dirname(plan.finalOutput));

  const hasMusic = plan.audio !== undefined;
  const hasOverlays = plan.overlays.length > 0;

  // Pipeline: combine -> [overlays] -> [music]; only the last stage writes the
  // final path, earlier stages write silent intermediates in temp/.
  const combineTarget =
    hasMusic || hasOverlays
      ? path.join(tempDir, "_combined_silent.mp4")
      : plan.finalOutput;

  // 1) Combine slides -> combineTarget, and learn the resulting video length.
  const videoDuration = await combineSlides(
    plan,
    tempDir,
    combineTarget,
    logger,
    dryRun
  );

  // 2) Layer overlays (logo / watermark / frame / particles) in one pass.
  let currentVideo = combineTarget;
  if (hasOverlays) {
    const overlayTarget = hasMusic
      ? path.join(tempDir, "_overlaid_silent.mp4")
      : plan.finalOutput;
    logger.info(`Applying ${plan.overlays.length} overlay(s)...`);
    await runFfmpeg(
      buildOverlayArgs(
        currentVideo,
        plan.overlays,
        plan.project.width,
        plan.project.height,
        videoDuration,
        plan.project.fps,
        overlayTarget,
        plan.quality
      ),
      "overlays",
      logger,
      dryRun
    );
    currentVideo = overlayTarget;
  }

  // 3) Build the audio bed (playlist/crossfade/automation/fades/voiceover).
  if (hasMusic && plan.audio) {
    const a = plan.audio;

    // Track lengths drive playlist looping; dry-run skips the probe. The stand-in
    // length must cover the track's own edit window: a flat 60 failed every timeline
    // whose highlight starts after 1:00 (end = min(60, edit.end) landed before the
    // start), so a valid edit died in dry-run and — in the premium loop — silently
    // cost the customer the director layer. Trusting `end` here still catches a
    // start >= end edit; the probe still guards the real render.
    const trackDurations = dryRun
      ? a.tracks.map((t) => Math.max(60, t.end ?? 0))
      : await Promise.all(a.tracks.map((t) => probeDurationSeconds(t.path)));
    const resolved = trackDurations.map((d, i) => {
      if (d === undefined) {
        throw new FfmpegError(`Cannot read duration of music: ${a.tracks[i].path}`);
      }
      const start = a.tracks[i].start ?? 0;
      const end = Math.min(d, a.tracks[i].end ?? d);
      if (end <= start) throw new FfmpegError(`Invalid music edit: ${start}s–${end}s`);
      return end - start;
    });

    // acrossfade needs each segment to outlast the crossfade.
    const minTrack = Math.min(...resolved);
    const crossfade =
      a.tracks.length > 1
        ? Math.min(a.crossfade, Math.max(0, minTrack - 0.5))
        : a.crossfade;

    logger.info(
      `Adding audio: ${a.tracks.length} track(s)` +
        `${a.voiceover ? " + voiceover" : ""}` +
        `${a.automation ? ` + ${a.automation.length} automation points` : ""}` +
        ` (video ${videoDuration.toFixed(2)}s)...`
    );
    await runFfmpeg(
      buildAudioMuxArgs(
        currentVideo,
        {
          tracks: a.tracks,
          trackDurations: resolved,
          fadeIn: a.fadeIn,
          fadeOut: a.fadeOut,
          crossfade,
          automation: a.automation,
          voiceover: a.voiceover,
        },
        videoDuration,
        plan.finalOutput,
        plan.quality
      ),
      "audio",
      logger,
      dryRun
    );
  }

  logger.info(`Final video written: ${plan.finalOutput}`);
}

/** Join the slide videos into `target`; returns the combined duration (seconds). */
async function combineSlides(
  plan: RenderPlan,
  tempDir: string,
  target: string,
  logger: Logger,
  dryRun: boolean
): Promise<number> {
  if (hasTransitions(plan.steps)) {
    const { args, totalDuration } = buildXfadeArgs(
      plan.steps,
      target,
      plan.quality
    );
    logger.info(
      `Combining ${plan.steps.length} slides with transitions (xfade)...`
    );
    await runFfmpeg(args, "xfade", logger, dryRun);
    return totalDuration;
  }

  // Hard concat: write the demuxer list (forward slashes are required), then copy.
  const concatListPath = path.join(tempDir, "concat.txt");
  const listBody = plan.steps
    .map((s) => `file '${toFfmpegPath(s.output)}'`)
    .join("\n");
  fs.writeFileSync(concatListPath, listBody + "\n");
  logger.info(`Wrote concat list: ${concatListPath}`);

  logger.info("Concatenating slides (no transitions)...");
  await runFfmpeg(buildConcatArgs(concatListPath, target), "concat", logger, dryRun);

  return plan.steps.reduce((sum, s) => sum + s.duration, 0);
}
