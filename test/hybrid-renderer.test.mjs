import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

const root = process.cwd();

test("hybrid timeline compiles renderer routing and emits a Remotion command", () => {
  const script = `
    import { readJson, Logger } from "./src/fileUtils.ts";
    import { normalizeTimeline } from "./src/normalizeTimeline.ts";
    import { validateTimeline } from "./src/validateTimeline.ts";
    import { compileTimeline } from "./src/compileTimeline.ts";
    import { renderSlides } from "./src/renderSlide.ts";
    const raw = readJson("timeline/hybrid-renderer-example.json");
    const timeline = validateTimeline(normalizeTimeline(raw), process.cwd());
    const plan = compileTimeline(timeline, process.cwd(), "temp");
    await renderSlides(plan, new Logger("temp/hybrid-test-logs"), true);
    console.log("RESULT=" + JSON.stringify({renderer:plan.steps[0].renderer, template:plan.steps[0].rendererTemplate}));
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.match(/^RESULT=(.*)$/m)?.[1] ?? "null");
  assert.deepEqual(result, { renderer: "remotion", template: "page_flip" });
  assert.match(run.stdout, /Remotion scene remotion-page-flip: command logged/);
});

test("Blender scenes compile to a headless worker command", () => {
  const script = `
    import { readJson, Logger } from "./src/fileUtils.ts";
    import { normalizeTimeline } from "./src/normalizeTimeline.ts";
    import { validateTimeline } from "./src/validateTimeline.ts";
    import { compileTimeline } from "./src/compileTimeline.ts";
    import { renderSlides } from "./src/renderSlide.ts";
    const raw = readJson("timeline/hybrid-renderer-example.json");
    raw.slides[0].renderer = "blender";
    raw.slides[0].template = "page_flip_3d";
    const timeline = validateTimeline(normalizeTimeline(raw), process.cwd());
    const plan = compileTimeline(timeline, process.cwd(), "temp");
    await renderSlides(plan, new Logger("temp/hybrid-blender-test-logs"), true);
    console.log("RESULT=" + plan.steps[0].renderer);
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.match(run.stdout, /^RESULT=blender$/m);
  assert.match(run.stdout, /Blender scene remotion-page-flip: command logged/);
  assert.match(run.stdout, /normalize blender scene remotion-page-flip: command logged/);
});

test("GPU/trending templates (gl_transition, glass_frame, confetti_bloom, ring_spin_reveal, photo_frame_orbit) compile and route correctly", () => {
  const script = `
    import { readJson, Logger } from "./src/fileUtils.ts";
    import { normalizeTimeline } from "./src/normalizeTimeline.ts";
    import { validateTimeline } from "./src/validateTimeline.ts";
    import { compileTimeline } from "./src/compileTimeline.ts";
    import { renderSlides } from "./src/renderSlide.ts";
    const raw = readJson("timeline/hybrid-gpu-trending-example.json");
    const timeline = validateTimeline(normalizeTimeline(raw), process.cwd());
    const plan = compileTimeline(timeline, process.cwd(), "temp");
    await renderSlides(plan, new Logger("temp/hybrid-gpu-test-logs"), true);
    console.log("RESULT=" + JSON.stringify(plan.steps.map((s) => ({ renderer: s.renderer, template: s.rendererTemplate }))));
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(run.stdout.match(/^RESULT=(.*)$/m)?.[1] ?? "null");
  assert.deepEqual(result, [
    { renderer: "remotion", template: "gl_transition" },
    { renderer: "remotion", template: "glass_frame" },
    { renderer: "remotion", template: "confetti_bloom" },
    { renderer: "blender", template: "ring_spin_reveal" },
    { renderer: "blender", template: "photo_frame_orbit" },
  ]);
});

test("gl_transition rejects a single-asset slide (needs a from/to pair)", () => {
  const script = `
    import { readJson, Logger } from "./src/fileUtils.ts";
    import { normalizeTimeline } from "./src/normalizeTimeline.ts";
    import { validateTimeline } from "./src/validateTimeline.ts";
    import { compileTimeline } from "./src/compileTimeline.ts";
    import { renderSlides } from "./src/renderSlide.ts";
    const raw = readJson("timeline/hybrid-gpu-trending-example.json");
    raw.slides = [raw.slides[0]];
    raw.slides[0].assets = ["public/gpu-effects/page-a.jpg"];
    const timeline = validateTimeline(normalizeTimeline(raw), process.cwd());
    const plan = compileTimeline(timeline, process.cwd(), "temp");
    await renderSlides(plan, new Logger("temp/hybrid-gpu-test-logs"), true);
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /gl_transition requires at least 2 assets/);
});
