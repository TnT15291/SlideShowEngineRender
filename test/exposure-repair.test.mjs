import test from "node:test";
import assert from "node:assert/strict";
import { planExposureRepair } from "../scripts/lib/exposureRepair.mjs";
import {
  FRAME_DARK_YAVG, FRAME_DARK_LENIENT_YAVG, FRAME_BRIGHT_YAVG,
  EXPOSURE_REPAIR_MARGIN, EXPOSURE_REPAIR_MAX,
} from "../scripts/lib/rules/thresholds.mjs";

const cardWith = (grade) => ({
  id: "s01", effect: "layer_scene",
  layers: [
    { type: "rect", x: 0, y: 0, width: 1920, height: 1080, color: "#FBF6ED", opacity: 1 },
    { type: "image", path: "p.jpg", x: 650, y: 290, width: 620, height: 500, fit: "cover", ...(grade ? { grade } : {}) },
  ],
});
const fullFrame = (color) => ({ id: "s02", effect: "still", image: "p.jpg", ...(color ? { color } : {}) });

// The grade has to land where the renderer will read it: buildLayerSceneCommand applies
// layer.grade and never reads slide.color, while every other effect path runs the
// slide-level colour filter. Writing to the wrong one validates and does nothing.
test("a card is graded on the photograph that was measured; other scenes on the slide", () => {
  const card = planExposureRepair({ slide: cardWith(), problem: { flags: ["too_bright"], yavg: 240, layer: 1 } });
  assert.equal(card.layer, 1);
  assert.equal(card.holder, "grade");

  const still = planExposureRepair({ slide: fullFrame(), problem: { flags: ["too_bright"], yavg: 240, layer: null } });
  assert.equal(still.layer, null);
  assert.equal(still.holder, "color");
});

test("the correction aims past the threshold, not onto it", () => {
  // fix-once means there is no second attempt, so landing exactly on the line would come
  // back flagged after the re-render and stay flagged.
  const plan = planExposureRepair({ slide: cardWith(), problem: { flags: ["too_bright"], yavg: 240, layer: 1 } });
  const aim = FRAME_BRIGHT_YAVG - EXPOSURE_REPAIR_MARGIN;
  assert.equal(plan.next.brightness, +((aim - 240) / 255).toFixed(3));
  assert.ok(plan.next.brightness < 0, "a bright frame is darkened");
  // Applying it moves the measurement to the aim point, which is inside the threshold.
  assert.ok(240 + plan.next.brightness * 255 < FRAME_BRIGHT_YAVG - 1);
});

test("a dark frame is lifted, and montages keep their lenient floor", () => {
  const card = planExposureRepair({ slide: cardWith(), problem: { flags: ["too_dark"], yavg: 30, layer: 1 } });
  assert.ok(card.next.brightness > 0);
  assert.equal(card.next.brightness, +((FRAME_DARK_YAVG + EXPOSURE_REPAIR_MARGIN - 30) / 255).toFixed(3));

  // A montage is allowed to run darker by design — the same allowance qaClip makes when it
  // raises the flag, so the two cannot disagree about what "dark enough" means.
  const montage = planExposureRepair({
    slide: { id: "m", effect: "collage_grid", images: ["a.jpg"] },
    problem: { flags: ["too_dark"], yavg: 12, layer: null },
  });
  assert.equal(montage.next.brightness, +((FRAME_DARK_LENIENT_YAVG + EXPOSURE_REPAIR_MARGIN - 12) / 255).toFixed(3));
  assert.ok(montage.next.brightness < card.next.brightness, "a montage needs less lifting than a card");
});

test("an existing grade is added to, not replaced", () => {
  const plan = planExposureRepair({
    slide: cardWith({ saturation: 1.1, contrast: 1.05, brightness: -0.02 }),
    problem: { flags: ["too_bright"], yavg: 240, layer: 1 },
  });
  assert.equal(plan.next.saturation, 1.1, "the authored look survives the repair");
  assert.equal(plan.next.contrast, 1.05);
  assert.equal(plan.next.brightness, +(-0.02 + (FRAME_BRIGHT_YAVG - EXPOSURE_REPAIR_MARGIN - 240) / 255).toFixed(3));
});

test("the correction is bounded — past a point the photograph is wrong, not its exposure", () => {
  const plan = planExposureRepair({ slide: cardWith(), problem: { flags: ["too_dark"], yavg: 0, layer: 1 } });
  assert.ok(Math.abs(plan.next.brightness) <= EXPOSURE_REPAIR_MAX);
  const hot = planExposureRepair({ slide: cardWith(), problem: { flags: ["too_bright"], yavg: 255, layer: 1 } });
  assert.ok(Math.abs(hot.next.brightness) <= EXPOSURE_REPAIR_MAX);
});

test("a flat frame gets contrast, with its mean held where it was", () => {
  const flat = planExposureRepair({ slide: cardWith(), problem: { flags: ["flat_or_empty"], yavg: 200, range: 20, layer: 1 } });
  assert.ok(flat.next.contrast > 1);
  // Contrast pivots about the midpoint, so on a frame at 200 it would drag the mean up and
  // over the too_bright line. Brightness compensates to leave the mean exactly where it was.
  const after = ((200 / 255 - 0.5) * flat.next.contrast + 0.5 + flat.next.brightness) * 255;
  assert.ok(Math.abs(after - 200) < 1, `mean moved to ${after.toFixed(1)}`);
  assert.ok(after < FRAME_BRIGHT_YAVG, "fixing flatness must not create a too_bright");
});

