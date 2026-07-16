import fs from "node:fs";
import path from "node:path";
import { Logger, runFfmpeg, ValidationError } from "./fileUtils";
import { runCommand } from "./runCommand";
import type { RenderSlideStep } from "./types";

const TEMPLATES = new Set(["page_flip_3d", "camera_gallery_3d"]);

export async function renderBlenderScene(step: RenderSlideStep, logger: Logger, dryRun: boolean): Promise<void> {
  const template = step.rendererTemplate ?? "";
  if (!TEMPLATES.has(template)) {
    throw new ValidationError(`slide ${step.slideId}: unknown Blender template "${template}"`);
  }
  if (template === "page_flip_3d" && step.rendererAssets.length < 2) {
    throw new ValidationError(`slide ${step.slideId}: Blender page_flip_3d requires at least 2 assets`);
  }

  const jobFile = path.resolve(path.dirname(step.output), `${step.slideId}-blender-job.json`);
  if (!dryRun) fs.writeFileSync(jobFile, JSON.stringify({
    template,
    assets: step.rendererAssets,
    params: step.rendererParams,
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
