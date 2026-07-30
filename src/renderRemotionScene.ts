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
const MIN_ASSETS: Record<string, number> = {
  page_flip: 2,
  gl_transition: 2,
  fly_in_duo: 2,
  corner_fly_four: 4,
  hero_filmstrip: 5,
  depth_parallax_stack: 4,
  radial_gallery: 6,
  contact_sheet_zoom: 9,
  ribbon_cascade: 6,
  aperture_reveal: 2,
  match_cut_windows: 3,
  checker_mosaic: 2,
  flash_burst: 2,
  shared_frame_morph: 4,
  dither_dissolve: 2,
  glass_refraction: 2,
  particle_dissolve: 2,
};

// Remotion resolves staticFile() against public/, but the engine's fonts live in fonts/ —
// where layouts/library.json, the caption filter and every other consumer already look for
// them. Publish rather than duplicate: a second committed copy is a second thing to keep in
// sync, and the failure mode of a stale font copy is silent (wrong face, or Vietnamese tone
// marks detaching — see gpu-effects/fonts.ts). Idempotent; a no-op after the first render.
function publishFonts(dryRun: boolean): void {
  const source = path.resolve("fonts");
  if (!fs.existsSync(source)) return;
  const target = path.resolve("public", "fonts");
  if (!dryRun) ensureDir(target);
  for (const name of fs.readdirSync(source)) {
    if (!/\.(ttf|otf|woff2?)$/i.test(name)) continue;
    const from = path.join(source, name);
    const to = path.join(target, name);
    if (fs.existsSync(to) && fs.statSync(to).size === fs.statSync(from).size) continue;
    if (!dryRun) fs.copyFileSync(from, to);
  }
}

export async function renderRemotionScene(step: RenderSlideStep, logger: Logger, dryRun: boolean): Promise<void> {
  const template = step.rendererTemplate ?? "";
  if (!TEMPLATES.has(template)) {
    throw new ValidationError(`slide ${step.slideId}: unknown Remotion template "${template}"`);
  }
  const minAssets = MIN_ASSETS[template] ?? 1;
  if (step.rendererAssets.length < minAssets) {
    throw new ValidationError(`slide ${step.slideId}: Remotion ${template} requires at least ${minAssets} assets`);
  }

  publishFonts(dryRun);

  const publicDir = path.resolve("public", "hybrid-scenes", safeName(step.slideId));
  ensureDir(publicDir);
  const assets = step.rendererAssets.map((source, index) => {
    const digest = crypto.createHash("sha1").update(source).digest("hex").slice(0, 8);
    const name = `${index}-${digest}${path.extname(source).toLowerCase()}`;
    if (!dryRun) fs.copyFileSync(source, path.join(publicDir, name));
    return `hybrid-scenes/${safeName(step.slideId)}/${name}`;
  });

  // WHERE THE SUBJECT IS. Every native effect in this engine crops around focusX/focusY —
  // that is the whole reason portraits keep their heads at 16:9 — and the hybrid renderer
  // was the one path that threw the answer away and cropped dead centre. It shows: a 2x2
  // gallery of wedding portraits, cover-fitted to a 1.8:1 tile with no focal point, cuts
  // every face off at the hairline. Merged into params rather than added as a fourth prop
  // because params is already the one channel every template reads, and an engine-derived
  // focus outranks anything a recipe could have written by hand.
  const focus = {
    ...(typeof step.focusX === "number" ? { focusX: step.focusX } : {}),
    ...(typeof step.focusY === "number" ? { focusY: step.focusY } : {}),
  };
  const propsFile = path.resolve(path.dirname(step.output), `${step.slideId}-remotion-props.json`);
  const props = {
    template,
    assets,
    params: { ...step.rendererParams, ...focus },
    durationInFrames: Math.round(step.duration * step.fps),
  };
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
