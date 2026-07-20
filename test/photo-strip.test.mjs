import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runTs = (source) => spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
  cwd: process.cwd(), encoding: "utf8",
});

test("film rolls move slowly with slim unbranded rails", () => {
  const result = runTs(`
    import { buildSlideArgs } from "./src/buildFfmpegCommand.ts";
    const base = { type:"render_slide", slideId:"roll", renderer:"ffmpeg", rendererAssets:[], rendererParams:{}, input:"input/001.jpg", inputs:["input/001.jpg","input/002.jpg","input/003.jpg","input/004.jpg"], layers:[], output:"temp/x.mp4", duration:10, requestedEffect:"film_roll_up", easing:"gentle", autoPortrait:false, transition:{type:"none",duration:0}, captions:[], width:1920,height:1080,fps:30,quality:"draft" };
    const args = buildSlideArgs({...base,effect:"film_roll_up"});
    console.log(args[args.indexOf("-filter_complex")+1]);
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\*H\*0\.62/);
  assert.doesNotMatch(result.stdout, /FUJIFILM/);
});

test("borderless photo strips compile vertically and horizontally", () => {
  const result = runTs(`
    import { buildSlideArgs } from "./src/buildFfmpegCommand.ts";
    const base = { type:"render_slide", slideId:"strip", renderer:"ffmpeg", rendererAssets:[], rendererParams:{position:"right"}, input:"input/001.jpg", inputs:["input/001.jpg","input/002.jpg","input/003.jpg","input/004.jpg"], layers:[], output:"temp/x.mp4", duration:10, requestedEffect:"photo_strip_up", easing:"gentle", autoPortrait:false, transition:{type:"none",duration:0}, captions:[], width:1920,height:1080,fps:30,quality:"draft" };
    const graph = (effect) => { const a=buildSlideArgs({...base,effect,requestedEffect:effect}); return a[a.indexOf("-filter_complex")+1]; };
    console.log(JSON.stringify([graph("photo_strip_up"),graph("photo_strip_left"),graph("photo_strip_right")]));
  `);
  assert.equal(result.status, 0, result.stderr);
  const graphs = JSON.parse(result.stdout.trim());
  assert.match(graphs[0], /vstack=inputs=4/);
  assert.match(graphs[0], /W-w-115/);
  assert.match(graphs[1], /hstack=inputs=4/);
  assert.match(graphs[2], /hstack=inputs=4/);
  assert.ok(graphs.every((g) => !/sprocket|FUJIFILM/.test(g)));
});
