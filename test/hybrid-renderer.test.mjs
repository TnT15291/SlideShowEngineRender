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

test("multi-photo fly-in, filmstrip, carousel, and collage signatures route with their full asset sets", () => {
  const script = `
    import { readJson, Logger } from "./src/fileUtils.ts";
    import { normalizeTimeline } from "./src/normalizeTimeline.ts";
    import { validateTimeline } from "./src/validateTimeline.ts";
    import { compileTimeline } from "./src/compileTimeline.ts";
    import { renderSlides } from "./src/renderSlide.ts";
    const raw = readJson("timeline/hybrid-renderer-example.json");
    const source = raw.slides[0];
    const asset = "public/gpu-effects/page-a.jpg";
    const specs = [
      ["remotion", "fly_in_duo", 2],
      ["remotion", "corner_fly_four", 4],
      ["remotion", "hero_filmstrip", 5],
      ["blender", "photo_carousel_3d", 4],
      ["blender", "floating_collage_3d", 4],
      ["remotion", "depth_parallax_stack", 4],
      ["remotion", "radial_gallery", 6],
      ["remotion", "contact_sheet_zoom", 9],
      ["remotion", "ribbon_cascade", 6],
      ["remotion", "aperture_reveal", 2],
      ["remotion", "match_cut_windows", 3],
      ["remotion", "checker_mosaic", 2],
      ["remotion", "flash_burst", 2],
      ["remotion", "shared_frame_morph", 4],
      ["remotion", "kinetic_typography", 1],
      ["remotion", "dither_dissolve", 2],
      ["remotion", "image_echo_trail", 1],
      ["remotion", "glass_refraction", 2],
      ["remotion", "audio_reactive", 1],
      ["remotion", "particle_dissolve", 2],
    ];
    raw.slides = specs.map(([renderer, template, count], i) => ({
      ...source, id: "new-signature-" + i, renderer, template,
      assets: Array.from({length: count}, () => asset),
    }));
    const timeline = validateTimeline(normalizeTimeline(raw), process.cwd());
    const plan = compileTimeline(timeline, process.cwd(), "temp");
    await renderSlides(plan, new Logger("temp/new-signature-test-logs"), true);
    console.log("RESULT=" + JSON.stringify(plan.steps.map((s) => s.rendererTemplate)));
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.deepEqual(JSON.parse(run.stdout.match(/^RESULT=(.*)$/m)?.[1] ?? "null"), [
    "fly_in_duo", "corner_fly_four", "hero_filmstrip",
    "photo_carousel_3d", "floating_collage_3d",
    "depth_parallax_stack", "radial_gallery", "contact_sheet_zoom",
    "ribbon_cascade", "aperture_reveal", "match_cut_windows",
    "checker_mosaic", "flash_burst", "shared_frame_morph",
    "kinetic_typography", "dither_dissolve",
    "image_echo_trail", "glass_refraction", "audio_reactive",
    "particle_dissolve",
  ]);
});
