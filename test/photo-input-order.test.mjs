import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { orderPhotoInputFiles } from "../scripts/lib/photoInputOrder.mjs";

test("photo input order follows the upload manifest and keeps unmanaged files stable", (context) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-order-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = path.join(dir, "uploads.json");
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, assets: [
    { kind: "photo", storedName: "000001-a.jpg", uploadIndex: 1 },
    { kind: "photo", storedName: "000099-z.jpg", uploadIndex: 0 },
    { kind: "music", storedName: "song.mp3", uploadIndex: 0 },
  ] }));

  assert.deepEqual(
    orderPhotoInputFiles(["loose-10.jpg", "000001-a.jpg", "loose-2.jpg", "000099-z.jpg"], manifest),
    ["000099-z.jpg", "000001-a.jpg", "loose-2.jpg", "loose-10.jpg"],
  );
  assert.deepEqual(orderPhotoInputFiles(["10.jpg", "2.jpg"]), ["2.jpg", "10.jpg"]);
});

test("an invalid upload manifest fails loudly instead of silently ignoring customer order", (context) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-order-invalid-"));
  context.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const manifest = path.join(dir, "uploads.json");
  fs.writeFileSync(manifest, "not-json");
  assert.throws(() => orderPhotoInputFiles(["a.jpg"], manifest), /Invalid upload manifest JSON/);
});
