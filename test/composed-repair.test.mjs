// The one repair a composed film gets (scripts/lib/composedRepair.mjs).
//
// The rule it answers to is `balanced_text`: a textRequired layout with no copy renders its
// text region as bare background. The composer cannot avoid it — it picks a layout by photo
// count, before anyone knows whether the scene will be written for — so the fix is a swap,
// and the swap has exactly one hard constraint: the same number of photographs.
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { repairComposedFilm, declareTextSlots } from "../scripts/lib/composedRepair.mjs";
import { evaluateComposedFilm } from "../scripts/lib/rules/composedFilm.mjs";
import { photoDemand } from "../scripts/lib/engineCapabilities.mjs";

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
const layoutOf = (id) => library.layouts.find((l) => l.id === id);

const film = (scenes) => ({
  id: "fixture-repair",
  libraryTheme: "white_weddings",
  source: { origin: "composed" },
  defaults: {},
  fit: { verdict: "ok", variety: { distinctEffects: 6, distinctLayouts: 4, distinctPhotoCounts: 3, adjacentRepeats: 0, effects: [] } },
  scenes,
});

test("a wordless textRequired card is swapped for one that costs the same photographs", () => {
  const before = film([
    { id: "s01", effect: "slow_zoom_in", photoSlots: [{ slot: "hero", count: 1 }], text: {} },
    { id: "s02", effect: "layer_scene", layout: "collage_cluster_text", text: { heading: "", body: "" } },
    { id: "s03", effect: "pan_left", photoSlots: [{ slot: "hero", count: 1 }], text: {} },
  ]);
  const { recipe, repairs, unrepaired } = repairComposedFilm(before, { library });

  assert.equal(repairs.length, 1);
  assert.equal(unrepaired.length, 0);
  const swapped = recipe.scenes[1];
  assert.notEqual(swapped.layout, "collage_cluster_text");
  assert.equal(layoutOf(swapped.layout).textRequired, undefined);
  // The constraint that matters: the photo budget was solved before this ran.
  assert.equal(
    photoDemand(swapped, library),
    photoDemand(before.scenes[1], library),
    "a stand-in that spends a different number of photographs unplaces the couple's pictures"
  );
  // And the storyboard it was handed is untouched.
  assert.equal(before.scenes[1].layout, "collage_cluster_text");
});

test("a card that HAS words is left exactly as it is", () => {
  const before = film([
    { id: "s01", effect: "layer_scene", layout: "collage_cluster_text", text: { heading: "Ngày ấy", body: "Nắng qua rèm." } },
  ]);
  assert.deepEqual(repairComposedFilm(before, { library }).repairs, []);
});

test("copy that arrives in a separate file counts as words", () => {
  const before = film([
    { id: "s01", effect: "layer_scene", layout: "text_left_photo_right", text: { heading: "", body: "" } },
  ]);
  assert.equal(repairComposedFilm(before, { library }).repairs.length, 1, "wordless without the copy file");
  const withCopy = repairComposedFilm(before, {
    library,
    copy: { scenes: { s01: { heading: "Buổi sáng ấy" } } },
  });
  assert.deepEqual(withCopy.repairs, [], "writeRecipeCopy wrote for this scene — nothing to repair");
});

test("a caption is words too, even with every text slot empty", () => {
  const before = film([
    { id: "s01", effect: "layer_scene", layout: "polaroid_feature", text: { heading: "" }, captionPattern: "Một buổi sáng" },
  ]);
  assert.deepEqual(repairComposedFilm(before, { library }).repairs, []);
});

test("the swap does not put the same picture next to itself", () => {
  // s01 and s03 already spend the two obvious one-photo stand-ins, so a naive pick would
  // land the repaired s02 beside one of them.
  const before = film([
    { id: "s01", effect: "layer_scene", layout: "full_bleed_quote", text: {} },
    { id: "s02", effect: "layer_scene", layout: "welcome_title_page", text: { names: "", date: "" } },
    { id: "s03", effect: "layer_scene", layout: "gallery_matte_hero", text: {} },
  ]);
  const { recipe } = repairComposedFilm(before, { library });
  assert.notEqual(recipe.scenes[1].layout, "full_bleed_quote");
  assert.notEqual(recipe.scenes[1].layout, "gallery_matte_hero");
  assert.equal(recipe.fit.variety.adjacentRepeats, 0);
});

test("the repaired scene declares the NEW layout's slots, fact tokens included", () => {
  const before = film([
    { id: "s01", effect: "layer_scene", layout: "collage_cluster_text", text: { heading: "", body: "" } },
  ]);
  const swapped = repairComposedFilm(before, { library }).recipe.scenes[0];
  assert.deepEqual(swapped.text, declareTextSlots(layoutOf(swapped.layout)));
  const withNames = declareTextSlots(layoutOf("welcome_title_page"));
  assert.equal(withNames.names, "{{groom}} & {{bride}}");
  assert.equal(withNames.date, "{{date}}");
});

test("repair then gate: the film that failed balanced_text passes", () => {
  const before = film([
    { id: "s01", effect: "slow_zoom_in", photoSlots: [{ slot: "hero", count: 1 }], text: {} },
    { id: "s02", effect: "layer_scene", layout: "collage_cluster_text", text: { heading: "", body: "" } },
    { id: "s03", effect: "pan_left", photoSlots: [{ slot: "hero", count: 1 }], text: {} },
    { id: "s04", effect: "layer_scene", layout: "photo_left_text_right", text: { heading: "", body: "" } },
  ]);
  assert.ok(evaluateComposedFilm(before, { library }).errors.some((e) => e.check === "balanced_text"));
  const { recipe } = repairComposedFilm(before, { library });
  assert.equal(evaluateComposedFilm(recipe, { library }).errors.filter((e) => e.check === "balanced_text").length, 0);
});

test("the recorded variety is restated, not left describing the shot list as composed", () => {
  const before = film([
    { id: "s01", effect: "layer_scene", layout: "collage_cluster_text", text: { heading: "" } },
    { id: "s02", effect: "slow_zoom_in", photoSlots: [{ slot: "hero", count: 1 }], text: {} },
  ]);
  before.fit.variety.distinctLayouts = 99;
  const { recipe } = repairComposedFilm(before, { library });
  assert.equal(recipe.fit.variety.distinctLayouts, 1);
  // Everything the swap cannot move is carried through untouched.
  assert.equal(recipe.fit.variety.distinctPhotoCounts, 3);
});
