import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { HERO_WEAK_PERCENTILE, HERO_SWAP_MARGIN } from "../scripts/lib/rules/thresholds.mjs";

// Twelve scores whose quartile and median fall apart on purpose: sorted, index
// floor(12 * 0.25) = 3 is 0.40 (the weak threshold) while the median is 0.60. A hero
// at 0.50 is therefore "below average" and yet nowhere near the album's worst — the
// exact case the old median trigger reported and the percentile one must not.
const SCORES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 0.9, 0.95];
const POOL = SCORES.map((heroScore, index) => ({
  file: `p${String(index + 1).padStart(2, "0")}.jpg`,
  heroScore, orient: "landscape", focusX: 0.5, focusY: 0.45,
}));
const fileFor = (score) => POOL.find((photo) => photo.heroScore === score).file;

/** A job whose only possible findings are hero ones: no music, no video, no assignment
 *  report, no text and no cover crops, so every other check skips itself. */
function job(t, { heroScores, tier }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qa-verdict-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const analysis = path.join(dir, "analysis");
  fs.mkdirSync(analysis, { recursive: true });

  fs.writeFileSync(path.join(dir, "timeline.json"), JSON.stringify({
    language: "vi",
    project: { name: "verdict", width: 1920, height: 1080, fps: 30 },
    output: { path: path.join(dir, "missing.mp4") },
    slides: heroScores.map((score, index) => ({
      id: `s${String(index + 1).padStart(2, "0")}`,
      duration: 5, effect: "layer_scene",
      transition: { type: "none", duration: 0 }, captions: [],
      layers: [{ type: "image", path: fileFor(score), motion: "kenburns_tl" }],
    })),
  }));
  fs.writeFileSync(path.join(analysis, "photo_content.json"),
    JSON.stringify({ generatedBy: "vision:test", photos: POOL }));

  const report = path.join(dir, "qa.json");
  const run = spawnSync(process.execPath, [
    "scripts/qaProxy.mjs", path.join(dir, "timeline.json"),
    "--analysis-dir", analysis, "--out", report,
    ...(tier ? ["--tier", tier] : []),
  ], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  return { report: JSON.parse(fs.readFileSync(report, "utf8")), stdout: run.stdout, dir, analysis };
}

const heroProblems = (report) => report.problems.filter((problem) => problem.check === "hero");

test("a hero is weak when it is in the album's worst slice, not merely below average", (t) => {
  // 0.50 sits under the 0.60 median and above the 0.40 quartile mark.
  const { report } = job(t, { heroScores: [0.5], tier: "lite" });
  assert.equal(report.checks.hero.status, "ran");
  assert.equal(report.checks.hero.weakPercentile, HERO_WEAK_PERCENTILE);
  assert.equal(report.checks.hero.weakThreshold, 0.4);
  assert.equal(report.checks.hero.poolMedian, 0.6);
  assert.deepEqual(heroProblems(report), [],
    "a mid-pack photograph is not a defect; flagging it made verdict=review the normal outcome");
});

test("a genuinely weak hero is still reported", (t) => {
  const { report } = job(t, { heroScores: [0.1], tier: "lite" });
  assert.equal(heroProblems(report).length, 1);
  assert.deepEqual(heroProblems(report)[0].flags, ["weak_hero"]);
});

test("each weak hero is offered a different photograph", (t) => {
  // `used` was built once from the timeline and never updated, so every weak slot was
  // handed the same top-scoring spare. Applied in one qaLoop pass that seats one
  // photograph in three slides — a duplicate_photo block traded for a hero swap.
  const { report } = job(t, { heroScores: [0.1, 0.2, 0.3], tier: "lite" });
  const problems = heroProblems(report);
  assert.equal(problems.length, 3);
  const targets = problems.map((problem) => problem.fix.to);
  assert.equal(new Set(targets).size, 3, `expected three distinct suggestions, got ${targets.join(", ")}`);
  // Best-available-first, and each still clears the swap margin over the hero it replaces.
  assert.deepEqual(targets, [fileFor(0.95), fileFor(0.9), fileFor(0.8)]);
  for (const [index, problem] of problems.entries()) {
    const replacement = POOL.find((photo) => photo.file === problem.fix.to);
    assert.ok(replacement.heroScore >= [0.1, 0.2, 0.3][index] + HERO_SWAP_MARGIN);
  }
});

test("--tier states what the tier does about the findings; hero is advisory for Lite", (t) => {
  const { report, stdout } = job(t, { heroScores: [0.1, 0.2], tier: "lite" });
  assert.equal(report.problems.length, 2);
  // The raw measurement is unchanged — stored reports and liteQualityReport read it.
  assert.equal(report.verdict, "review");
  assert.deepEqual(report.policy, {
    tier: "lite", verdict: "pass", policyVersion: 2,
    counts: { block: 0, repair: 0, "manual-review": 0, warn: 2 },
  });
  assert.match(stdout, /lite verdict=pass \(2 finding\(s\): 2 warn\)/);
  assert.match(stdout, /\[hero:warn\]/);
});

test("the same findings are repairs for premium, and the verdict says so", (t) => {
  const { report } = job(t, { heroScores: [0.1, 0.2], tier: "premium" });
  assert.equal(report.policy.verdict, "review");
  assert.equal(report.policy.counts.repair, 2);
});

test("without --tier the report keeps its tier-blind shape", (t) => {
  const { report } = job(t, { heroScores: [0.1] });
  assert.equal(report.verdict, "review");
  assert.equal(report.policy, undefined);
});

test("--strict gates on what the tier would actually refuse to ship", (t) => {
  const { dir, analysis } = job(t, { heroScores: [0.1, 0.2], tier: "lite" });
  const strict = (tier) => spawnSync(process.execPath, [
    "scripts/qaProxy.mjs", path.join(dir, "timeline.json"),
    "--analysis-dir", analysis, "--out", path.join(dir, "strict.json"),
    "--strict", ...(tier ? ["--tier", tier] : []),
  ], { encoding: "utf8" }).status;

  assert.equal(strict("lite"), 0, "Lite ships a film whose only findings are advisory");
  assert.equal(strict("premium"), 1, "premium repairs heroes, so the same findings are actionable");
  assert.equal(strict(null), 1, "with no tier to consult, any finding still fails as before");
});

test("--tier rejects a tier the policy has no rows for", (t) => {
  const { dir, analysis } = job(t, { heroScores: [0.1], tier: "lite" });
  const run = spawnSync(process.execPath, [
    "scripts/qaProxy.mjs", path.join(dir, "timeline.json"),
    "--analysis-dir", analysis, "--out", path.join(dir, "bad.json"), "--tier", "gold",
  ], { encoding: "utf8" });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /--tier must be one of/);
});
