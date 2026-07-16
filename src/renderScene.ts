import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { buildSlideArgs } from "./buildFfmpegCommand";
import { ensureDir, Logger, runFfmpeg } from "./fileUtils";
import { videoEncodeArgs } from "./quality";
import { renderBlenderScene } from "./renderBlenderScene";
import { renderRemotionScene } from "./renderRemotionScene";
import type { RenderSlideStep } from "./types";

export async function renderScene(step: RenderSlideStep, logger: Logger, dryRun: boolean): Promise<void> {
  const cacheDir = path.join(path.dirname(step.output), "scene-cache");
  const cached = path.join(cacheDir, `${cacheKey(step)}.mp4`);
  if (!dryRun && fs.existsSync(cached)) {
    fs.copyFileSync(cached, step.output);
    logger.info(`slide ${step.slideId}: restored ${step.renderer} clip from cache`);
    return;
  }

  if (step.renderer === "ffmpeg") {
    await runFfmpeg(buildSlideArgs(step), `slide ${step.slideId}`, logger, dryRun);
  } else {
    const rawOutput = path.join(path.dirname(step.output), `${step.slideId}.${step.renderer}.raw.mp4`);
    const externalStep = { ...step, output: rawOutput };
    if (step.renderer === "remotion") await renderRemotionScene(externalStep, logger, dryRun);
    else await renderBlenderScene(externalStep, logger, dryRun);
    if (!dryRun && !fs.existsSync(rawOutput)) {
      throw new Error(`${step.renderer} scene ${step.slideId} completed without producing ${rawOutput}`);
    }
    await normalizeExternalClip(rawOutput, step, logger, dryRun);
    if (!dryRun && fs.existsSync(rawOutput)) fs.unlinkSync(rawOutput);
  }

  if (!dryRun) {
    ensureDir(cacheDir);
    fs.copyFileSync(step.output, cached);
  }
}

function cacheKey(step: RenderSlideStep): string {
  const files = [step.input, ...step.inputs, ...step.rendererAssets, ...step.layers.filter((l) => l.type === "image").map((l) => l.absPath)]
    .filter(Boolean)
    .map((file) => {
      try { const s = fs.statSync(file); return [file, s.size, s.mtimeMs]; }
      catch { return [file, 0, 0]; }
    });
  const data = {
    cacheVersion: 1,
    ...(step.renderer === "blender" ? { rendererRevision: 3 } : {}),
    renderer: step.renderer, template: step.rendererTemplate, params: step.rendererParams,
    duration: step.duration, width: step.width, height: step.height, fps: step.fps,
    effect: step.effect, color: step.color, captions: step.captions, layers: step.layers, files,
  };
  return crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex").slice(0, 24);
}

async function normalizeExternalClip(stepInput: string, step: RenderSlideStep, logger: Logger, dryRun: boolean): Promise<void> {
  const vf = `scale=${step.width}:${step.height}:force_original_aspect_ratio=decrease,` +
    `pad=${step.width}:${step.height}:(ow-iw)/2:(oh-ih)/2:color=black,fps=${step.fps},format=yuv420p`;
  await runFfmpeg([
    "-y", "-i", stepInput, "-an", "-vf", vf,
    ...videoEncodeArgs(step.quality, step.fps), "-t", String(step.duration), step.output,
  ], `normalize ${step.renderer} scene ${step.slideId}`, logger, dryRun);
}
