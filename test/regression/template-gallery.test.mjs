import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("every recipe and pacing variant can budget the regression album", (t) => {
  const gallery = path.join(root, "analysis", "regression-gallery");
  const photos = path.join(root, "analysis", "photos.json");
  const music = path.join(root, "music", "a thousand years.mp3");
  if (!fs.existsSync(photos) || !fs.existsSync(music)) {
    t.skip("regression album inputs unavailable");
    return;
  }
  const photoAnalysis = JSON.parse(fs.readFileSync(photos, "utf8"));
  const missingPhotos = (photoAnalysis.photos || [])
    .map((photo) => photo.file)
    .filter((file) => !fs.existsSync(path.resolve(root, file)));
  if (missingPhotos.length) {
    t.skip(`regression album incomplete: ${missingPhotos[0]}`);
    return;
  }

  const result = spawnSync(process.execPath, [
    "scripts/generateRegressionGallery.mjs", "--dry-run",
    "--out-dir", gallery,
    ...(process.env.REGRESSION_PACING ? ["--pacing", process.env.REGRESSION_PACING] : []),
  ], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(path.join(gallery, "gallery.json"), "utf8"));
  for (const entry of report.entries) {
    assert.equal(entry.qa.blocking.length, 0, `${entry.id} has unresolved QA blockers`);
    assert.equal(entry.qa.repairable.length, 0, `${entry.id} was rendered before deterministic QA repairs`);
    const timelinePath = path.isAbsolute(entry.timeline) ? entry.timeline : path.join(root, entry.timeline);
    const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
    assert.ok(timeline.slides.some((slide) => slide.signature), `${entry.id} preview lost its signature scene`);
  }
});
