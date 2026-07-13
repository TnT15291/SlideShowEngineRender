import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();

test("repeatable template scenes scale with photos and music", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "template-scaling-"));
  const musicName = `template-scaling-${process.pid}-${Date.now()}`;
  const musicAnalysis = path.join(root, "analysis", "music", `${musicName}.json`);
  t.after(() => {
    fs.rmSync(temp, { recursive: true, force: true });
    fs.rmSync(musicAnalysis, { force: true });
  });

  const photosPath = path.join(temp, "photos.json");
  const outPath = path.join(temp, "timeline.json");
  const photos = Array.from({ length: 60 }, (_, i) => ({
    file: `input/${String(i + 1).padStart(3, "0")}.jpg`,
    orient: i % 2 ? "portrait" : "landscape",
    qualityNorm: 0.9 - i / 1000,
    sharpness: 30,
  }));
  fs.writeFileSync(photosPath, JSON.stringify({ photos }));
  fs.writeFileSync(musicAnalysis, JSON.stringify({
    analysisVersion: 2, duration: 150, envelope: [],
    beatGrid: { beatSeconds: 0.5, phase: 0, source: "test" },
    phrases: Array.from({ length: 20 }, (_, i) => ({ index: i, time: i * 8, kind: "phrase" })),
  }));

  const result = spawnSync(process.execPath, [
    "scripts/applyStoryTemplate.mjs",
    "--template", "story-templates/warm-film-01.json",
    "--photos", photosPath,
    "--music", `music/${musicName}.mp3`,
    "--out", outPath,
    // This fixture's film covers 82% of its own 150s track, so applyStoryTemplate now
    // refuses to write it. That refusal is correct and is NOT what this test is about:
    // this test asserts the repeat MECHANISM (scenes expand, repeats stay under the cap,
    // the closing card stays last), and it should keep asserting it. The misfit itself is
    // owned by test/tier1-fit.test.mjs, which is red on purpose until the recipe path
    // learns to solve its shot count against the photo budget.
    "--accept-misfit",
  ], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const timeline = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.ok(timeline.slides.length > 9);
  assert.ok(timeline.slides.some((slide) => /^s02_candid_r\d+$/.test(slide.id)));
  assert.ok(timeline.slides.some((slide) => /^s07_montage_r\d+$/.test(slide.id)));
  assert.ok(timeline.slides.some((slide) => /^s03_chapter_r\d+$/.test(slide.id)));
  assert.ok(timeline.slides.some((slide) => /^s05_breath_r\d+$/.test(slide.id)));
  assert.ok(timeline.slides.some((slide) => /^s06_family_r\d+$/.test(slide.id)));
  assert.ok(timeline.slides.some((slide) => /^s08_instant_r\d+$/.test(slide.id)));
  for (const base of ["s02_candid", "s03_chapter", "s05_breath", "s06_family", "s07_montage", "s08_instant"]) {
    assert.ok(timeline.slides.filter((slide) => slide.id.startsWith(`${base}_r`)).length <= 3);
  }
  assert.equal(timeline.slides.at(-1).id, "s09_closing");
  assert.equal(new Set(timeline.slides.map((slide) => slide.id)).size, timeline.slides.length);
});
