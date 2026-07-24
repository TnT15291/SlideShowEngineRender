// End-to-end: a `moment` directive ("phải có cảnh trao nhẫn") resolved by applyStoryTemplate.mjs
// into the SAME must-use/exclude photo locks brief.mustUsePhotos/excludePhotos already drive —
// proven against the real script, not just the unit-level pieces in directives.test.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const RECIPE = "story-templates/warm-film-01.json"; // minPhotos: 35

function setupProject(temp, { extraTags = {} } = {}) {
  const musicName = `moment-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const analysisDir = path.join(temp, "analysis");
  fs.mkdirSync(path.join(analysisDir, "music"), { recursive: true });

  const photos = Array.from({ length: 40 }, (_, i) => ({
    file: `input/${String(i + 1).padStart(3, "0")}.jpg`,
    orient: i % 2 ? "portrait" : "landscape",
    qualityNorm: 0.9 - i / 1000,
    sharpness: 30,
    meanLuma: 128,
  }));
  const photosPath = path.join(temp, "photos.json");
  fs.writeFileSync(photosPath, JSON.stringify({ photos }));

  // No heroScore here on purpose: byQuality (applyStoryTemplate.mjs) sorts on
  // heroScore first, and giving tagged photos a boosted score would make THEM win the
  // hero/ending slot — which are separately reserved and exempt from mustUse, and would
  // make this fixture pass for the wrong reason. Leaving heroScore unset falls back to
  // qualityNorm, which already ranks input/001.jpg highest, keeping hero/ending clear
  // of whatever this test tags.
  const contentPhotos = photos.map((p) => ({ file: p.file, tags: extraTags[p.file] || [] }));
  fs.writeFileSync(path.join(analysisDir, "photo_content.json"), JSON.stringify({ photos: contentPhotos }));

  const beatSeconds = 0.5;
  const musicDuration = 180;
  const phrases = Array.from({ length: Math.ceil(musicDuration / 8) + 1 }, (_, i) => ({ index: i, time: Math.min(musicDuration, i * 8), kind: "phrase" }));
  fs.writeFileSync(path.join(analysisDir, "music", `${musicName}.json`), JSON.stringify({
    analysisVersion: 2, duration: musicDuration, envelope: [],
    beatGrid: { beatSeconds, phase: 0, source: "test" }, phrases,
  }));

  return { musicName, analysisDir, photosPath };
}

function writeDirectives(temp, directives) {
  const p = path.join(temp, "directives.json");
  fs.writeFileSync(p, JSON.stringify({
    version: 1, story: "", unmapped: [],
    directives: directives.map((d, i) => ({
      id: `r${i + 1}`, round: 0, source: "prompt", quote: "test", strength: "must", confidence: 1,
      scope: { global: true }, ...d,
    })),
  }));
  return p;
}

function build(temp, { musicName, analysisDir, photosPath }, directivesPath) {
  const outPath = path.join(temp, "timeline.json");
  const r = spawnSync(process.execPath, [
    "scripts/applyStoryTemplate.mjs",
    "--template", RECIPE,
    "--photos", photosPath,
    "--music", `music/${musicName}.mp3`,
    "--analysis-dir", analysisDir,
    "--directives", directivesPath,
    "--out", outPath,
  ], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return JSON.parse(fs.readFileSync(outPath, "utf8"));
}

// Same filename-collection rule contactSheetReport.mjs and tier1QualityGate.mjs use to
// answer "which photos actually reached a slide" — mirrored here rather than imported,
// since it is a three-line file-local helper in both of those, not an exported function.
const photosUsed = (tl) => new Set(
  (tl.slides || []).flatMap((s) => [s.image, ...(s.images || []), ...(s.layers || []).filter((l) => l.type === "image").map((l) => l.path)])
    .filter(Boolean)
);

test("require: the tagged photo is locked via the SAME mechanism brief.mustUsePhotos uses", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "directive-moment-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const setup = setupProject(temp, {
    extraTags: { "input/005.jpg": ["rings"], "input/006.jpg": ["rings"] },
  });
  const directivesPath = writeDirectives(temp, [{ kind: "moment", op: "require", target: "rings" }]);
  const tl = build(temp, setup, directivesPath);

  const locked = tl.photoAssignment.customerLocks.mustUsePhotos;
  // Both candidates carry the tag with equal heroScore in this fixture, so either is an
  // acceptable pick — the point is the resolver locked ONE of them in, and the lock is
  // the same customerLocks.mustUsePhotos field must_use_coverage already audits.
  assert.ok(
    locked.includes("input/005.jpg") || locked.includes("input/006.jpg"),
    `expected a rings-tagged photo locked in; got: ${JSON.stringify(locked)}`
  );
  const lockedFile = locked.find((f) => f === "input/005.jpg" || f === "input/006.jpg");
  assert.ok(photosUsed(tl).has(lockedFile), "the locked photo never reached an actual slide");
});

test("forbid: a tagged photo never reaches the pool, even though it's otherwise a fine candidate", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "directive-moment-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const setup = setupProject(temp, { extraTags: { "input/010.jpg": ["party"] } });
  const directivesPath = writeDirectives(temp, [{ kind: "moment", op: "forbid", target: "party" }]);
  const tl = build(temp, setup, directivesPath);

  assert.ok(tl.photoAssignment.customerLocks.excludePhotos.includes("input/010.jpg"), "the tag was not resolved into excludePhotos");
  assert.ok(!photosUsed(tl).has("input/010.jpg"), "the forbidden photo appeared in the film");
});

test("require with no matching photo does not crash the build — it just locks nothing", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "directive-moment-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const setup = setupProject(temp, {}); // nothing tagged "rings"
  const directivesPath = writeDirectives(temp, [{ kind: "moment", op: "require", target: "rings" }]);
  const tl = build(temp, setup, directivesPath); // must not throw
  assert.ok((tl.slides || tl.scenes || []).length > 0);
});
