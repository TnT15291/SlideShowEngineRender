// photo_coverage: the rule that would have caught it.
//
// The numbers were always there. photo-assignment.json has counted selectedNotRendered for
// as long as it has existed, and applyStoryTemplate only ever printed a WARNING when
// `assignedNotRendered` was non-empty — a different, narrower condition that stayed empty
// while sixteen of a customer's photographs sat in the first list. Nothing read the number
// that mattered, so nothing failed.
//
// These tests hold that wiring in place: an emitter that reads the shipped counts, a
// registry entry so the finding is not silently dropped as unknown, and tier policy that
// decides what happens next.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { actionFor, POLICY, TIERS } from "../scripts/lib/rules/policy.mjs";
import { isKnownRule } from "../scripts/lib/rules/contract.mjs";
import { PHOTO_COVERAGE_FLOOR } from "../scripts/lib/rules/thresholds.mjs";

/** A minimal job on disk: a timeline qaProxy can parse, and the assignment report it
 *  reads its coverage from. No photographs and no music — coverage is arithmetic the
 *  builder already did, and this check re-reads it rather than re-deriving it. */
function job(t, timelineCoverage) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-coverage-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const analysis = path.join(dir, "analysis");
  fs.mkdirSync(analysis, { recursive: true });
  fs.writeFileSync(path.join(dir, "timeline.json"), JSON.stringify({
    language: "vi",
    project: { name: "coverage", width: 1920, height: 1080, fps: 30 },
    output: { path: path.join(dir, "missing.mp4") },
    slides: [{
      id: "s01", duration: 5, effect: "still", image: "a.jpg",
      transition: { type: "none", duration: 0 }, captions: [],
    }],
  }));
  fs.writeFileSync(path.join(analysis, "photo-assignment.json"), JSON.stringify({
    version: 1, selected: timelineCoverage.selected, timeline: timelineCoverage,
  }));
  const report = path.join(dir, "qa.json");
  const run = spawnSync(process.execPath, [
    "scripts/qaProxy.mjs", path.join(dir, "timeline.json"),
    "--analysis-dir", analysis, "--out", report,
  ], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(fs.readFileSync(report, "utf8"));
}

const shipped = (usedUnique, selected, notRenderedReasons = {}) => ({
  selected, usedUnique, references: usedUnique, maxUses: 1,
  selectedNotRendered: Array.from({ length: selected - usedUnique }, (_, i) => `lost-${i}.jpg`),
  notRenderedReasons, assignedNotRendered: [],
});

test("photo_coverage is a declared rule with a row for every tier", () => {
  assert.ok(isKnownRule("photo_coverage"), "an undeclared check is dropped, not enforced");
  for (const tier of TIERS) {
    assert.ok(POLICY[tier].photo_coverage, `${tier} has no photo_coverage row`);
    assert.ok(["block", "manual-review", "warn", "repair"].includes(actionFor(tier, "photo_coverage")));
  }
  // Lite refuses outright; premium is the tier where a director's order may legitimately
  // cost a photograph, so a person reads the receipt and decides.
  assert.equal(actionFor("lite", "photo_coverage"), "block");
  assert.equal(actionFor("premium", "photo_coverage"), "manual-review");
});

test("a film that lost photographs to a directive is flagged, whatever the ratio", (t) => {
  // 66/82 is 80.5% and would trip the floor anyway. The point of the separate flag is the
  // job that loses three photographs out of ninety: comfortably above any floor, and still
  // three pictures the customer gave us and never saw.
  const qa = job(t, shipped(87, 90, { directive_reduced_demand: 3 }));

  const finding = qa.problems.find((p) => p.check === "photo_coverage");
  assert.ok(finding, `no photo_coverage finding; problems were ${JSON.stringify(qa.problems.map((p) => p.check))}`);
  assert.ok(finding.flags.includes("directive_photo_loss"));
  assert.match(finding.detail, /directive_reduced_demand: 3/);
  assert.equal(qa.verdict, "review");
});

