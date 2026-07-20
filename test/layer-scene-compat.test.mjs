import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runTs = (source) => spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
  cwd: process.cwd(), encoding: "utf8",
});

test("layer scenes avoid zoompan expressions for compatibility", () => {
  const result = runTs(`
    import { buildSlideArgs } from "./src/buildFfmpegCommand.ts";
    const step = {
      type: "render_slide",
      slideId: "compat",
      renderer: "ffmpeg",
      rendererAssets: [],
      rendererParams: {},
      input: "input/001.jpg",
      inputs: ["input/001.jpg"],
      layers: [{
        type: "image",
        absPath: "input/001.jpg",
        width: 1920,
        height: 1080,
        fit: "contain",
        motion: "zoom_in",
        motionStrength: 0.03,
        focusX: 0.5,
        focusY: 0.5,
        opacity: 1,
        start: 0,
        end: 5,
        animation: "none",
        frame: undefined,
        rotation: 0,
        technicalColor: undefined,
      }],
      output: "temp/x.mp4",
      duration: 5,
      requestedEffect: "still",
      effect: "layer_scene",
      easing: "gentle",
      autoPortrait: false,
      transition: { type: "none", duration: 0 },
      captions: [],
      width: 1920,
      height: 1080,
      fps: 30,
      quality: "draft",
    };
    const args = buildSlideArgs(step);
    const filter = args[args.indexOf("-filter_complex") + 1];
    console.log(filter);
  `);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /scale=1920:1080/);
  assert.doesNotMatch(result.stdout, /zoompan=/);
});
