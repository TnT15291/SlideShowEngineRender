import fs from "node:fs";
import { buildSlideArgs } from "./buildFfmpegCommand";
import { Logger, runFfmpeg } from "./fileUtils";
import type { RenderPlan } from "./types";

/**
 * Render every slide to its own temp video. Rendering slides individually keeps
 * failures isolated and debuggable: a bad slide names itself, its image, and its
 * ffmpeg stderr instead of collapsing one giant command.
 */
export async function renderSlides(
  plan: RenderPlan,
  logger: Logger,
  dryRun = false
): Promise<void> {
  const total = plan.steps.length;

  for (let i = 0; i < total; i++) {
    const step = plan.steps[i];

    if (step.autoPortrait) {
      logger.info(
        `slide ${step.slideId}: image aspect (${step.srcWidth}x${step.srcHeight}) far from ` +
          `${step.width}x${step.height} frame — using portrait_blur_background ` +
          `(requested "${step.requestedEffect}") to avoid cropping`
      );
    }

    // drawtext reads each caption from a file, so any text renders unescaped.
    for (const c of step.captions) {
      fs.writeFileSync(c.textFile, c.text, "utf8");
      logger.info(`slide ${step.slideId}: ${c.role} "${c.text}"`);
    }
    for (const layer of step.layers) {
      if (layer.type === "text") {
        fs.writeFileSync(layer.textFile, layer.text, "utf8");
        logger.info(`slide ${step.slideId}: layer text "${layer.text}"`);
      }
    }

    logger.info(
      `Rendering slide ${i + 1}/${total}: ${step.slideId} (${step.duration}s, ${step.effect})`
    );

    const args = buildSlideArgs(step);
    try {
      await runFfmpeg(args, `slide ${step.slideId}`, logger, dryRun);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      logger.error(
        `Slide ${step.slideId} failed\n  Image: ${step.input}\n  Reason: ${reason}`
      );
      throw err;
    }
  }

  logger.info(`All ${total} slides rendered to temp/`);
}
