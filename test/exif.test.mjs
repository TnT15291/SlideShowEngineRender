// EXIF orientation: the gap between what a JPEG STORES and what ffmpeg DECODES.
//
// A camera held sideways writes the frame landscape and records "rotate 90" in
// EXIF. ffmpeg honours that on decode (autorotate is on by default), so every
// stage that looks at pixels sees a portrait frame — while every stage that reads
// the file header sees a landscape one. The two halves of the pipeline then
// disagree about the same photo: it is routed to landscape effects, dropped into
// landscape layout slots, and face-safe-cropped against an aspect it does not
// have, all while its focus point was measured in the other coordinate system.
//
// Caught on a real customer's set, where the three best photos (hero 0.92, 0.86,
// 0.72 — the kimono-in-autumn frames) were all rotated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const node = process.execPath;

/** A minimal but real JPEG: SOI, an EXIF APP1 carrying `orientation`, an SOF0
 *  declaring width x height, EOI. Enough for a header parser, no fixture files. */
function jpegWithOrientation(width, height, orientation) {
  const be = (n) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };

  // TIFF (big-endian "MM"), one IFD entry: tag 0x0112 (Orientation), SHORT, count 1.
  const tiff = Buffer.concat([
    Buffer.from("MM"), be(0x002a), Buffer.from([0, 0, 0, 8]), // header + offset to IFD0
    be(1),                                                     // entry count
    be(0x0112), be(3), Buffer.from([0, 0, 0, 1]), be(orientation), be(0),
    Buffer.from([0, 0, 0, 0]),                                 // next-IFD = none
  ]);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1]), be(exif.length + 2), exif]);

  // SOF0 payload: precision, height, width, components(1), and one component spec.
  const sofPayload = Buffer.concat([Buffer.from([8]), be(height), be(width), Buffer.from([1, 1, 0x11, 0])]);
  const sof = Buffer.concat([Buffer.from([0xff, 0xc0]), be(sofPayload.length + 2), sofPayload]);

  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof, Buffer.from([0xff, 0xd9])]);
}

/** readImageSize lives in TypeScript, so reach it the way the engine does. */
function sizeOf(file) {
  const r = spawnSync(
    node,
    [
      "--import", "tsx", "-e",
      `import {readImageSize,isPortrait} from "./src/imageSize.ts";` +
        `const s=readImageSize(process.argv[1]);` +
        `console.log(JSON.stringify({...s, portrait:isPortrait(s)}));`,
      file,
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim());
}

test("a stored-landscape JPEG marked 'rotate 90' reports the size it will DECODE to", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exif-"));
  const file = path.join(dir, "turned.jpg");
  fs.writeFileSync(file, jpegWithOrientation(7008, 4672, 6)); // 6 = quarter turn

  const s = sizeOf(file);
  assert.equal(s.width, 4672, "width was not transposed");
  assert.equal(s.height, 7008, "height was not transposed");
  assert.equal(s.portrait, true, "a rotated photo must be seen as portrait, or it gets landscape framing");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("orientation 8 (the other quarter turn) transposes too, 3 (180°) does not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exif-"));

  const turned = path.join(dir, "turned8.jpg");
  fs.writeFileSync(turned, jpegWithOrientation(4000, 3000, 8));
  assert.equal(sizeOf(turned).portrait, true, "orientation 8 must transpose");

  // 180° keeps the aspect: transposing it would invent a portrait photo.
  const flipped = path.join(dir, "flipped.jpg");
  fs.writeFileSync(flipped, jpegWithOrientation(4000, 3000, 3));
  const f = sizeOf(flipped);
  assert.equal(f.width, 4000);
  assert.equal(f.portrait, false, "a 180° flip is still landscape");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("a JPEG with no EXIF at all is unchanged", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "exif-"));
  const file = path.join(dir, "plain.jpg");
  // Same builder, orientation 1 = "as stored".
  fs.writeFileSync(file, jpegWithOrientation(1600, 1200, 1));

  const s = sizeOf(file);
  assert.equal(s.width, 1600);
  assert.equal(s.height, 1200);
  assert.equal(s.portrait, false);

  fs.rmSync(dir, { recursive: true, force: true });
});
