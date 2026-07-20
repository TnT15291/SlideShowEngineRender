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

test("release smoke renders single-image, native creative, and multi-image timelines", { timeout: 120_000 }, (t) => {
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
  ];

  for (const entry of cases) {
    const output = `${jobRel}/output/${entry.name}.mp4`;
    const timeline = {
      project: { name: `Release smoke ${entry.name}`, width: 640, height: 360, fps: 24, quality: "draft" },
      music: [], audio: { fade_in: 0, fade_out: 0, crossfade: 0 }, overlays: [],
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
  }
});
