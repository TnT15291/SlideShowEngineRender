// EVERY REMOTION HYBRID TEMPLATE ACTUALLY DRAWS SOMETHING.
//
// Until this file existed, nothing in the suite rendered a hybrid scene. test/hybrid-
// renderer.test.mjs routes them with --dry-run, which proves the timeline compiles and the
// right template name reaches the renderer — and proves nothing whatsoever about what lands
// on screen. That gap has been paid for twice already:
//
//   match_cut_windows  painted one of its three windows and left 66% of the frame as bare
//                      #111, while the routing test was green (see the comment in
//                      gpu-effects/hybrid-scene.tsx).
//   confetti_bloom     rendered a COMPLETELY BLANK cream rectangle at 1920x1080 — its
//                      camera stands 1158 units back and react-three-fiber's default far
//                      plane is 1000, so the whole scene was clipped away. It looked fine
//                      in the sample renders only because those were made at 960x540.
//
// Both are the same class of failure: the pipeline is healthy, the picture is empty. So the
// assertions here are deliberately about PIXELS, and deliberately coarse enough not to
// wobble between machines:
//
//   1. it renders at all             — a shader that fails to compile, an asset that does
//                                      not resolve, a component that throws
//   2. no frame is a flat colour     — the blank-render failure
//   3. not all frames are identical  — a template that animates nothing
//   4. no frame is emptier than the  — the bare-background failure, measured per template
//      recorded baseline               because "empty" means different things to a fly-in
//                                      entrance and a full-bleed dissolve
//
// The template list is DERIVED from scripts/lib/engineCapabilities.mjs, so a template added
// to the engine is covered here the moment it exists, and the baseline check below fails
// loudly until someone records what it looks like.
//
// Lives in test/regression rather than test/unit because it bundles Remotion and renders
// ~93 stills at delivery resolution: about four and a half minutes.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import ffmpegStatic from "ffmpeg-static";
import { bundle } from "@remotion/bundler";
import { renderStill, selectComposition } from "@remotion/renderer";
import { HYBRID_ASSET_MIN, HYBRID_RENDERER } from "../../scripts/lib/engineCapabilities.mjs";

const root = process.cwd();
const baseline = JSON.parse(fs.readFileSync(path.join(root, "test/regression/hybrid-scene-baseline.json"), "utf8"));

// Delivery resolution. The size matters: several templates travel by fixed pixel distances
// and only compose correctly near 1080p, so testing at a convenient small size would assert
// against a picture no customer ever receives.
const WIDTH = 1920;
const HEIGHT = 1080;
// Half size, for the second test below. Distances in gpu-effects/hybrid-scene.tsx were
// authored as literal pixels against a 1080p frame; every one that was not scaled to the
// output flew its card clean off a smaller canvas.
const SMALL_WIDTH = 640;
const SMALL_HEIGHT = 360;
const DURATION = 120;
const FRAMES = [6, 60, 114];
const FLAT_HEADROOM = 0.08;
const MIN_STD = 3;
// Two photographs is enough to exercise every from/to pair; templates that want nine get
// them by alternating, which is also what the engine does when a montage outruns its slot.
const PHOTOS = ["gpu-effects/page-a.jpg", "gpu-effects/page-b.jpg"];

const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0
  ? "ffmpeg"
  : (process.env.FFMPEG_PATH || ffmpegStatic);

/** One frame as raw 8-bit luma, straight out of ffmpeg — no image library to install. */
function luma(file, width = WIDTH, height = HEIGHT) {
  const result = spawnSync(
    ffmpeg,
    ["-v", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "gray", "-"],
    { maxBuffer: 64 * 1024 * 1024, encoding: "buffer" },
  );
  assert.equal(result.status, 0, `ffmpeg could not read ${file}: ${result.stderr?.toString() ?? ""}`);
  assert.equal(result.stdout.length, width * height, `unexpected frame size for ${file}`);
  return result.stdout;
}

function standardDeviation(pixels) {
  let sum = 0;
  for (const value of pixels) sum += value;
  const mean = sum / pixels.length;
  let squares = 0;
  for (const value of pixels) squares += (value - mean) ** 2;
  return Math.sqrt(squares / pixels.length);
}

/** Fraction of 16x16 blocks that carry no detail at all — the "how much of this frame is
 *  dead colour" number the per-template baseline is recorded against. */
function flatShare(pixels, block = 16) {
  let flat = 0;
  let total = 0;
  for (let top = 0; top + block <= HEIGHT; top += block) {
    for (let left = 0; left + block <= WIDTH; left += block) {
      let sum = 0;
      let squares = 0;
      for (let y = 0; y < block; y++) {
        for (let x = 0; x < block; x++) {
          const value = pixels[(top + y) * WIDTH + left + x];
          sum += value;
          squares += value * value;
        }
      }
      const count = block * block;
      const mean = sum / count;
      if (Math.sqrt(Math.max(0, squares / count - mean * mean)) < 1.5) flat++;
      total++;
    }
  }
  return flat / total;
}

const identical = (a, b) => Buffer.compare(a, b) === 0;

const templates = Object.keys(HYBRID_RENDERER).filter((id) => HYBRID_RENDERER[id] === "remotion");

/** The props a template is exercised with. Vietnamese copy on purpose: the text-bearing
 *  templates must draw stacked tone marks, and the font that carries them is loaded at
 *  render time (see gpu-effects/fonts.ts). */
