import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildLayerSceneArgs, roundedMaskGeq } from "./buildLayerSceneCommand";
import { ffmpegBin } from "./fileUtils";
import { QUALITY_PRESETS } from "./quality";
import type { RenderSlideStep } from "./types";
import { validateTimeline } from "./validateTimeline";

const legacyMask = (radius: number) => {
  const dx = `max(max(${radius}-X,X-(W-1-${radius})),0)`;
  const dy = `max(max(${radius}-Y,Y-(H-1-${radius})),0)`;
  return `geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${radius}+0.5-hypot(${dx},${dy}),0,1)'`;
};

test("scalar radius keeps the existing filter byte-for-byte", () => {
  assert.equal(roundedMaskGeq(28), legacyMask(28));
});

test("four-corner radius addresses tl/tr/br/bl independently, including zero", () => {
  const filter = roundedMaskGeq([12, 10, 0, 4]);
  assert.match(filter, /if\(lt\(X,W\/2\),if\(lt\(Y,H\/2\)/);
  assert.match(filter, /clip\(12\+0\.5-hypot\(max\(12-X,0\),max\(12-Y,0\)\),0,1\)/);
  assert.match(filter, /clip\(10\+0\.5-hypot\(max\(X-\(W-1-10\),0\),max\(10-Y,0\)\),0,1\)/);
  assert.ok(filter.endsWith(",1))'"), "br=0 must select an unmodified alpha mask");
  assert.match(filter, /clip\(4\+0\.5-hypot\(max\(4-X,0\),max\(Y-\(H-1-4\),0\)\),0,1\)/);
});

test("border padding happens before a four-corner mask", () => {
  const step = {
    type: "render_slide",
    slideId: "arch",
    renderer: "ffmpeg",
    rendererAssets: [],
    rendererParams: {},
    input: "photo.jpg",
    inputs: ["photo.jpg"],
    layers: [{
      type: "image",
      path: "photo.jpg",
      absPath: "photo.jpg",
      x: 0,
      y: 0,
      width: 100,
      height: 140,
      opacity: 1,
      start: 0,
      end: 1,
      animation: "none",
      fit: "cover",
      frame: { radius: [40, 40, 0, 0], border: 6 },
    }],
    output: "out.mp4",
    duration: 1,
    effect: "layer_scene",
    requestedEffect: "layer_scene",
    autoPortrait: false,
    transition: { type: "none", duration: 0 },
    captions: [],
    width: 100,
    height: 140,
    fps: 30,
    quality: QUALITY_PRESETS.draft,
  } satisfies RenderSlideStep;
  const args = buildLayerSceneArgs(step);
  const filter = args[args.indexOf("-filter_complex") + 1];
  assert.ok(filter.indexOf("pad=100:140:6:6") < filter.indexOf("geq="));
});

test("arch mask makes only the top corners transparent", () => {
  const width = 32;
  const height = 48;
  const filter = `format=rgba,${roundedMaskGeq([16, 16, 0, 0])}`;
  const rendered = spawnSync(ffmpegBin(), [
    "-v", "error", "-f", "lavfi", "-i", `color=white:s=${width}x${height}:d=0.1`,
    "-vf", filter, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ], { windowsHide: true, maxBuffer: width * height * 8 });
  assert.equal(rendered.status, 0, rendered.stderr?.toString());
  const alpha = (x: number, y: number) => rendered.stdout[(y * width + x) * 4 + 3];
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(width - 1, 0), 0);
  assert.equal(alpha(0, height - 1), 255);
  assert.equal(alpha(width - 1, height - 1), 255);
  assert.ok(alpha(Math.floor(width / 2), 0) > alpha(0, 0));
  assert.equal(alpha(Math.floor(width / 2), 1), 255);
  assert.equal(alpha(0, Math.floor(height / 2)), 255);
});

test("arch mask characterizes the one-pixel alpha join at full slot size", () => {
  const width = 540;
  const height = 890;
  const rendered = spawnSync(ffmpegBin(), [
    "-v", "error", "-f", "lavfi", "-i", `color=white:s=${width}x${height}:d=0.1`,
    "-vf", `format=rgba,${roundedMaskGeq([260, 260, 0, 0])}`,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ], { windowsHide: true, maxBuffer: width * height * 8 });
  assert.equal(rendered.status, 0, rendered.stderr?.toString());
  const alpha = (x: number, y: number) => rendered.stdout[(y * width + x) * 4 + 3];

  // Characterization only: the rounded upper quadrants feather their outside edge,
  // while the zero-radius lower quadrants preserve alpha. Fixing this needs a separate
  // edge-feather pass; feeding radius 0 through the old formula would dim half the frame.
  assert.equal(alpha(0, 444), 127);
  assert.equal(alpha(width - 1, 444), 127);
  assert.equal(alpha(0, 445), 255);
  assert.equal(alpha(width - 1, 445), 255);
});

const timelineWithRadius = (radius: unknown) => ({
  project: { name: "radius", width: 100, height: 140, fps: 30, quality: "draft" },
  music: [],
  audio: { fade_in: 0, fade_out: 0, crossfade: 0 },
  output: { path: "out.mp4" },
  overlays: [],
  slides: [{
    id: "arch",
    renderer: "ffmpeg",
    assets: [],
    params: {},
    layers: [{
      type: "image",
      path: import.meta.filename,
      fit: "cover",
      frame: { radius },
      x: 0,
      y: 0,
      width: 100,
      height: 140,
      opacity: 1,
      start: 0,
      animation: "none",
    }],
    duration: 2,
    effect: "layer_scene",
    transition: { type: "none", duration: 0 },
    captions: [],
  }],
});

test("timeline schema accepts a valid four-corner radius", () => {
  const timeline = validateTimeline(timelineWithRadius([40, 40, 0, 0]), process.cwd());
  const layer = timeline.slides[0].layers?.[0];
  assert.equal(layer?.type, "image");
  if (layer?.type !== "image") throw new Error("fixture must validate as an image layer");
  assert.deepEqual(layer.frame?.radius, [40, 40, 0, 0]);
});

test("timeline validation rejects malformed or oversized corner radii", () => {
  assert.throws(
    () => validateTimeline(timelineWithRadius([20, 20, 0]), process.cwd()),
    /Timeline schema errors/,
  );
  assert.throws(
    () => validateTimeline(timelineWithRadius([51, 40, 0, 0]), process.cwd()),
    /must be <= half the shorter side/,
  );
});
