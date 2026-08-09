// A composed film's own face (scripts/lib/composedLooks.mjs).
//
// This is the riskiest thing in the composed path: it MOVES PHOTOGRAPHS. Everything else a
// generated film does is picking from a menu the library already vetted; a look invents
// geometry. So the tests here are mostly about what it must never do — leave the canvas,
// bury the words, shrink a photograph below the coverage floor, collide two frames the
// layout kept apart — and one about what it must always do: actually move something.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  deriveComposedLooks, composedGrade, nudgeGrade, composedFrame, ARRANGEMENT_VARIANTS,
} from "../scripts/lib/composedLooks.mjs";
import { validateLook, resolveScene, rotatedSlotBounds } from "../scripts/lib/lookResolver.mjs";
import { photoArrangementKey } from "../scripts/lib/geometrySignature.mjs";
import { SLOT_AREA_FLOOR, SLOT_AREA_FLOOR_GRID, SCENE_PHOTO_COVERAGE_MIN, SCENE_PHOTO_COVERAGE_MIN_TEXTED }
  from "../scripts/lib/rules/thresholds.mjs";

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
const canvas = library.meta.canvas;
const layoutOf = (id) => library.layouts.find((l) => l.id === id);

/** One card per layout in the library, so a derivation run touches every primitive. */
const everyLayout = () => library.layouts.map((layout, index) => ({
  id: `s${String(index + 1).padStart(2, "0")}`, effect: "layer_scene", layout: layout.id, text: {},
}));

test("every look derived across the whole library passes the resolver's own validation", () => {
  // V1-V5: unknown layout, inventing a slot, changing the slot COUNT, leaving the canvas,
  // and burying the text. The generator proposes; validateLook is what decides.
  for (const seed of ["job-a", "job-b", "job-c"]) {
    const scenes = everyLayout();
    const { looks, layoutPresets } = deriveComposedLooks(scenes, { library, theme: "white_weddings", seed });
    for (const [lookId, look] of Object.entries(looks)) {
      const found = validateLook(lookId, look, { template: { looks, layoutPresets }, library });
      assert.deepEqual(found, [], `${seed}/${lookId}: ${found.map((f) => f.detail).join("; ")}`);
    }
  }
});

test("a derived look moves a photograph — it is not a re-skin", () => {
  // The debt the corpus once carried: 269 looks resolving to 123 compositions, because
  // frame, type and grade do not move anything. A look that scores as its own bare layout
  // is worse than no look, since it inflates a diversity count for free.
  const scenes = everyLayout();
  const { looks, layoutPresets } = deriveComposedLooks(scenes, { library, theme: "warm_film", seed: "moves" });
  assert.ok(Object.keys(looks).length >= 8, `only ${Object.keys(looks).length} looks derived across the library`);
  for (const [lookId, look] of Object.entries(looks)) {
    const base = layoutOf(look.layout);
    const bare = photoArrangementKey({ effect: "layer_scene", layout: base.id, resolvedLayout: base }, library, canvas);
    const { scene } = resolveScene({ id: "probe", effect: "layer_scene", look: lookId },
      { template: { looks, layoutPresets }, library });
    assert.notEqual(photoArrangementKey(scene, library, canvas), bare, `${lookId} renders where its layout already was`);
  }
});

test("no derived look drops a photograph below the coverage floor the lint enforces", () => {
  const scenes = everyLayout();
  const { looks, layoutPresets } = deriveComposedLooks(scenes, { library, theme: "white_weddings", seed: "coverage" });
  const area = canvas.width * canvas.height;
  for (const [lookId, look] of Object.entries(looks)) {
    const base = layoutOf(look.layout);
    if (base.background?.type === "photo_full_bleed") continue;
    const { scene } = resolveScene({ id: "probe", effect: "layer_scene", look: lookId },
      { template: { looks, layoutPresets }, library });
    const slots = scene.resolvedLayout.photoSlots;
    const floor = slots.length >= 6 ? SLOT_AREA_FLOOR_GRID : SLOT_AREA_FLOOR;
    let total = 0;
    for (const slot of slots) {
      const fraction = (slot.width * slot.height) / area;
      assert.ok(fraction >= floor, `${lookId} slot ${slot.id} covers ${(fraction * 100).toFixed(1)}%`);
      total += fraction;
    }
    const min = base.textRequired ? SCENE_PHOTO_COVERAGE_MIN_TEXTED : SCENE_PHOTO_COVERAGE_MIN;
    assert.ok(total >= min, `${lookId} covers ${(total * 100).toFixed(1)}%, floor ${(min * 100).toFixed(0)}%`);
  }
});

