import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runTs = (source) => spawnSync(
  process.execPath,
  ["--import", "tsx", "--input-type=module", "--eval", source],
  { cwd: process.cwd(), encoding: "utf8" },
);

test("collage grids center an incomplete final row", () => {
  const result = runTs(`
    import { buildSlideArgs } from "./src/buildFfmpegCommand.ts";
    const base = { type:"render_slide", slideId:"grid", renderer:"ffmpeg", rendererAssets:[], rendererParams:{}, input:"input/001.jpg", layers:[], output:"temp/x.mp4", duration:6, effect:"collage_grid", requestedEffect:"collage_grid", autoPortrait:false, transition:{type:"none",duration:0}, captions:[], width:1920,height:1080,fps:30,quality:"draft" };
    const graph = (count) => {
      const inputs = Array.from({length:count}, (_, i) => \`input/00\${i + 1}.jpg\`);
      const args = buildSlideArgs({...base, inputs});
      return args[args.indexOf("-filter_complex") + 1];
    };
    console.log(JSON.stringify({five:graph(5), six:graph(6)}));
  `);

  assert.equal(result.status, 0, result.stderr);
  const { five, six } = JSON.parse(result.stdout.trim());

  assert.match(five, /\[cg2\]\[c3\]overlay=372:557/);
  assert.match(five, /\[cg3\]\[c4\]overlay=976:557/);
  assert.match(six, /\[cg2\]\[c3\]overlay=70:557/);
  assert.match(six, /\[cg4\]\[c5\]overlay=1278:557/);
});
