import test from "node:test";
import assert from "node:assert/strict";
import { buildLiteQualityReport } from "../scripts/lib/liteQualityReport.mjs";
import { tuanTienLiteRegression } from "./fixtures/tuan-tien-lite-regression.mjs";
import { evaluateQualityReport } from "../scripts/lib/rules/verdict.mjs";

test("frozen Tuân Tiên fixture reproduces Lite v1 quality failures", () => {
  const fixture = tuanTienLiteRegression;
  const report = buildLiteQualityReport({
    timeline: fixture.timeline,
    photos: fixture.photos,
    proxy: fixture.proxy,
    qaLoop: fixture.qaLoop,
    musicDuration: fixture.music.duration,
  });
  assert.equal(report.photos.selected, 84);
  assert.equal(report.scenes, 43);
  assert.ok(report.photos.withinSceneDuplicates.length >= 20);
  assert.ok(report.photos.adjacentDuplicates.length > 0);
  assert.ok(Math.max(...Object.values(report.effectCounts)) >= 15);
  assert.ok(report.text.estimatedOverflow >= 9);
  assert.ok(Math.abs(report.music.drift) > 30);
  assert.deepEqual(report.verdicts, { qa: "clean", delivery: "failed", mismatch: true });
});

test("QA and delivery evaluate the same Lite report to the same policy verdict", () => {
  const report = tuanTienLiteRegression.proxy;
  const qa = evaluateQualityReport({ tier: "lite", report });
  const delivery = evaluateQualityReport({ tier: "lite", report });
  assert.equal(qa.verdict, "block");
  assert.deepEqual(delivery, qa);
  assert.equal(qa.policyVersion, 2);
  assert.equal(qa.actions.block.length, 22);
});
