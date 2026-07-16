// The rules layer's own guarantees: every check the QA emitters produce is
// declared in the contract registry, every declared rule has a policy row in
// every tier, and a policy can only ask for repairs qaLoop actually implements.
// This is what makes "adding a rule = one registry entry + one policy row"
// enforceable instead of aspirational.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { SCOPES, REPAIR_KINDS, RULES, isKnownRule } from "../scripts/lib/rules/contract.mjs";
import { TIERS, POLICY, actionFor, coverageMatrix } from "../scripts/lib/rules/policy.mjs";
import {
  BLACK_FRAME_YAVG, FRAME_DARK_LENIENT_YAVG, FRAME_DARK_YAVG, FRAME_BRIGHT_YAVG,
  HIGHLIGHT_MIN_SEC, HIGHLIGHT_MAX_SEC, FOCUS_SAFE_MIN, FOCUS_SAFE_MAX,
} from "../scripts/lib/rules/thresholds.mjs";

const EMITTERS = ["scripts/qaProxy.mjs", "scripts/qaClip.mjs", "scripts/lib/tier1QualityGate.mjs"];
const VALID_ACTIONS = ["block", "repair", "manual-review", "warn"];

test("every check emitted in the QA sources is declared in the contract registry", () => {
  for (const file of EMITTERS) {
    const source = fs.readFileSync(file, "utf8");
    for (const [, check] of source.matchAll(/check: "([a-z_]+)"/g)) {
      assert.ok(isKnownRule(check), `${file} emits check "${check}" — declare it in lib/rules/contract.mjs`);
    }
  }
});

test("registry rules have a valid scope and only reference implemented repair kinds", () => {
  for (const [check, rule] of Object.entries(RULES)) {
    assert.ok(SCOPES.includes(rule.scope), `${check}: unknown scope "${rule.scope}"`);
    for (const repair of rule.repairs) {
      assert.ok(REPAIR_KINDS.includes(repair), `${check}: repair "${repair}" is not implemented by qaLoop`);
    }
  }
});

test("every tier has a policy row for every rule, and vice versa", () => {
  for (const tier of TIERS) {
    assert.deepEqual(Object.keys(POLICY[tier]).sort(), Object.keys(RULES).sort(), `tier "${tier}"`);
    for (const [check, row] of Object.entries(POLICY[tier])) {
      assert.ok(VALID_ACTIONS.includes(row.action), `${tier}/${check}: unknown action "${row.action}"`);
      // "repair" is a promise qaLoop can keep only if the rule declares a repair.
      if (row.action === "repair") {
        assert.ok(RULES[check].repairs.length > 0, `${tier}/${check}: action is repair but the rule declares no repair kinds`);
      }
    }
  }
});

test("policy lookups fail loudly on unknown tiers and undeclared rules", () => {
  assert.equal(actionFor("premium", "pacing"), "repair");
  assert.throws(() => actionFor("gold", "pacing"), /unknown tier/);
  assert.throws(() => actionFor("premium", "vibes"), /unknown rule/);
});

test("lite blocks integrity failures, repairs cheap defects, and only warns on taste", () => {
  for (const check of ["must_use_coverage", "text_safe_area", "caption_integrity", "closing_card",
    "black_frame", "music_edit", "audio_drift"]) {
    assert.equal(actionFor("lite", check), "block", check);
  }
  for (const check of ["text_overflow", "crop", "pacing", "frame_brightness"]) {
    assert.equal(actionFor("lite", check), "repair", check);
  }
  for (const check of ["duplicate_photo", "layout_repetition", "overlay_repetition", "hero"]) {
    assert.equal(actionFor("lite", check), "warn", check);
  }
});

test("coverage matrix covers tier x rule exactly once", () => {
  const matrix = coverageMatrix();
  assert.equal(matrix.length, TIERS.length * Object.keys(RULES).length);
  const keys = new Set(matrix.map((r) => `${r.tier}:${r.check}`));
  assert.equal(keys.size, matrix.length);
});

test("thresholds keep their ordering invariants", () => {
  assert.ok(BLACK_FRAME_YAVG < FRAME_DARK_LENIENT_YAVG, "black must sit below lenient-dark");
  assert.ok(FRAME_DARK_LENIENT_YAVG < FRAME_DARK_YAVG, "lenient-dark must sit below dark");
  assert.ok(FRAME_DARK_YAVG < FRAME_BRIGHT_YAVG, "dark must sit below bright");
  assert.ok(HIGHLIGHT_MIN_SEC < HIGHLIGHT_MAX_SEC);
  assert.ok(FOCUS_SAFE_MIN < FOCUS_SAFE_MAX);
});

// The emitters are CLIs that run on import; a broken rules-layer import path
// would only surface when a real job runs. Spawning them far enough to hit
// their own usage errors proves module resolution end to end.
test("qaClip and qaLoop resolve their rules-layer imports", () => {
  const clip = spawnSync(process.execPath, ["scripts/qaClip.mjs"], { encoding: "utf8" });
  assert.notEqual(clip.status, 0);
  assert.doesNotMatch(clip.stderr, /ERR_MODULE_NOT_FOUND/, clip.stderr);
  assert.match(clip.stderr, /Usage/, clip.stderr);
  const loop = spawnSync(process.execPath, ["scripts/qaLoop.mjs", "--timeline", "timeline/does-not-exist.json"], { encoding: "utf8" });
  assert.notEqual(loop.status, 0);
  assert.doesNotMatch(loop.stderr, /ERR_MODULE_NOT_FOUND/, loop.stderr);
  assert.match(loop.stderr + loop.stdout, /timeline not found/, loop.stderr);
});

test("lite qaLoop stops an unresolved integrity blocker before render", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lite-rule-gate-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const timeline = path.join(dir, "timeline.json");
  const analysis = path.join(dir, "analysis");
  fs.writeFileSync(timeline, JSON.stringify({
    project: { name: "lite-gate", width: 1920, height: 1080 },
    output: { path: path.join(dir, "must-not-render.mp4") },
    photoAssignment: { customerLocks: { mustUsePhotos: ["required.jpg"] } },
    slides: [{ id: "closing", editorialBeat: "closing", duration: 3, effect: "still", image: "other.jpg", layers: [] }],
  }));
  const result = spawnSync(process.execPath, ["scripts/qaLoop.mjs", "--timeline", timeline,
    "--analysis-dir", analysis, "--tier", "lite", "--skip-render"], { encoding: "utf8" });
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stderr, /PRE-RENDER GATE FAILED/);
  assert.equal(fs.existsSync(path.join(dir, "must-not-render.mp4")), false);
});
