import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();

function minimalJpeg(width, height) {
  const be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
  const payload = Buffer.concat([
    Buffer.from([8]), be(height), be(width), Buffer.from([1, 1, 0x11, 0]),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xc0]), be(payload.length + 2), payload,
    Buffer.from([0xff, 0xd9]),
  ]);
}

test("portrait contain with zoom is made face-safe using effective render geometry", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-safe-"));
  fs.writeFileSync(path.join(dir, "portrait.jpg"), minimalJpeg(884, 1280));

  const script = `
    import { applyFaceSafeFraming } from "./src/faceSafeFraming.ts";
    import { Logger } from "./src/fileUtils.ts";
    const layer = { type:"image", path:"portrait.jpg", x:0, y:0, width:1920,
      height:1080, opacity:1, start:0, animation:"none", fit:"contain",
      motion:"zoom_in", motionStrength:0.04, focusX:0.5, focusY:0.3,
      faceBox:{ x:0.3, y:0.05, width:0.4, height:0.3 } };
    const timeline = { project:{width:1920,height:1080}, slides:[{
      id:"opening", effect:"layer_scene", layers:[layer]
    }] };
    const out = applyFaceSafeFraming(timeline, process.argv[1], new Logger(process.argv[2]));
    console.log("RESULT=" + JSON.stringify(out.slides[0].layers[0]));
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "-e", script, dir, path.join(dir, "logs")], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.match(/^RESULT=(.*)$/m)?.[1] ?? "null");
  assert.equal(result.fit, "contain");
  assert.equal(result.motion, "none");
  assert.equal("motionStrength" in result, false);
});

test("high crop-loss layer without a detected face keeps cover + motion", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "face-safe-noface-"));
  fs.writeFileSync(path.join(dir, "scenery.jpg"), minimalJpeg(884, 1280));

  const script = `
    import { applyFaceSafeFraming } from "./src/faceSafeFraming.ts";
    import { Logger } from "./src/fileUtils.ts";
    const layer = { type:"image", path:"scenery.jpg", x:0, y:0, width:1920,
      height:1080, opacity:1, start:0, animation:"none", fit:"contain",
      motion:"zoom_in", motionStrength:0.04, focusX:0.5, focusY:0.3 };
    const timeline = { project:{width:1920,height:1080}, slides:[{
      id:"opening", effect:"layer_scene", layers:[layer]
    }] };
    const out = applyFaceSafeFraming(timeline, process.argv[1], new Logger(process.argv[2]));
    console.log("RESULT=" + JSON.stringify(out.slides[0].layers[0]));
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "-e", script, dir, path.join(dir, "logs")], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.match(/^RESULT=(.*)$/m)?.[1] ?? "null");
  assert.equal(result.fit, "contain");
  assert.equal(result.motion, "zoom_in");
  assert.equal(result.motionStrength, 0.04);
});

test("slide focus survives normalize, validation, and compilation", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slide-focus-"));
  fs.writeFileSync(path.join(dir, "portrait.jpg"), minimalJpeg(884, 1280));

  const script = `
    import { normalizeTimeline } from "./src/normalizeTimeline.ts";
    import { validateTimeline } from "./src/validateTimeline.ts";
    import { compileTimeline } from "./src/compileTimeline.ts";
    const raw = {
      project: { name: "focus", width: 1920, height: 1080, fps: 30, quality: "draft" },
      music: [], audio: {}, overlays: [], output: { path: "focus.mp4" },
      slides: [{ id: "portrait", image: "portrait.jpg", duration: 4, effect: "zoom_in",
        focusX: 0.73, focusY: 0.21, faceBox: { x: 0.61, y: 0.04, width: 0.24, height: 0.31 },
        transition: { type: "none", duration: 0 }, captions: [] }]
    };
    const validated = validateTimeline(normalizeTimeline(raw), process.argv[1]);
    const plan = compileTimeline(validated, process.argv[1], process.argv[2]);
    console.log("RESULT=" + JSON.stringify({
      validated: [validated.slides[0].focusX, validated.slides[0].focusY],
      compiled: [plan.steps[0].focusX, plan.steps[0].focusY],
      faceBox: plan.steps[0].faceBox
    }));
  `;
  const run = spawnSync(process.execPath, ["--import", "tsx", "-e", script, dir, path.join(dir, "temp")], {
    cwd: root,
    encoding: "utf8",
  });

  assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout.match(/^RESULT=(.*)$/m)?.[1] ?? "null");
  assert.deepEqual(result.validated, [0.73, 0.21]);
  assert.deepEqual(result.compiled, [0.73, 0.21]);
  assert.deepEqual(result.faceBox, { x: 0.61, y: 0.04, width: 0.24, height: 0.31 });
});