test("a look stays inside the band its layout already used", () => {
  // This is what keeps a generated arrangement off the words and inside the frame without
  // needing to reason about either: the layout's designer chose where the photographs go,
  // and a look only rearranges what happens inside that rectangle.
  const scenes = everyLayout();
  const { looks, layoutPresets } = deriveComposedLooks(scenes, { library, theme: "editorial_bold", seed: "band" });
  for (const [lookId, look] of Object.entries(looks)) {
    const base = layoutOf(look.layout);
    const backgroundId = base.background?.type === "photo_full_bleed" ? base.background.slot : null;
    const original = base.photoSlots.filter((s) => s.id !== backgroundId).map(rotatedSlotBounds);
    const band = {
      x: Math.min(...original.map((b) => b.x)), y: Math.min(...original.map((b) => b.y)),
      right: Math.max(...original.map((b) => b.right)), bottom: Math.max(...original.map((b) => b.bottom)),
    };
    const { scene } = resolveScene({ id: "probe", effect: "layer_scene", look: lookId },
      { template: { looks, layoutPresets }, library });
    for (const slot of scene.resolvedLayout.photoSlots) {
      if (slot.id === backgroundId) continue;
      const b = rotatedSlotBounds(slot);
      assert.ok(b.x >= band.x - 1 && b.y >= band.y - 1 && b.right <= band.right + 1 && b.bottom <= band.bottom + 1,
        `${lookId} slot ${slot.id} left the layout's photo band`);
    }
  }
});

test("a full-bleed background is never moved", () => {
  // It fills the canvas by definition and stops being a background the moment it is nudged.
  const scenes = everyLayout();
  const { looks } = deriveComposedLooks(scenes, { library, theme: "white_weddings", seed: "bleed" });
  for (const [lookId, look] of Object.entries(looks)) {
    const base = layoutOf(look.layout);
    const backgroundId = base.background?.type === "photo_full_bleed" ? base.background.slot : null;
    if (!backgroundId) continue;
    assert.equal(look.layoutOverrides.photoSlots[backgroundId], undefined,
      `${lookId} nudged the full-bleed background slot`);
  }
});

test("a layout used more than once is given more than one arrangement", () => {
  // 21 cards showing 15 compositions is what the scorecard measured before this existed.
  const scenes = Array.from({ length: 4 }, (_, i) => ({
    id: `s0${i + 1}`, effect: "layer_scene", layout: "three_photo_row", text: {},
  }));
  const { looks } = deriveComposedLooks(scenes, { library, theme: "white_weddings", seed: "repeat" });
  const used = new Set(scenes.map((s) => s.look));
  assert.ok(used.size >= 2, `four cards on one layout share ${used.size} arrangement(s)`);
  assert.equal(Object.keys(looks).length, used.size, "every derived look is worn by a scene");
});

test("the grade is the film's OWN theme, not one theme's numbers copied everywhere", () => {
  // composeStoryboard hardcoded white_weddings' four values for every composed film. A
  // warm_film job rendered 1000K too cool with none of its grain, and the two LUT themes
  // lost the LUT that is the whole of what they are.
  const warm = composedGrade(library.designTokens.themes.warm_film, "x");
  const white = composedGrade(library.designTokens.themes.white_weddings, "x");
  assert.notEqual(warm.temperature, white.temperature);
  assert.equal(warm.grain, 6, "the theme's grain must survive the nudge");
  assert.equal(warm.vignette, true);
  assert.equal(composedGrade(library.designTokens.themes.super8_nostalgia, "x").lut,
    "assets/luts/super8_kodak_01.cube", "a LUT theme without its LUT is a different theme");
});

test("the nudge is bounded, deterministic, and different per job", () => {
  const base = { temperature: 5600, saturation: 1.05, contrast: 1.03, glow: 0.12 };
  assert.deepEqual(nudgeGrade(base, "one"), nudgeGrade(base, "one"));
  const seeds = ["a", "b", "c", "d", "e", "f"].map((s) => nudgeGrade(base, s));
  assert.ok(new Set(seeds.map((g) => JSON.stringify(g))).size > 1, "every job got the same numbers");
  for (const grade of seeds) {
    assert.ok(Math.abs(grade.temperature - base.temperature) <= 200);
    assert.ok(Math.abs(grade.saturation - base.saturation) <= 0.041);
    assert.ok(grade.glow >= 0 && grade.glow <= 0.3);
  }
});

test("the frame preset is per job and never large enough to fail the radius rule", () => {
  const frames = ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) =>
    composedFrame(library.designTokens.themes.white_weddings, s));
  assert.ok(new Set(frames.map((f) => JSON.stringify(f))).size > 1);
  // frameRadiusErrors refuses a radius larger than half the slot; the library's smallest
  // photo slot is far wider than twice the largest radius offered here.
  for (const frame of frames) assert.ok(frame.radius <= 36);
});

test("a variant that cannot fit is refused rather than clamped", () => {
  // `cascade` needs a band deep enough for the step to read as one; on a shallow band it
  // returns nothing and the search moves on, instead of emitting a 2px stagger nobody sees.
  const slots = [
    { id: "a", x: 100, y: 500, width: 400, height: 80 },
    { id: "b", x: 520, y: 500, width: 400, height: 80 },
  ];
  const band = { x: 100, y: 500, right: 920, bottom: 580 };
  assert.equal(ARRANGEMENT_VARIANTS.cascade(slots, band, [0.06]), null);
  assert.equal(ARRANGEMENT_VARIANTS.feature([slots[0]], band, [1.08, 0.9]), null, "one photograph cannot feature itself");
});
