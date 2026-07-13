import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { makePreviewCut } from "../scripts/lib/previewCut.mjs";
import { evaluateTier1Quality } from "../scripts/lib/tier1QualityGate.mjs";

const suite = JSON.parse(fs.readFileSync("test/fixtures/tier1-albums.json", "utf8"));

function timelineFor(fixture) {
  const slides = ["hook", "connection", "build", "peak", "closing"].map((beat, i) => ({
    id: beat, editorialBeat: beat, duration: beat === "closing" ? (fixture.closingSeconds ?? 6) : 5,
    effect: fixture.repeatLayout ? "still" : i % 2 ? "polaroid" : "layer_scene",
    layout: fixture.repeatLayout ? "full" : `layout-${i % 3}`, image: `input/${i + 1}.jpg`,
    transition: { type: beat === "closing" ? "none" : "crossfade", duration: beat === "closing" ? 0 : 0.6 },
    layers: fixture.unsafeText && i === 1 ? [{ type: "text", text: "Unsafe", x: 0, y: 0, width: 500, height: 100 }] : [],
  }));
  return { project: { name: fixture.id, width: 1920, height: 1080, quality: "share" },
    recipeDecisions: { recipeId: "fixture-recipe" }, output: { path: `${fixture.id}.mp4` }, slides,
    overlays: fixture.fullOverlay ? [{ variant: "warm" }] : [],
    photoAssignment: { customerLocks: { mustUsePhotos: fixture.mustUse || [] } } };
}

test("Tier-1 album-shape regression fixtures keep their expected QA and preview outcomes", () => {
  const rows = suite.cases.map((fixture) => {
    const timeline = timelineFor(fixture);
    const gate = evaluateTier1Quality(timeline);
    const preview = makePreviewCut(timeline, { duration: 20 });
    const flags = [...gate.errors, ...gate.warnings, ...gate.manualReview].flatMap((f) => f.flags);
    return { fixture, gate, preview, flags };
  });
  for (const { fixture, gate, preview, flags } of rows) {
    assert.equal(gate.verdict, fixture.expected, `${fixture.id}: unexpected QA verdict`);
    if (fixture.flag) assert.ok(flags.includes(fixture.flag), `${fixture.id}: missing ${fixture.flag}`);
    assert.ok(preview.preview.sourceSceneIds.includes("hook"), `${fixture.id}: preview lost hook`);
    assert.ok(preview.preview.sourceSceneIds.includes("closing"), `${fixture.id}: preview lost closing`);
    assert.ok(preview.slides.reduce((n, s) => n + s.duration, 0) <= 20.1, `${fixture.id}: preview exceeds budget`);
  }
});
