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
  assert.equal(result.motion, "none");
  assert.equal("motionStrength" in result, false);
});
