import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();

function run(projectDir) {
  return spawnSync(process.execPath, ["scripts/selectProjectPhotos.mjs", "--project", projectDir], { cwd: root, encoding: "utf8" });
}

test("approved cull survives selection, while a stale approval is ignored", (context) => {
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "storeel-cull-approval-"));
  context.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(projectDir, "input"));
  fs.mkdirSync(path.join(projectDir, "analysis"));
  fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
    version: 1, id: "cull-test", name: "Cull test", inputDir: "input", music: [], analysisDir: "analysis",
    selectionPolicy: "analysis/selection_policy.json", selectedPhotos: "analysis/photos.selected.json",
    timeline: "timeline/timeline.json", output: "output/final.mp4", quality: "share", tier: "lite",
  }));
  fs.writeFileSync(path.join(projectDir, "analysis", "selection_policy.json"), JSON.stringify({ mode: "keep_all" }));
  const photos = { dir: "input", count: 3, photos: [
    { file: "input/a.jpg", qualityNorm: 1 }, { file: "input/b.jpg", qualityNorm: 0.5 }, { file: "input/c.jpg", qualityNorm: 0 },
  ] };
  const raw = JSON.stringify(photos);
  fs.writeFileSync(path.join(projectDir, "analysis", "photos.json"), raw);
  fs.writeFileSync(path.join(projectDir, "analysis", "cull_approval.json"), JSON.stringify({
    sourceHash: crypto.createHash("sha256").update(raw).digest("hex"), sourceCount: 3,
    drop: [{ file: "input/c.jpg", reason: "approved" }],
  }));

  const approved = run(projectDir);
  assert.equal(approved.status, 0, approved.stderr);
  let selected = JSON.parse(fs.readFileSync(path.join(projectDir, "analysis", "photos.selected.json"), "utf8"));
  assert.equal(selected.policy, "cull_approved");
  assert.deepEqual(selected.photos.map((photo) => photo.file), ["input/a.jpg", "input/b.jpg"]);

  photos.photos[2].qualityNorm = 0.1;
  fs.writeFileSync(path.join(projectDir, "analysis", "photos.json"), JSON.stringify(photos));
  const stale = run(projectDir);
  assert.equal(stale.status, 0, stale.stderr);
  assert.match(stale.stderr, /stale cull approval/i);
  selected = JSON.parse(fs.readFileSync(path.join(projectDir, "analysis", "photos.selected.json"), "utf8"));
  assert.equal(selected.policy, "keep_all");
  assert.equal(selected.photos.length, 3);
});
