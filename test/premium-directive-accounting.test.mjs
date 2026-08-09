// Directive accounting: what a customer's sentence is allowed to cost them.
//
// The receipt this file was written from — projects/layout-primitives-premium-baseline,
// measured 2026-08-04. One ordinary order, "mở đầu tĩnh", compiled to a perfectly valid
// effect/set on the opening act. The sweep rewrote all seven applicable scenes into
// single-photo stills, three of which were six-photo montages. Fifteen of the couple's
// photographs left the film. Three scenes kept the nine seconds that had been budgeted
// for six images and spent them on one. Seven still frames ran back to back for
// forty-seven seconds — a quarter of a 189-second film with no movement in it at all.
//
// Every gate said verdict=ok, because the only rule that could see it (layout_repetition)
// is a warning, and the only metric that counted it (selectedNotRendered) was wired to
// nothing.
//
// The rule these tests enforce: lowering photo demand is safe for the COMPILER — the
// assignment simply fills fewer slots — and unsafe for the FILM. A directive may change
// what the film looks like. It may not quietly spend the customer's photographs.

import { test } from "node:test";
import assert from "node:assert/strict";

import { applyToStoryboard, audit } from "../scripts/lib/directives.mjs";
import { MAX_LAYOUT_RUN } from "../scripts/lib/rules/thresholds.mjs";
import {
  sweepStoryboard, STILL_OPENING, photoDemand, totalDemand, longestEffectRun,
} from "./fixtures/premium-directive-sweep.mjs";

const apply = (doc, orders, extra = {}) => {
  const report = {};
  const applied = applyToStoryboard(doc, orders, { availablePhotos: 30, photoDemand, report, ...extra });
  return { applied, report };
};

test("a look ordered over an act does not spend the photographs it frees", () => {
  const doc = sweepStoryboard();
  const before = totalDemand(doc.scenes);

  const { applied, report } = apply(doc, [STILL_OPENING]);

  assert.deepEqual(applied, ["r0.1"], "the order was not applied at all");
  const after = totalDemand(doc.scenes);
  assert.equal(
    after, before,
    `photo demand fell ${before} -> ${after}: ${before - after} of the couple's photographs `
    + `were freed by the directive and handed back to nobody`,
  );
  assert.equal(report.photoLost, 0, `report says ${report.photoLost} photo(s) lost with room to reallocate`);
  assert.equal(report.photoFreed, report.photoReallocated, "freed and reallocated disagree");
});

test("a look ordered over an act stops at MAX_LAYOUT_RUN instead of flattening it", () => {
  // §4.3(b): honour the customer's intent from the top of the act, then stop. Seven
  // identical scenes is not what "mở đầu tĩnh" asks for; it is what it produced.
  const doc = sweepStoryboard();

  const { report } = apply(doc, [STILL_OPENING]);

  const run = longestEffectRun(doc.scenes);
  assert.ok(
    run <= MAX_LAYOUT_RUN,
    `${run} consecutive scenes share one effect (cap ${MAX_LAYOUT_RUN})`,
  );
  assert.equal(report.runsCapped, 1, "the cap fired but was not reported to the customer");
  assert.ok(
    doc.scenes.some((s) => s.act === "opening" && s.effect === "collage_grid"),
    "the cap should have left the act's later montages standing",
  );
});

test("a scene the directive reshaped does not keep the seconds solved for its old shape", () => {
  // A composed storyboard's durationSec was solved against the photo budget. Once the
  // directive changes what a scene shows, that number is describing something that no
  // longer exists — a six-image memory wall's nine seconds, spent on one still frame.
  const doc = sweepStoryboard();

  apply(doc, [STILL_OPENING]);

  for (const id of ["s02", "s04"]) {
    const scene = doc.scenes.find((s) => s.id === id);
    assert.equal(scene.effect, "still", `${id} was not swept`);
    assert.ok(
      scene.durationSec === undefined,
      `${id} is a one-photo still still holding ${scene.durationSec}s of montage time`,
    );
  }
});

test("the report names every scene the directive rewrote", () => {
  const doc = sweepStoryboard();

  const { report } = apply(doc, [STILL_OPENING]);

  assert.equal(report.scenesRewritten, 2, "s02 and s04 are the only scenes that changed shape");
  assert.equal(report.photoFreed, 10, "5 from the memory wall and 5 from the film strip");
  assert.deepEqual(report.byOrder?.["r0.1"]?.scenes, ["s02", "s04"]);
});

