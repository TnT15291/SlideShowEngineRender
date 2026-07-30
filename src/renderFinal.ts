import fs from "node:fs";
import path from "node:path";
import { buildAudioMuxArgs } from "./buildAudioMuxCommand";
import {
  buildConcatArgs,
  buildOverlayArgs,
  buildXfadeArgs,
  hasTransitions,
} from "./buildFinalVideoCommand";
import {
  ensureDir,
  FfmpegError,
  Logger,
  probeDurationSeconds,
  runFfmpeg,
  toFfmpegPath,
} from "./fileUtils";
import type { RenderPlan } from "./types";

const MAX_XFADE_INPUTS = 16;

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
    const batches = chunkXfadeInputs(plan.steps);
    if (batches.length === 1) {
      const { args, totalDuration } = buildXfadeArgs(
        plan.steps,
        target,
        plan.quality
      );
      const filterScriptPath = path.join(tempDir, "xfade-filter.txt");
      const spawnArgs = externalizeFilterComplex(args, filterScriptPath);
      logger.info(
        `Combining ${plan.steps.length} slides with transitions (xfade)...`
      );
      await runFfmpeg(spawnArgs, "xfade", logger, dryRun);
      return totalDuration;
    }

    // A single xfade graph keeps one decoder open per input. Hundreds of slides
    // therefore consume many gigabytes even after the command-line graph itself
    // is externalized. Render small groups first, then join those groups with
    // the original transition at every group boundary.
    logger.info(
      `Combining ${plan.steps.length} slides in ${batches.length} memory-safe xfade batches...`
    );
    const batchSteps = [];
    for (let index = 0; index < batches.length; index++) {
      const batch = batches[index];
      if (batch.length === 1) {
        batchSteps.push(batch[0]);
        continue;
      }

      const batchNumber = String(index + 1).padStart(3, "0");
      const batchTarget = path.join(tempDir, `_xfade_batch_${batchNumber}.mp4`);
      const { args, totalDuration } = buildXfadeArgs(
        batch,
        batchTarget,
        plan.quality
      );
      const spawnArgs = externalizeFilterComplex(
        args,
        path.join(tempDir, `xfade-filter-batch-${batchNumber}.txt`)
      );
      logger.info(
        `Combining xfade batch ${index + 1}/${batches.length} (${batch.length} slides)...`
      );
      await runFfmpeg(spawnArgs, `xfade-batch-${batchNumber}`, logger, dryRun);
      batchSteps.push({
        ...batch[0],
        output: batchTarget,
        duration: totalDuration,
        transition: batch[batch.length - 1].transition,
      });
    }

    const { args, totalDuration } = buildXfadeArgs(
      batchSteps,
      target,
      plan.quality
    );
    const spawnArgs = externalizeFilterComplex(
      args,
      path.join(tempDir, "xfade-filter-final.txt")
    );
    logger.info(`Combining ${batchSteps.length} xfade batches...`);
    await runFfmpeg(spawnArgs, "xfade-final", logger, dryRun);
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

export function chunkXfadeInputs<T>(
  inputs: T[],
  maxInputs = MAX_XFADE_INPUTS
): T[][] {
  if (!Number.isInteger(maxInputs) || maxInputs < 2) {
    throw new Error("maxInputs must be an integer of at least 2");
  }
  const chunks: T[][] = [];
  for (let index = 0; index < inputs.length; index += maxInputs) {
    chunks.push(inputs.slice(index, index + maxInputs));
  }
  return chunks;
}

/** Keep large xfade graphs out of the Windows command line. With a few hundred
 * slides, `-i` arguments plus the inline graph exceed CreateProcess' length limit
 * before FFmpeg can even start. FFmpeg's script option reads the exact same graph
 * from disk and leaves the spawned argument list small enough to launch. */
export function externalizeFilterComplex(args: string[], scriptPath: string): string[] {
  const index = args.indexOf("-filter_complex");
  if (index < 0 || !args[index + 1]) return args;
  fs.writeFileSync(scriptPath, args[index + 1], "utf8");
  return [
    ...args.slice(0, index),
    "-filter_complex_script",
    scriptPath,
    ...args.slice(index + 2),
  ];
}
