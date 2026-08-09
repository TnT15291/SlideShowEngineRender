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
  assert.match(filter, /clip\(min\(W-0\.5-X,H-0\.5-Y\),0,1\)/, "br=0 feathers off its own two edges");
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

const alphaPlane = (radius: Parameters<typeof roundedMaskGeq>[0], width: number, height: number) => {
  const rendered = spawnSync(ffmpegBin(), [
    "-v", "error", "-f", "lavfi", "-i", `color=white:s=${width}x${height}:d=0.1`,
    "-vf", `format=rgba,${roundedMaskGeq(radius)}`,
    "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ], { windowsHide: true, maxBuffer: width * height * 8 });
  assert.equal(rendered.status, 0, rendered.stderr?.toString());
  return (x: number, y: number) => rendered.stdout[(y * width + x) * 4 + 3];
};

test("arch mask makes only the top corners transparent", () => {
  const width = 32;
  const height = 48;
  const alpha = alphaPlane([16, 16, 0, 0], width, height);
  assert.equal(alpha(0, 0), 0);
  assert.equal(alpha(width - 1, 0), 0);
  // The square corners keep their pixel; like every straight edge they carry the 1px feather.
  assert.equal(alpha(0, height - 1), 127);
  assert.equal(alpha(width - 1, height - 1), 127);
  assert.ok(alpha(Math.floor(width / 2), 0) > alpha(0, 0));
  assert.equal(alpha(Math.floor(width / 2), 1), 255);
  assert.equal(alpha(1, Math.floor(height / 2)), 255);
});

// A zero corner used to return a flat 1 while its rounded neighbours feathered their
// perimeter to 0.5, so alpha stepped 127 -> 255 exactly at the quadrant midline — a hairline
// down both sides of every arch at its real 540x890 size. The edges must now read the same
// from top to bottom, and the interior must stay fully opaque (the trap radius 0 falls into
// if it is fed through the arc formula).
test("arch mask carries one continuous edge feather across the quadrant join", () => {
  const width = 540;
  const height = 890;
  const alpha = alphaPlane([260, 260, 0, 0], width, height);

  for (const y of [444, 445]) {
    assert.equal(alpha(0, y), 127, `left edge at y=${y}`);
    assert.equal(alpha(width - 1, y), 127, `right edge at y=${y}`);
    assert.equal(alpha(5, y), 255, `interior at y=${y}`);
  }
  for (const x of [0, Math.floor(width / 2) - 1, Math.floor(width / 2), width - 1]) {
    assert.equal(alpha(x, height - 1), 127, `bottom edge at x=${x}`);
  }

  // No step anywhere down the straight part of the side: below the arc the column is flat,
  // and the largest jump overall is the arc's own antialiasing, which the scalar mask shares.
  let worst = 0;
  for (let y = 1; y < height; y += 1) worst = Math.max(worst, Math.abs(alpha(0, y) - alpha(0, y - 1)));
  assert.ok(worst <= 15, `left edge steps by ${worst}, so a quadrant join is showing`);
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
