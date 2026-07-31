import fs from "node:fs";
import path from "node:path";
import { Logger, runFfmpeg, ValidationError } from "./fileUtils";
import { runCommand } from "./runCommand";
import type { RenderSlideStep } from "./types";
import schema from "../schema/timeline.schema.json";

// Single source of truth: schema/$defs.blenderTemplate — see renderRemotionScene.ts.
const TEMPLATES = new Set(schema.$defs.blenderTemplate.enum);
const MIN_ASSETS: Record<string, number> = {
  page_flip_3d: 2,
  photo_carousel_3d: 4,
  floating_collage_3d: 4,
};

export async function renderBlenderScene(step: RenderSlideStep, logger: Logger, dryRun: boolean): Promise<void> {
  const template = step.rendererTemplate ?? "";
  if (!TEMPLATES.has(template)) {
    throw new ValidationError(`slide ${step.slideId}: unknown Blender template "${template}"`);
  }
  const minAssets = MIN_ASSETS[template] ?? 1;
  if (step.rendererAssets.length < minAssets) {
    throw new ValidationError(`slide ${step.slideId}: Blender ${template} requires at least ${minAssets} assets`);
  }

  // WHERE THE SUBJECT IS — same merge, and for the same reason, as renderRemotionScene.ts:
  // the Blender path was the last one still cropping dead centre. `ring_spin_reveal` shows a
  // photo through a frustum-sized plane; without a focal point a portrait loses its faces.
  const focus = {
    ...(typeof step.focusX === "number" ? { focusX: step.focusX } : {}),
    ...(typeof step.focusY === "number" ? { focusY: step.focusY } : {}),
  };
  const jobFile = path.resolve(path.dirname(step.output), `${step.slideId}-blender-job.json`);
  if (!dryRun) fs.writeFileSync(jobFile, JSON.stringify({
    template,
    assets: step.rendererAssets,
    params: { ...step.rendererParams, ...focus },
    output: step.output,
    duration: step.duration,
    width: step.width,
    height: step.height,
    fps: step.fps,
  }), "utf8");

  const portable = process.env.LOCALAPPDATA
    ? path.join(process.env.LOCALAPPDATA, "Programs", "BlenderPortable-5.2", "blender-5.2.0-windows-x64", "blender.exe")
    : "";
  const blender = process.env.BLENDER_PATH || (portable && fs.existsSync(portable) ? portable : "blender");
  const worker = path.resolve("blender", "render_scene.py");
  await runCommand(blender, ["--background", "--python", worker, "--", jobFile], `Blender scene ${step.slideId}`, logger, dryRun);
  const frames = path.join(path.dirname(step.output), `${path.parse(step.output).name}-frames`, "frame_%04d.png");
  await runFfmpeg([
    "-y", "-framerate", String(step.fps), "-i", frames, "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-r", String(step.fps), step.output,
  ], `encode Blender frames ${step.slideId}`, logger, dryRun);
}
