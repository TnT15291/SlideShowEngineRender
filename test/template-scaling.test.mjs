import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { solveRecipeShotList } from "../scripts/lib/recipeShotList.mjs";

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

test("shot-list substitution never repeats a layout back-to-back while an alternative exists", () => {
  // 6 body photos on a track wanting ~5 body beats of 1 photo each: the 2-photo scene
  // is unaffordable on 1-photo beats, so substitution runs constantly — exactly the
  // photo-poor regime where least-used alone kept re-picking the layout just emitted.
  const demandByLayout = { title_card: 0, two_photo_story: 2, full_bleed_quote: 1, polaroid_card: 1, closing_names: 0 };
  const recipe = { id: "adjacency-test", scenes: [
    { id: "open", layout: "title_card", effect: "layer_scene", durationRole: "calm" },
    { id: "duo", layout: "two_photo_story", effect: "layer_scene" },
    { id: "breath", layout: "full_bleed_quote", effect: "layer_scene" },
    { id: "solo", layout: "polaroid_card", effect: "layer_scene" },
    { id: "close", layout: "closing_names", effect: "layer_scene", durationRole: "closing" },
  ] };
  const { scenes } = solveRecipeShotList({
    recipe, photoCount: 8, musicDuration: 44,
    durationOf: () => 6,
    photoDemandOf: (s) => demandByLayout[s.layout] ?? 0,
    bodyPhotoBudget: 6,
  });
  assert.ok(scenes.length >= 6, `expected bookends + several body scenes, got ${scenes.length}`);
  const layoutOf = (s) => s.layout || s.effect;
  for (let i = 1; i < scenes.length; i++) {
    assert.notEqual(layoutOf(scenes[i]), layoutOf(scenes[i - 1]),
      `${scenes[i - 1].id} -> ${scenes[i].id} puts ${layoutOf(scenes[i])} on screen twice in a row`);
  }
});

test("body durations lean toward the music instead of coming out uniform", () => {
  const demandByLayout = { title: 0, la: 1, lb: 1, closing: 0 };
  const recipe = { id: "energy-test", scenes: [
    { id: "open", layout: "title", effect: "layer_scene", durationRole: "calm" },
    { id: "a", layout: "la", effect: "layer_scene" },
    { id: "b", layout: "lb", effect: "layer_scene" },
    { id: "close", layout: "closing", effect: "layer_scene", durationRole: "closing" },
  ] };
  const solve = (energy) => solveRecipeShotList({
    recipe, photoCount: 12, musicDuration: 90,
    durationOf: () => 6,
    photoDemandOf: (s) => demandByLayout[s.layout] ?? 0,
    bodyPhotoBudget: 10,
    energy,
  });
  // First half of the track quiet, second half loud.
  const flat = solve(undefined);
  const bent = solve({ meanOver: (t0, t1) => ((t0 + t1) / 2 < 45 ? 0.2 : 0.8) });

  const flatBody = flat.scenes.slice(1, -1).map((s) => s.durationSec);
  assert.equal(new Set(flatBody).size, 1, "fixture sanity: without energy the body IS uniform");

  const body = bent.scenes.slice(1, -1).map((s) => s.durationSec);
  assert.ok(new Set(body).size >= 2, `expected varied durations, got ${body.join(", ")}`);
  const half = Math.floor(body.length / 2);
  const mean = (arr) => arr.reduce((x, y) => x + y, 0) / arr.length;
  const quiet = mean(body.slice(0, half));
  const loud = mean(body.slice(-half));
  assert.ok(quiet > loud, `quiet scenes should breathe (${quiet.toFixed(2)}s) vs loud (${loud.toFixed(2)}s)`);
  // The lean is clamped and zero-sum: no scene drifts far, the film's length does not move.
  for (const d of body) assert.ok(Math.abs(d - flatBody[0]) / flatBody[0] <= 0.16, `${d}s drifts beyond the clamp`);
  const total = (doc) => doc.scenes.reduce((n, s) => n + s.durationSec, 0);
  assert.ok(Math.abs(total(bent) - total(flat)) < 0.1, "modulation must not change the film's length");
});
