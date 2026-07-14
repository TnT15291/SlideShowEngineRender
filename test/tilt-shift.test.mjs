import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runTs(source) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

test("tilt_shift normalizes defaults and compiles a native masked blur graph", () => {
  const result = runTs(`
    import { normalizeTimeline } from "./src/normalizeTimeline.ts";
    import { validateTimeline } from "./src/validateTimeline.ts";
    import { compileTimeline } from "./src/compileTimeline.ts";
    import { buildSlideArgs, isImplementedEffect } from "./src/buildFfmpegCommand.ts";
    const raw = {
      project: { name: "test", width: 640, height: 360, fps: 30, quality: "draft" },
      music: [], audio: {}, output: { path: "output/test.mp4" }, overlays: [],
      slides: [{ id: "s1", image: "input/008.jpg", duration: 3, effect: "tiltshift", transition: { type: "none", duration: 0 }, captions: [] }]
    };
    const normalized = normalizeTimeline(raw);
    const timeline = validateTimeline(normalized, process.cwd());
    const step = compileTimeline(timeline, process.cwd(), "temp").steps[0];
    const args = buildSlideArgs(step);
    const graph = args[args.indexOf("-vf") + 1];
    console.log(JSON.stringify({ config: step.tiltShift, graph, implemented: isImplementedEffect("tilt_shift") }));
  `);
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout.trim());
  assert.deepEqual(value.config, { focusY: 0.5, bandHeight: 0.22, blur: 14 });
  assert.equal(value.implemented, true);
  assert.match(value.graph, /gblur=sigma=14\.00/);
  assert.match(value.graph, /maskedmerge/);
});

test("tiltShift controls are rejected on unrelated effects", () => {
  const result = runTs(`
    import { normalizeTimeline } from "./src/normalizeTimeline.ts";
    import { validateTimeline } from "./src/validateTimeline.ts";
    const raw = {
      project: { name: "test", width: 640, height: 360, fps: 30, quality: "draft" },
      music: [], audio: {}, output: { path: "output/test.mp4" }, overlays: [],
      slides: [{ id: "s1", image: "input/001.jpg", duration: 3, effect: "still", tiltShift: { focusY: 0.5, bandHeight: 0.2, blur: 10 }, transition: { type: "none", duration: 0 }, captions: [] }]
    };
    try { validateTimeline(normalizeTimeline(raw), process.cwd()); process.exit(2); }
    catch (error) { console.error(error.message); process.exit(error.message.includes("only applies to effect tilt_shift") ? 0 : 3); }
  `);
  assert.equal(result.status, 0, result.stderr);
});

test("the native creative effects compile to their intended FFmpeg filters", () => {
  const result = runTs(`
    import { normalizeTimeline } from "./src/normalizeTimeline.ts";
    import { validateTimeline } from "./src/validateTimeline.ts";
    import { compileTimeline } from "./src/compileTimeline.ts";
    import { buildSlideArgs } from "./src/buildFfmpegCommand.ts";
    const effects = ["dream_glow", "prism_split", "spotlight_focus", "mirror_split"];
    const raw = {
      project: { name: "test", width: 640, height: 360, fps: 30, quality: "draft" },
      music: [], audio: {}, output: { path: "output/test.mp4" }, overlays: [],
      slides: effects.map((effect, i) => ({ id: "s" + i, image: "input/008.jpg", duration: 3, effect, transition: { type: "none", duration: 0 }, captions: [] }))
    };
    const timeline = validateTimeline(normalizeTimeline(raw), process.cwd());
    const graphs = compileTimeline(timeline, process.cwd(), "temp").steps.map((step) => {
      const args = buildSlideArgs(step); return args[args.indexOf("-vf") + 1];
    });
    console.log(JSON.stringify(graphs));
  `);
  assert.equal(result.status, 0, result.stderr);
  const graphs = JSON.parse(result.stdout.trim());
  assert.match(graphs[0], /blend=all_mode=screen/);
  assert.match(graphs[1], /rgbashift=/);
  assert.match(graphs[2], /vignette=/);
  assert.match(graphs[3], /hstack=inputs=2/);
});