test("gross loss trips the floor even with no directive to blame", (t) => {
  const qa = job(t, shipped(66, 82, { budget_exceeded: 16 }));

  const finding = qa.problems.find((p) => p.check === "photo_coverage");
  assert.ok(finding, "80.5% coverage passed unflagged");
  assert.ok(finding.flags.includes("coverage_below_floor"));
  assert.ok(qa.checks.coverage.ratio < PHOTO_COVERAGE_FLOOR);
});

test("a plan that honestly could not fit one photograph is not a defect", (t) => {
  // 81 slots solved against 82 photographs is a fair fit. A rule that fails this is a rule
  // teams learn to ignore.
  const qa = job(t, shipped(81, 82, { budget_exceeded: 1 }));

  assert.equal(qa.problems.filter((p) => p.check === "photo_coverage").length, 0);
  assert.equal(qa.checks.coverage.status, "ran");
  assert.equal(qa.checks.coverage.ratio, 0.9878);
});

// A ratio cannot express "a fair fit at the margin" once the margin is smaller than one
// photograph. 15% of a four-photo album is 0.6 — an allowance of none — so the rule used to
// block a film that had placed every picture the music had room for, while granting an
// eighty-photo album twelve. These three tests hold the allowance, and its boundary.
test("a small album may leave one photograph the music had no room for", (t) => {
  // The integration pipeline's own shape: four photographs, an 18s track, three scenes.
  // The composer declared the drop as budget_exceeded; assessFit had already told the
  // customer the album was thin. Blocking here judges the album, not the film.
  const qa = job(t, shipped(3, 4, { budget_exceeded: 1 }));

  assert.equal(qa.problems.filter((p) => p.check === "photo_coverage").length, 0);
  assert.equal(qa.checks.coverage.allowance, 1);
  assert.equal(qa.checks.coverage.ratio, 0.75);
});

test("the one-photograph allowance is a margin, not an exemption for small albums", (t) => {
  const qa = job(t, shipped(2, 4, { budget_exceeded: 2 }));

  const finding = qa.problems.find((p) => p.check === "photo_coverage");
  assert.ok(finding, "half the album on the floor passed unflagged");
  assert.ok(finding.flags.includes("coverage_below_floor"));
  assert.match(finding.detail, /2 unplaced, 1 allowed/);
});

test("the allowance is the floor restated, not a loosening of it", (t) => {
  // Seven photographs is where floor(0.15 * selected) first reaches 1, so from here up the
  // predicate is arithmetically identical to `ratio < 0.85`. One unplaced passes on both
  // readings (85.7%); two fails on both (71.4%).
  assert.equal(job(t, shipped(6, 7, { budget_exceeded: 1 })).problems
    .filter((p) => p.check === "photo_coverage").length, 0);

  const worse = job(t, shipped(5, 7, { budget_exceeded: 2 }));
  assert.ok(worse.problems.find((p) => p.check === "photo_coverage")
    ?.flags.includes("coverage_below_floor"));
  assert.ok(worse.checks.coverage.ratio < PHOTO_COVERAGE_FLOOR);
});

test("a job with no assignment report says so instead of inventing a verdict", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "photo-coverage-none-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "timeline.json"), JSON.stringify({
    language: "vi", project: { name: "c", width: 1920, height: 1080, fps: 30 },
    output: { path: path.join(dir, "missing.mp4") },
    slides: [{ id: "s01", duration: 5, effect: "still", image: "a.jpg", transition: { type: "none", duration: 0 }, captions: [] }],
  }));
  const report = path.join(dir, "qa.json");
  const run = spawnSync(process.execPath, [
    "scripts/qaProxy.mjs", path.join(dir, "timeline.json"),
    "--analysis-dir", path.join(dir, "analysis"), "--out", report,
  ], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);

  const qa = JSON.parse(fs.readFileSync(report, "utf8"));
  assert.equal(qa.checks.coverage.status, "skipped");
  assert.match(qa.checks.coverage.reason, /photo-assignment\.json not found/);
  assert.equal(qa.problems.filter((p) => p.check === "photo_coverage").length, 0);
});