const propsFor = (template) => ({
  template,
  assets: Array.from(
    { length: Math.max(HYBRID_ASSET_MIN[template] ?? 1, 2) },
    (_, index) => PHOTOS[index % PHOTOS.length],
  ),
  durationInFrames: DURATION,
  params: { title: "Nguyễn Quốc & Trần Bảo Nhi", subtitle: "Chuyện tình mùa cưới" },
});

test("the hybrid baseline covers exactly the templates the engine offers", () => {
  const recorded = Object.keys(baseline.templates).sort();
  assert.deepEqual(
    recorded,
    [...templates].sort(),
    "test/regression/hybrid-scene-baseline.json has drifted from engineCapabilities.mjs — " +
      "record a baseline for every new Remotion template (run it once and read off its flat share), " +
      "and delete the entry for any template that was removed",
  );
  const unknown = Object.keys(baseline.staticTemplates).filter((id) => !templates.includes(id));
  assert.deepEqual(unknown, [], "staticTemplates names a template the engine no longer offers");
});

test("every Remotion hybrid template renders a picture", { timeout: 900_000 }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "hybrid-render-"));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));

  const serveUrl = await bundle({ entryPoint: path.resolve(root, "gpu-effects/index.ts") });

  for (const template of templates) {
    const inputProps = propsFor(template);
    const selected = await selectComposition({ serveUrl, id: "HybridScene", inputProps });
    const composition = { ...selected, width: WIDTH, height: HEIGHT, durationInFrames: DURATION, fps: 30 };

    const frames = [];
    for (const frame of FRAMES) {
      const file = path.join(output, `${template}-${frame}.png`);
      await renderStill({ composition, serveUrl, output: file, frame, inputProps });
      frames.push(luma(file));
    }

    const ceiling = baseline.templates[template].maxFlatShare + FLAT_HEADROOM;
    for (let index = 0; index < frames.length; index++) {
      const where = `${template} frame ${FRAMES[index]}`;
      const spread = standardDeviation(frames[index]);
      assert.ok(
        spread >= MIN_STD,
        `${where} is a flat colour (luma sd ${spread.toFixed(2)}) — the template rendered nothing`,
      );
      const empty = flatShare(frames[index]);
      assert.ok(
        empty <= ceiling,
        `${where} is ${(empty * 100).toFixed(1)}% featureless, over its recorded ` +
          `${(baseline.templates[template].maxFlatShare * 100).toFixed(1)}% (+${FLAT_HEADROOM * 100}% headroom) — ` +
          "something that used to be drawn is missing from the frame",
      );
    }

    // Asserted in BOTH directions. A template that should move but does not is the defect
    // this catches; a template already known not to move is listed with its diagnosis, and
    // repairing it has to fail here so the stale entry cannot outlive the bug.
    const still = identical(frames[0], frames[1]) && identical(frames[1], frames[2]);
    const knownStatic = Object.prototype.hasOwnProperty.call(baseline.staticTemplates, template);
    if (knownStatic) {
      assert.ok(
        still,
        `${template} now animates — delete its entry from staticTemplates in ` +
          "test/regression/hybrid-scene-baseline.json, the defect it records is fixed",
      );
    } else {
      assert.ok(
        !still,
        `${template} is the same picture at frames ${FRAMES.join(", ")} — the template animates nothing`,
      );
    }
  }
});

// The composition is not always 1920x1080 — a timeline names its own width and height, and
// a proxy or a vertical cut is an ordinary thing to ask the engine for. Four templates used
// to fly their cards a literal ±900 to ±1100 pixels regardless, which on a 640-wide canvas
// is most of two frame widths: hero_filmstrip rendered a COMPLETELY FLAT frame a twentieth
// of the way into the shot, and fly_in_duo, corner_fly_four and ribbon_cascade rendered
// 99-100% background. One frame per template at half size is enough to catch that, and it
// costs about a minute.
test("no hybrid template falls apart at a smaller composition size", { timeout: 600_000 }, async (t) => {
  const output = fs.mkdtempSync(path.join(os.tmpdir(), "hybrid-small-"));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));

  const serveUrl = await bundle({ entryPoint: path.resolve(root, "gpu-effects/index.ts") });
  // Frame 6: early enough that anything entering the frame is still on its way in, which is
  // exactly when an unscaled travel distance leaves the canvas empty.
  const frame = 6;

  for (const template of templates) {
    const inputProps = propsFor(template);
    const selected = await selectComposition({ serveUrl, id: "HybridScene", inputProps });
    const composition = {
      ...selected,
      width: SMALL_WIDTH,
      height: SMALL_HEIGHT,
      durationInFrames: DURATION,
      fps: 30,
    };
    const file = path.join(output, `${template}.png`);
    await renderStill({ composition, serveUrl, output: file, frame, inputProps });
    const spread = standardDeviation(luma(file, SMALL_WIDTH, SMALL_HEIGHT));
    assert.ok(
      spread >= MIN_STD,
      `${template} at ${SMALL_WIDTH}x${SMALL_HEIGHT} frame ${frame} is a flat colour ` +
        `(luma sd ${spread.toFixed(2)}) — something in it is sized or moved in literal pixels ` +
        "instead of being scaled to the composition (see AUTHORED_WIDTH in gpu-effects/hybrid-scene.tsx)",
    );
  }
});
