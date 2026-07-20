import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Logger, ValidationError, ensureDir } from "./fileUtils";
import { runCommand } from "./runCommand";
import type { RenderSlideStep } from "./types";
import schema from "../schema/timeline.schema.json";

// Single source of truth: schema/$defs.remotionTemplate, also what the AI director and
// engineCapabilities.mjs read. A template accepted here but not there (or vice versa) is
// exactly the drift this repo's capability system exists to prevent.
const TEMPLATES = new Set(schema.$defs.remotionTemplate.enum);

export async function renderRemotionScene(step: RenderSlideStep, logger: Logger, dryRun: boolean): Promise<void> {
  const template = step.rendererTemplate ?? "";
  if (!TEMPLATES.has(template)) {
    throw new ValidationError(`slide ${step.slideId}: unknown Remotion template "${template}"`);
  }
  if ((template === "page_flip" || template === "gl_transition") && step.rendererAssets.length < 2) {
    throw new ValidationError(`slide ${step.slideId}: Remotion ${template} requires at least 2 assets`);
  }

  const publicDir = path.resolve("public", "hybrid-scenes", safeName(step.slideId));
  ensureDir(publicDir);
  const assets = step.rendererAssets.map((source, index) => {
    const digest = crypto.createHash("sha1").update(source).digest("hex").slice(0, 8);
    const name = `${index}-${digest}${path.extname(source).toLowerCase()}`;
    if (!dryRun) fs.copyFileSync(source, path.join(publicDir, name));
    return `hybrid-scenes/${safeName(step.slideId)}/${name}`;
  });

  const propsFile = path.resolve(path.dirname(step.output), `${step.slideId}-remotion-props.json`);
  const props = { template, assets, params: step.rendererParams, durationInFrames: Math.round(step.duration * step.fps) };
  if (!dryRun) fs.writeFileSync(propsFile, JSON.stringify(props), "utf8");

  const cli = path.resolve("node_modules", "@remotion", "cli", "remotion-cli.js");
  const frames = Math.max(1, Math.round(step.duration * step.fps));
  await runCommand(process.execPath, [
    cli, "render", "gpu-effects/index.ts", "HybridScene", step.output,
    "--codec=h264", "--muted", `--props=${propsFile}`, `--frames=0-${frames - 1}`,
    `--width=${step.width}`, `--height=${step.height}`, `--fps=${step.fps}`,
  ], `Remotion scene ${step.slideId}`, logger, dryRun);
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, "_");
}
