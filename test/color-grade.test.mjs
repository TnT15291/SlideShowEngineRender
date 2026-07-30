import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

function runTs(source) {
  return spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

// A dummy file is enough: validateTimeline only checks the path exists;
// readImageSize returns undefined for unparseable bytes, which compileTimeline
// treats as "unknown size" (no crop-loss reroute) — exactly like a real
// landscape photo for the `still` effect used below. Absolute path so it
// resolves the same regardless of baseDir, without touching the repo's own
// (untracked, locally-managed) input/ directory.
function withDummyImage(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "color-grade-test-"));
  const imagePath = path.join(dir, "fixture.jpg");
  writeFileSync(imagePath, "not a real image, just needs to exist");
  try {
    return fn(imagePath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("halation/duotone/vhs grade fields compile end-to-end into a slide's filter graph", () => {
  withDummyImage((imagePath) => {
    const imageLiteral = JSON.stringify(imagePath);
    const result = runTs(`
      import { normalizeTimeline } from "./src/normalizeTimeline.ts";
      import { validateTimeline } from "./src/validateTimeline.ts";
      import { compileTimeline } from "./src/compileTimeline.ts";
      import { buildSlideArgs } from "./src/buildFfmpegCommand.ts";
      const raw = {
        project: { name: "test", width: 640, height: 360, fps: 30, quality: "draft" },
        music: [], audio: {}, output: { path: "output/test.mp4" }, overlays: [],
        slides: [{
          id: "s1", image: ${imageLiteral}, duration: 3, effect: "still",
          color: { halation: 0.5, duotone: { shadow: "#101418", highlight: "#f4e9d8" }, vhs: 0.4 },
          transition: { type: "none", duration: 0 }, captions: [],
        }],
      };
      const timeline = validateTimeline(normalizeTimeline(raw), process.cwd());
      const step = compileTimeline(timeline, process.cwd(), "temp").steps[0];
      const args = buildSlideArgs(step);
      console.log(args[args.indexOf("-vf") + 1]);
    `);
    assert.equal(result.status, 0, result.stderr);
    const graph = result.stdout.trim();
    assert.match(graph, /colorbalance=rm=0\.32/); // halation's warm tint
    assert.match(graph, /geq=lum='/); // duotone's luma gradient map
    assert.match(graph, /rgbashift=rh=1:bh=-1:edge=smear/); // vhs's chroma smear at strength 0.4
  });
});

test("duotone rejects a color outside #rrggbb", () => {
  withDummyImage((imagePath) => {
    const imageLiteral = JSON.stringify(imagePath);
    const result = runTs(`
      import { normalizeTimeline } from "./src/normalizeTimeline.ts";
      import { validateTimeline } from "./src/validateTimeline.ts";
      const raw = {
        project: { name: "test", width: 640, height: 360, fps: 30, quality: "draft" },
        music: [], audio: {}, output: { path: "output/test.mp4" }, overlays: [],
        slides: [{
          id: "s1", image: ${imageLiteral}, duration: 3, effect: "still",
          color: { duotone: { shadow: "navy", highlight: "#f4e9d8" } },
          transition: { type: "none", duration: 0 }, captions: [],
        }],
      };
      try { validateTimeline(normalizeTimeline(raw), process.cwd()); process.exit(2); }
      catch (error) { console.error(error.message); process.exit(error.message.includes("#rrggbb hex color") ? 0 : 3); }
    `);
    assert.equal(result.status, 0, result.stderr);
  });
});