test("a montage directive still absorbs its neighbours rather than inflating demand", () => {
  // The behaviour the accounting must not disturb. Retargeting a 1-photo scene into an
  // 8-photo film roll adds slots nobody can fill and kills the build; a montage therefore
  // absorbs neighbouring beats, inheriting their photos and their seconds.
  const doc = sweepStoryboard();
  const before = totalDemand(doc.scenes);
  const sceneCount = doc.scenes.length;

  const { applied } = apply(doc, [{
    ...STILL_OPENING, id: "m1", target: "film_roll_up", scope: { act: "love_story" },
  }]);

  assert.deepEqual(applied, ["m1"]);
  assert.equal(totalDemand(doc.scenes), before, "a montage must not change net photo demand");
  assert.ok(doc.scenes.length < sceneCount, "the absorbed scenes are still there");
});

test("an empty ledger changes nothing", () => {
  const doc = sweepStoryboard();
  const untouched = JSON.stringify(sweepStoryboard());

  const { applied, report } = apply(doc, []);

  assert.deepEqual(applied, []);
  assert.equal(JSON.stringify(doc), untouched);
  assert.equal(report.scenesRewritten ?? 0, 0);
});

// ---------------------------------------------------------------------------
// The receipt
// ---------------------------------------------------------------------------

/** The film the fixture's opening act becomes: three still frames where the cap stopped,
 *  the act's later scenes left alone. Enough of a timeline for audit() to read. */
const cappedTimeline = () => ({
  slides: [
    { id: "s01", act: "opening", effect: "layer_scene", layers: [{ type: "text", text: "A & B" }], captions: [] },
    ...["s02", "s03", "s04"].map((id) => ({ id, act: "opening", effect: "still", image: `${id}.jpg`, captions: [] })),
    { id: "s05", act: "opening", effect: "slow_zoom_in", image: "e.jpg", captions: [] },
    { id: "s07", act: "opening", effect: "collage_grid", images: ["f.jpg", "g.jpg"], captions: [] },
  ],
});

const cappedImpact = {
  byOrder: { "r0.1": { quote: "mở đầu tĩnh", scenes: ["s02", "s04"], freed: 10, reallocated: 10, lost: 0, capped: true, reasons: ["run_cap"] } },
};

test("an order the run cap stopped short is reported as carried out, at a stated price", () => {
  // Without the receipt, auditOne reads the finished timeline, sees "still on 3 of 7 photo
  // slides", and calls a `must` order BROKEN — which fails the compliance gate and the whole
  // job. The cap is our decision, not the film disobeying; the customer is owed the
  // distinction and the reason, and the job is not owed a failure for it.
  const report = audit([STILL_OPENING], cappedTimeline(), { directiveImpact: cappedImpact });

  const row = report.results[0];
  assert.equal(row.honored, true, `capped order scored ${row.honored}: ${row.evidence}`);
  assert.equal(report.appliedWithCost, 1, "a partial application must not be counted as a plain success");
  assert.ok(report.pass, "a capped order must not fail the compliance gate");
  assert.ok(row.cost.notes.length, "the price was recorded but not explained");
  assert.deepEqual(row.cost.scenes, ["s02", "s04"]);
});

test("without a receipt the audit does not invent one", () => {
  // audit()'s standing rule: never report a win it cannot evidence. No impact ledger means
  // no grounds to upgrade anything, and the timeline's own verdict stands.
  const report = audit([STILL_OPENING], cappedTimeline(), {});

  assert.equal(report.appliedWithCost, 0);
  assert.equal(report.results[0].cost, undefined);
  assert.equal(report.results[0].honored, false, "the unaided timeline reading should be unchanged");
});

test("a photo-poor album is told what it could not absorb, not left to guess", () => {
  // No montage anywhere with room to grow: the freed photographs genuinely have nowhere
  // to go. That is allowed. Losing them silently is not.
  const doc = sweepStoryboard();
  doc.scenes = doc.scenes.filter((s) => !["s10", "s11"].includes(s.id));

  const { report } = apply(doc, [STILL_OPENING]);

  assert.ok(report.photoLost > 0, "this album has nowhere to put the freed photographs");
  assert.equal(report.photoFreed, report.photoReallocated + report.photoLost, "the arithmetic does not close");
  assert.ok(
    report.byOrder?.["r0.1"]?.reasons?.includes("no_montage_capacity"),
    `the loss needs a stated reason, got ${JSON.stringify(report.byOrder?.["r0.1"]?.reasons)}`,
  );
});
