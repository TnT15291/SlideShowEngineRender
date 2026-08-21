import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import ffmpegStatic from "ffmpeg-static";

const root = process.cwd();
const node = process.execPath;
const ffmpeg = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" }).status === 0 ? "ffmpeg" : ffmpegStatic;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 32 << 20, ...options });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

test("release smoke renders single-image, native creative, multi-image and graded-card timelines", { timeout: 120_000 }, (t) => {
  assert.ok(ffmpeg, "FFmpeg is required for release smoke renders");
  const id = `release-smoke-${process.pid}-${Date.now()}`;
  const jobRel = `projects/${id}`;
  const jobDir = path.join(root, jobRel);
  const inputDir = path.join(jobDir, "input");
  fs.mkdirSync(inputDir, { recursive: true });
  t.after(() => fs.rmSync(jobDir, { recursive: true, force: true }));

  for (let i = 0; i < 4; i++) {
    run(ffmpeg, [
      "-v", "error", "-y", "-f", "lavfi", "-i",
      `color=c=${["0x9b4058", "0xd49a45", "0x47796c", "0x526b94"][i]}:s=640x360`,
      "-frames:v", "1", path.join(inputDir, `${i + 1}.jpg`),
    ]);
  }

  const cases = [
    { name: "single", slide: { image: `${jobRel}/input/1.jpg`, effect: "slow_zoom_in" } },
    { name: "creative", slide: { image: `${jobRel}/input/2.jpg`, effect: "tilt_shift", tiltShift: { focusY: 0.45, bandHeight: 0.25, blur: 8 } } },
    { name: "multi", slide: { images: [1, 2, 3, 4].map((n) => `${jobRel}/input/${n}.jpg`), effect: "photo_strip_left" } },
    // A DESIGNED CARD UNDER A FULL FILM GRADE.
    //
    // layer_scene used to ignore `slide.color` and `timeline.color` outright: the grade the
    // rest of the film was wearing stopped at the card, so every text card in all 25 recipes
    // rendered ungraded next to graded photographs. It is wired through now — after
    // compositing, before the encode — which means the whole grade vocabulary meets the
    // layer path for the first time: a 3D LUT, glow, vignette, grain and the cinematic bars,
    // none of which the three cases above exercise at all (they carry no `color` key).
    //
    // The text sits clear of the bars on purpose. A card whose words fall under one is a
    // separate failure with its own gate (preflightTimeline), and this case is about whether
    // the filter graph survives ffmpeg, not about where the words are.
    {
      name: "graded-card",
      color: {
        lut: "assets/luts/teal_orange_01.cube",
        contrast: 1.12, saturation: 0.9, temperature: 5200,
        glow: 0.18, vignette: true, grain: 8, letterbox: 2.39,
      },
      slide: {
        effect: "layer_scene",
        layers: [
          // Light, and deliberately so: a dark card would be the same black as the bars, and
          // an assertion that cannot tell a painted bar from the background it covers proves
          // nothing. Against this the bars are unmistakable — 16 where the card reads 210.
          { type: "rect", x: 0, y: 0, width: 640, height: 360, color: "#EDE6D8", opacity: 1 },
          { type: "image", path: `${jobRel}/input/1.jpg`, x: 40, y: 60, width: 240, height: 240 },
          {
            type: "text", text: "Linh & Nam", font: "fonts/YesevaOne-Regular.ttf",
            size: 24, color: "#21140F", align: "center", x: 320, y: 150, width: 280, height: 40,
          },
        ],
      },
    },
  ];

  for (const entry of cases) {
    const output = `${jobRel}/output/${entry.name}.mp4`;
    const timeline = {
      project: { name: `Release smoke ${entry.name}`, width: 640, height: 360, fps: 24, quality: "draft" },
      music: [], audio: { fade_in: 0, fade_out: 0, crossfade: 0 }, overlays: [],
      ...(entry.color ? { color: entry.color } : {}),
      output: { path: output },
      slides: [{ id: entry.name, duration: 2, transition: { type: "none", duration: 0 }, captions: [], ...entry.slide }],
    };
    const timelinePath = path.join(jobDir, `${entry.name}.json`);
    fs.writeFileSync(timelinePath, JSON.stringify(timeline, null, 2));
    run(node, ["--import", "tsx", "src/index.ts", "--timeline", timelinePath, "--job-dir", jobDir], {
      env: { ...process.env, FFMPEG_PATH: ffmpeg },
    });
    const outputPath = path.join(root, output);
    assert.ok(fs.statSync(outputPath).size > 1_000, `${entry.name} output is empty`);
    run(ffmpeg, ["-v", "error", "-i", outputPath, "-f", "null", "-"]);
    if (entry.color?.letterbox) assertBarsArePainted(outputPath, entry.name);
  }
});

/**
 * A card that decodes is not a card that was graded — an ungraded layer_scene renders
 * perfectly well, which is exactly how the grade came to be missing from every text card in
 * the library without a single test going red. So read the pixels for the one part of the
 * grade that is unambiguous at a glance: the bars are drawn last and drawn opaque, so if
 * they reached the frame the top and bottom rows are black and the card between them is not.
 *
 * Measured both ways before the thresholds were chosen: with the letterbox those rows peak
 * at 16, without it they peak at 207. Rows within 3px of the boundary are not asserted —
 * chroma subsampling smears the edge, and the margin everywhere else is 12x.
 */
function assertBarsArePainted(outputPath, name) {
  const bar = Math.round((360 - 640 / 2.39) / 2);
  const frame = spawnSync(ffmpeg, [
    "-v", "error", "-i", outputPath, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { maxBuffer: 32 << 20 });
  assert.equal(frame.status, 0, `${name}: could not read a frame back`);
  const rgb = frame.stdout;
  assert.equal(rgb.length, 640 * 360 * 3, `${name}: unexpected frame size`);
  const brightest = (row) => {
    let peak = 0;
    for (let x = 0; x < 640; x++) {
      const o = (row * 640 + x) * 3;
      peak = Math.max(peak, rgb[o], rgb[o + 1], rgb[o + 2]);
    }
    return peak;
  };
  for (const row of [2, 10, 20, 360 - bar + 4, 357]) {
    assert.ok(brightest(row) <= 40,
      `${name}: row ${row} is inside a ${bar}px bar but reads ${brightest(row)} — the letterbox never reached the frame`);
  }
  for (const row of [90, 180, 270]) {
    assert.ok(brightest(row) >= 120,
      `${name}: row ${row} is inside the card but reads ${brightest(row)} — the bars ate the picture`);
  }
}
