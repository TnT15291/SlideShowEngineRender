// The visual assigner (N2 of PLAN-NARRATED-PRODUCT.md).
//
// Placing 99 pictures across 53 beats by hand was the one thing standing between
// this pipeline and a second film. The rules under test are read back off that
// hand-assigned cut rather than invented — see the header of
// scripts/lib/visualAssigner.mjs for the measurements.
import { test } from "node:test";
import assert from "node:assert/strict";

import { assignVisuals, distribute, hasAuthoredVisual, LANDSCAPE_EFFECTS, PORTRAIT_EFFECT } from "../scripts/lib/visualAssigner.mjs";

/** A group as planGroups() produces it: one window, already split into parts. */
function group(beats, { part = 1, partCount = 1, start = 0, end = 5 } = {}) {
  return { start, end, speechEnd: end, part, partCount, beats };
}
const beat = (id, section = "s1") => ({ id, section, narration: "x", visual: { kind: "pending" } });
const photo = (file, orient) => ({ file, orient });
const flat = (assignments) => [...assignments.values()].flat();

test("landscape frames are spent before portrait ones, which is the whole pillarbox figure", () => {
  // The ANTT album is 121/339 portrait, and the hand cut still came in at 7.4%
  // non-landscape. It did that by reaching for the landscape frames first.
  const photos = [photo("p/a.jpg", "portrait"), photo("p/b.jpg", "landscape"), photo("p/c.jpg", "portrait"), photo("p/d.jpg", "landscape")];
  const { assignments } = assignVisuals({
    groups: [group([beat("b1")]), group([beat("b2")])],
    sectionPools: { s1: ["all"] },
    pools: { all: [0, 1, 2, 3] },
    photos,
    clips: [],
    slideDuration: () => 5,
  });
  assert.deepEqual(flat(assignments).map((visual) => visual.src), ["p/b.jpg", "p/d.jpg"]);
});

test("a photograph that cannot be avoided being tall gets a frame-filling treatment", () => {
  // Bars down both sides are the visible failure. portrait_blur_background fills
  // the frame with a blurred copy instead — 5 of the 6 non-landscape frames in
  // the hand cut carry it.
  const { assignments } = assignVisuals({
    groups: [group([beat("b1")]), group([beat("b2")])],
    sectionPools: { s1: ["all"] },
    pools: { all: [0, 1] },
    photos: [photo("p/wide.jpg", "landscape"), photo("p/tall.jpg", "portrait")],
    clips: [],
    slideDuration: () => 5,
  });
  const [wide, tall] = flat(assignments);
  assert.ok(LANDSCAPE_EFFECTS.includes(wide.effect), "a landscape frame moves");
  assert.equal(tall.effect, PORTRAIT_EFFECT);
});

test("no photograph is used twice, and no cut lands on the same motion as the one before it", () => {
  const photos = Array.from({ length: 12 }, (_, i) => photo(`p/${i}.jpg`, "landscape"));
  const { assignments, warnings } = assignVisuals({
    groups: Array.from({ length: 12 }, (_, i) => group([beat(`b${i}`)])),
    sectionPools: { s1: ["all"] },
    pools: { all: photos.map((_, i) => i) },
    photos,
    clips: [],
    slideDuration: () => 5,
  });
  const picked = flat(assignments);
  assert.equal(picked.length, 12);
  assert.equal(new Set(picked.map((visual) => visual.src)).size, 12, "every frame is distinct");
  assert.deepEqual(warnings, []);
  for (let i = 1; i < picked.length; i += 1) {
    assert.notEqual(picked[i].effect, picked[i - 1].effect, `slides ${i - 1} and ${i} share a motion`);
  }
});

test("a window split into parts is given one picture per part", () => {
  // splitWindow cuts anything longer than maxShotDuration into partCount pieces,
  // and the builder spends visuals[part-1]. One short is a hard gate failure.
  const photos = Array.from({ length: 6 }, (_, i) => photo(`p/${i}.jpg`, "landscape"));
  const { assignments } = assignVisuals({
    groups: [group([beat("b1")], { part: 1, partCount: 3 }), group([beat("b1")], { part: 2, partCount: 3 }), group([beat("b1")], { part: 3, partCount: 3 })],
    sectionPools: { s1: ["all"] },
    pools: { all: [0, 1, 2, 3, 4, 5] },
    photos,
    clips: [],
    slideDuration: () => 5,
  });
  assert.equal(assignments.get("b1").length, 3);
});