// A blown-out frame is flat BECAUSE its highlights are clipped; the flatness is the symptom.
// Stretching contrast around the midpoint drives the mean further out than the bounded
// brightness correction can pull back — measured, the pair landed at 231 against a 224 line
// with brightness already pinned to its cap.
test("when a frame is both blown out and flat, the exposure is fixed and contrast left alone", () => {
  const both = planExposureRepair({
    slide: cardWith(), problem: { flags: ["too_bright", "flat_or_empty"], yavg: 240, range: 20, layer: 1 },
  });
  assert.equal(both.next.contrast, undefined, "contrast would fight the exposure correction");
  assert.ok(both.next.brightness < 0);
  const after = ((240 / 255 - 0.5) + 0.5 + both.next.brightness) * 255;
  assert.ok(after < FRAME_BRIGHT_YAVG, `landed at ${after.toFixed(1)}`);
});

test("nothing to do returns null rather than an empty grade", () => {
  // The layer named is not an image — a stale report against an edited timeline.
  assert.equal(planExposureRepair({ slide: cardWith(), problem: { flags: ["too_bright"], yavg: 240, layer: 0 } }), null);
  // No layer at that index at all.
  assert.equal(planExposureRepair({ slide: cardWith(), problem: { flags: ["too_bright"], yavg: 240, layer: 9 } }), null);
  // A flag with no measurement behind it.
  assert.equal(planExposureRepair({ slide: cardWith(), problem: { flags: ["too_bright"], yavg: null, layer: 1 } }), null);
  // Already corrected to the cap: there is no further move to make.
  assert.equal(planExposureRepair({
    slide: cardWith({ brightness: -EXPOSURE_REPAIR_MAX }),
    problem: { flags: ["too_bright"], yavg: 255, layer: 1 },
  }), null);
  assert.equal(planExposureRepair({ slide: null, problem: { flags: ["too_bright"], yavg: 240 } }), null);
});

test("a repair the schema would reject is never produced", () => {
  // layer grade: brightness +/-0.3, contrast 0.5..2 (schema/timeline.schema.json).
  for (const yavg of [0, 10, 42, 128, 224, 250, 255]) {
    for (const flags of [["too_dark"], ["too_bright"]]) {
      const plan = planExposureRepair({ slide: cardWith(), problem: { flags, yavg, layer: 1 } });
      if (!plan) continue;
      assert.ok(plan.next.brightness >= -0.3 && plan.next.brightness <= 0.3, `brightness ${plan.next.brightness}`);
    }
  }
  for (const range of [1, 5, 20, 37]) {
    const plan = planExposureRepair({ slide: cardWith(), problem: { flags: ["flat_or_empty"], range, layer: 1 } });
    if (!plan) continue;
    assert.ok(plan.next.contrast >= 0.5 && plan.next.contrast <= 2, `contrast ${plan.next.contrast}`);
  }
});

// Computed independently, the two corrections fight. ffmpeg's eq is
// `out = (in - 0.5) * contrast + 0.5 + brightness`, so contrast pivots about the MIDPOINT
// and on an off-centre frame moves the mean as well. A blown-out frame measured at 232 came
// back from `brightness -0.08, contrast 1.4` at 252 — brighter than it started.
test("contrast and brightness are solved together, not independently", () => {
  const model = (mean, { brightness = 0, contrast = 1 }) => ((mean - 0.5) * contrast + 0.5 + brightness) * 255;
  // Whatever combination comes out, re-rendering through it must land inside the band. This
  // is the guard on the interaction itself: any future change that reintroduces two
  // independent corrections fails here.
  for (const [yavg, range] of [[232, 14], [240, 20], [235, 30], [30, 12], [20, 25]]) {
    const flags = [yavg > FRAME_BRIGHT_YAVG ? "too_bright" : "too_dark", ...(range < 38 ? ["flat_or_empty"] : [])];
    const plan = planExposureRepair({ slide: cardWith(), problem: { flags, yavg, range, layer: 1 } });
    if (!plan) continue;
    const predicted = model(yavg / 255, plan.next);
    if (flags.includes("too_bright")) {
      assert.ok(predicted < yavg, `${yavg}/${range}: correction made a bright frame brighter (${predicted.toFixed(1)})`);
    } else {
      assert.ok(predicted > yavg, `${yavg}/${range}: correction made a dark frame darker (${predicted.toFixed(1)})`);
    }
  }
});

// The measurement qaClip took already includes whatever grade was on the target, so a second
// pass must undo it before solving or it corrects as though the first never happened.
test("a correction accounts for the grade already applied when the frame was measured", () => {
  const model = (mean, { brightness = 0, contrast = 1 }) => ((mean - 0.5) * contrast + 0.5 + brightness) * 255;
  // Source frame at 250 already carries brightness -0.05, so it rendered — and measured — at 237.
  const measured = model(250 / 255, { brightness: -0.05 });
  const plan = planExposureRepair({
    slide: cardWith({ brightness: -0.05 }),
    problem: { flags: ["too_bright"], yavg: measured, layer: 1 },
  });
  // Re-render from the SOURCE with the new grade and land on the aim point.
  const after = model(250 / 255, plan.next);
  assert.ok(Math.abs(after - (FRAME_BRIGHT_YAVG - EXPOSURE_REPAIR_MARGIN)) < 1,
    `landed at ${after.toFixed(1)}, aimed for ${FRAME_BRIGHT_YAVG - EXPOSURE_REPAIR_MARGIN}`);
});
