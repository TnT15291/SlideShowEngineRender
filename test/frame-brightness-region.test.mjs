import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

/** One frame: a solid card with a gradient "photograph" laid over it. A gradient, not a flat
 *  colour — a solid inset has no tonal range at all and would legitimately read as
 *  flat_or_empty, which is a different check. */
function card(dir, { surround, c0, c1, size = [620, 500], at = [650, 290] }) {
  const file = path.join(dir, `${surround}-${c0}.mp4`);
  const result = spawnSync(ffmpeg, ["-v", "error", "-y",
    "-f", "lavfi", "-i", `color=c=${surround}:s=1920x1080:d=1:r=30`,
    "-f", "lavfi", "-i", `gradients=s=${size[0]}x${size[1]}:c0=${c0}:c1=${c1}:d=1:r=30`,
    // A full second of frames, not one: qaClip samples the MIDDLE of the scene, and a
    // single-frame file has nothing to seek to at 0.5s.
    "-filter_complex", `[0:v][1:v]overlay=x=${at[0]}:y=${at[1]},format=yuv420p[v]`,
    "-map", "[v]", "-t", "1", file], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return { file, size, at };
}

function measure(dir, video, slide) {
  const timeline = path.join(dir, `${slide.id}.json`);
  const out = path.join(dir, `${slide.id}.qa.json`);
  fs.writeFileSync(timeline, JSON.stringify({
    project: { name: "region", width: 1920, height: 1080, fps: 30 },
    output: { path: video },
    slides: [{ duration: 1, transition: { type: "none", duration: 0 }, captions: [], ...slide }],
  }));
  const result = spawnSync(process.execPath, ["scripts/qaClip.mjs", timeline, "--out", out],
    { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(fs.readFileSync(out, "utf8")).results[0];
}

const asCard = (id, { size, at }) => ({
  id, effect: "layer_scene",
  layers: [
    { type: "rect", x: 0, y: 0, width: 1920, height: 1080, color: "#000000", opacity: 1 },
    { type: "image", path: "p.jpg", x: at[0], y: at[1], width: size[0], height: size[1], fit: "cover" },
  ],
});

// qaClip's own comment says a cream card is art direction and not a badly exposed
// photograph — but `showsPhoto` is all-or-nothing, so a card that is a full-frame #FBF6ED
// panel with the photo inset over a fraction of it was judged as though the whole frame
// were the photograph. On a real job three such scenes flagged too_bright on every run and
// no repair could move them: the photograph was never what was bright. The film shipped
// `delivered_with_flags`.
test("a card's exposure is measured on its photograph, not on its background", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frame-region-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  // Cream card, correctly-exposed photograph.
  const made = card(dir, { surround: "0xFBF6ED", c0: "0xB4B4B4", c1: "0xF0F0F0", size: [400, 300], at: [760, 390] });

  const scene = measure(dir, made.file, asCard("card", made));
  assert.deepEqual(scene.region, { layer: 1, x: 760, y: 390, width: 400, height: 300 });
  assert.deepEqual(scene.flags, [], "a well-exposed photo on a cream card is not a defect");

  // The same video measured whole — what the check used to do. If the crop is ever dropped,
  // this gap collapses. On the real job the two readings were 242 and 219 against a 224
  // line, which is precisely how a well-exposed photograph came to be reported as blown out.
  const whole = measure(dir, made.file, { id: "full", effect: "still", image: "p.jpg" });
  assert.ok(!whole.region, "a full-frame photo scene has no sub-region");
  assert.ok(whole.yavg - scene.yavg > 20,
    `whole frame ${whole.yavg} vs photograph ${scene.yavg}: the crop is not being applied`);
});

// The same mechanism in reverse, and the stronger guard: here the frame as a whole is dark
// enough to look unremarkable, and only the crop can see that the photograph is blown out.
test("a blown-out photograph on a dark card is caught, and names the layer to grade", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frame-region-hot-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const made = card(dir, { surround: "0x101010", c0: "0xFAFAFA", c1: "0xFFFFFF" });

  const whole = measure(dir, made.file, { id: "full", effect: "still", image: "p.jpg" });
  assert.deepEqual(whole.flags, [], "measured whole, this frame looks fine — that is the bug");

  const scene = measure(dir, made.file, asCard("hot", made));
  assert.ok(scene.flags.includes("too_bright"), `photograph measured ${scene.yavg}`);
  // The repair needs WHERE: buildLayerSceneCommand applies layer.grade and never reads
  // slide.color, so a scene-level grade would be written and silently ignored.
  assert.equal(scene.region.layer, 1);
});

test("the largest photograph is the one measured on a multi-photo card", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frame-region-multi-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const made = card(dir, { surround: "0xFBF6ED", c0: "0xB4B4B4", c1: "0xF0F0F0" });
  const scene = measure(dir, made.file, {
    id: "trio", effect: "layer_scene",
    layers: [
      { type: "image", path: "a.jpg", x: 0, y: 0, width: 300, height: 200, fit: "cover" },
      { type: "image", path: "b.jpg", x: 650, y: 290, width: 620, height: 500, fit: "cover" },
      { type: "image", path: "c.jpg", x: 1400, y: 0, width: 300, height: 200, fit: "cover" },
    ],
  });
  assert.equal(scene.region.layer, 1, "the card is about its biggest photograph");
  assert.equal(scene.region.width, 620);
});

test("a region is clamped to the canvas", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "frame-region-clamp-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const made = card(dir, { surround: "0xFBF6ED", c0: "0xB4B4B4", c1: "0xF0F0F0" });
  const scene = measure(dir, made.file, {
    id: "overhang", effect: "layer_scene",
    layers: [{ type: "image", path: "p.jpg", x: 1700, y: 900, width: 620, height: 500, fit: "cover" }],
  });
  // An ffmpeg crop running past the frame fails the whole invocation, so this must clamp or
  // the scene measures nothing at all.
  assert.equal(scene.region.x + scene.region.width, 1920);
  assert.equal(scene.region.y + scene.region.height, 1080);
  assert.ok(Number.isFinite(scene.yavg), "a clamped region still measures");
});
