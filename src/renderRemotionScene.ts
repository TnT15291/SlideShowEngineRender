import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Logger, ValidationError, ensureDir } from "./fileUtils";
import { runCommand } from "./runCommand";
import type { RenderSlideStep } from "./types";

const TEMPLATES = new Set([
  "page_flip", "filmstrip", "title", "portrait_echo", "triptych",
  "card_gallery", "paper_peel", "panel_reveal", "floating_frame", "light_rays",
]);

export async function renderRemotionScene(step: RenderSlideStep, logger: Logger, dryRun: boolean): Promise<void> {
  const template = step.rendererTemplate ?? "";
  if (!TEMPLATES.has(template)) {
    throw new ValidationError(`slide ${step.slideId}: unknown Remotion template "${template}"`);
  }
  if (template === "page_flip" && step.rendererAssets.length < 2) {
    throw new ValidationError(`slide ${step.slideId}: Remotion page_flip requires at least 2 assets`);
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