test("what the editor wrote is left alone, and the frames it uses are struck off the pool", () => {
  const authored = { id: "b1", section: "s1", visual: { kind: "photo", src: "p/chosen.jpg", effect: "pan_up" } };
  const { assignments } = assignVisuals({
    groups: [group([authored]), group([beat("b2")])],
    sectionPools: { s1: ["all"] },
    pools: { all: [0, 1] },
    photos: [photo("p/chosen.jpg", "landscape"), photo("p/other.jpg", "landscape")],
    clips: [],
    slideDuration: () => 5,
  });
  assert.equal(assignments.has("b1"), false, "an authored beat is not rewritten");
  assert.deepEqual(flat(assignments).map((visual) => visual.src), ["p/other.jpg"], "and its photograph is not handed out again");
});

test("a clip opens a section, but only one long enough to cover its slide", () => {
  const photos = [photo("p/a.jpg", "landscape"), photo("p/b.jpg", "landscape")];
  const shared = {
    sectionPools: { s1: ["all"] },
    pools: { all: [0, 1] },
    photos,
    slideDuration: () => 8,
  };
  const long = assignVisuals({ ...shared, groups: [group([beat("b1")])], clips: [{ file: "f/long.mp4", duration: 12 }] });
  assert.equal(flat(long.assignments)[0].kind, "clip", "a 12s clip covers an 8s slide");

  // The builder throws on a clip shorter than its slide. Catching it here means
  // the film is never assembled into a state that cannot be built.
  const short = assignVisuals({ ...shared, groups: [group([beat("b1")])], clips: [{ file: "f/short.mp4", duration: 3 }] });
  assert.equal(flat(short.assignments)[0].kind, "photo", "a 3s clip is passed over for a photograph");
});

test("running out of photographs warns instead of inventing one or throwing", () => {
  // A section can simply have more script than pictures. Failing loudly per beat
  // tells the editor exactly which pool to feed; throwing would hide the rest.
  const { assignments, warnings } = assignVisuals({
    groups: [group([beat("b1")]), group([beat("b2")])],
    sectionPools: { s1: ["thin"] },
    pools: { thin: [0] },
    photos: [photo("p/only.jpg", "landscape")],
    clips: [],
    slideDuration: () => 5,
  });
  assert.equal(flat(assignments).length, 1);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ran out of unused photographs/);
});

test("pools are drawn in the order a section declares them", () => {
  const photos = [photo("p/second.jpg", "landscape"), photo("p/first.jpg", "landscape")];
  const { assignments } = assignVisuals({
    groups: [group([beat("b1")])],
    sectionPools: { s1: ["preferred", "fallback"] },
    pools: { fallback: [0], preferred: [1] },
    photos,
    clips: [],
    slideDuration: () => 5,
  });
  assert.equal(flat(assignments)[0].src, "p/first.jpg");
  assert.equal(flat(assignments)[0].pool, "preferred");
});

test("visuals spread across a merged group's beats rather than piling on the first", () => {
  // Which beat a picture hangs on changes nothing about the film — the builder
  // flattens the group — but it changes a lot about reading script.json.
  assert.deepEqual(distribute(3, 2), [2, 1]);
  assert.deepEqual(distribute(4, 2), [2, 2]);
  assert.deepEqual(distribute(1, 3), [1, 0, 0]);

  const photos = Array.from({ length: 4 }, (_, i) => photo(`p/${i}.jpg`, "landscape"));
  const merged = [beat("b1"), beat("b2")];
  const { assignments } = assignVisuals({
    groups: [group(merged, { part: 1, partCount: 3 }), group(merged, { part: 2, partCount: 3 }), group(merged, { part: 3, partCount: 3 })],
    sectionPools: { s1: ["all"] },
    pools: { all: [0, 1, 2, 3] },
    photos,
    clips: [],
    slideDuration: () => 5,
  });
  assert.equal(assignments.get("b1").length, 2);
  assert.equal(assignments.get("b2").length, 1);
});

test("hasAuthoredVisual treats an empty list as a decision, because that is how a merged beat is silenced", () => {
  assert.equal(hasAuthoredVisual({ visual: { kind: "pending" } }), false);
  assert.equal(hasAuthoredVisual({ visual: { kind: "photo", src: "x" } }), true);
  assert.equal(hasAuthoredVisual({ visuals: [] }), true);
  assert.equal(hasAuthoredVisual({}), false);
});
