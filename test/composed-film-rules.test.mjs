// The gate a COMPOSED film passes instead of a person (scripts/lib/rules/composedFilm.mjs).
//
// Two things have to hold, and they pull against each other: the composed profile must skip
// exactly the rules a generator cannot satisfy, and it must skip nothing else — a profile
// that quietly waives a render rule is worse than no gate, because it reports "pass".
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { evaluateStoryTemplate } from "../scripts/lib/rules/templateRules.mjs";
import { evaluateComposedFilm, mergeComposedCopy, countTypefaces } from "../scripts/lib/rules/composedFilm.mjs";
import {
  COMPOSED_MIN_DISTINCT_EFFECTS, COMPOSED_MIN_SCENE_SIZES, COMPOSED_MIN_TYPEFACES,
} from "../scripts/lib/rules/thresholds.mjs";

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));

/** A composed storyboard that passes everything, shaped like composeStoryboard's output. */
const healthy = () => ({
  id: "fixture-composed",
  libraryTheme: "white_weddings",
  generatedBy: "code:composeStoryboard",
  source: { origin: "composed" },
  defaults: { project: { width: 1920, height: 1080, fps: 30 } },
  fit: {
    verdict: "ok",
    photosUsed: 40,
    photoCount: 40,
    variety: {
      distinctEffects: 8,
      distinctLayouts: 12,
      distinctPhotoCounts: 4,
      adjacentRepeats: 0,
      effects: ["layer_scene", "slow_zoom_in", "pan_left", "collage_grid", "photo_strip_up",
        "slow_zoom_out", "pan_right", "portrait_blur_background"],
    },
  },
  scenes: [
    { id: "s01", effect: "layer_scene", layout: "three_photo_row", durationSec: 5, text: {} },
    { id: "s02", effect: "slow_zoom_in", durationSec: 5, photoSlots: [{ slot: "hero", count: 1 }], text: {} },
    { id: "s03", effect: "layer_scene", layout: "photo_duo", durationSec: 5, text: {} },
    { id: "s04", effect: "pan_left", durationSec: 5, photoSlots: [{ slot: "hero", count: 1 }], text: {} },
    { id: "s05", effect: "layer_scene", layout: "full_bleed_quote", durationSec: 5, text: {} },
    { id: "s06", effect: "pan_right", durationSec: 5, photoSlots: [{ slot: "hero", count: 1 }], text: {} },
    { id: "s07", effect: "layer_scene", layout: "photo_duo", durationSec: 5, text: {} },
    { id: "s08", effect: "slow_zoom_out", durationSec: 5, photoSlots: [{ slot: "hero", count: 1 }], text: {} },
  ],
});

const checks = (report) => report.errors.map((e) => e.check);

// -- the profile skips the authoring-only rules, and only those --------------------------

test("a composed storyboard is not failed for the four rules a generator cannot satisfy", () => {
  const film = healthy();
  const authored = checks(evaluateStoryTemplate(film, { library }));
  const composed = checks(evaluateStoryTemplate(film, { library, profile: "composed" }));

  // Under the authoring profile this fixture owes repeat variants and signature hybrids.
  assert.ok(authored.includes("repeat_depth"), "fixture should trip repeat_depth as authored");
  assert.ok(authored.includes("signature_hybrid"), "fixture should trip signature_hybrid as authored");
  assert.equal(composed.includes("repeat_depth"), false);
  assert.equal(composed.includes("signature_hybrid"), false);
});

test("the composed profile still fails a black canvas, a montage that reads the wrong slot, and adjacent twins", () => {
  const film = healthy();
  film.scenes[1] = { id: "s02", effect: "memory_wall", durationSec: 5, photoSlots: [{ slot: "wrong", count: 6 }], text: {} };
  film.scenes[5] = { id: "s06", effect: "layer_scene", layout: "photo_duo", durationSec: 5, text: {} };
  const found = checks(evaluateStoryTemplate(film, { library, profile: "composed" }));
  assert.ok(found.includes("canvas_background"), "memory_wall with no params.background must still fail");
  assert.ok(found.includes("montage_slot"), "a montage reading the wrong slot must still fail");
  // s06 photo_duo, s07 photo_duo — the same picture twice in a row.
  assert.ok(found.includes("look_adjacency"), "two identical adjacent looks must still fail");
});

test("English copy is a defect in an authored recipe and the product in a composed one", () => {
  const film = healthy();
  film.scenes[0].text = { heading: "Our Story", body: "The day we said yes" };
  assert.ok(checks(evaluateStoryTemplate(film, { library })).includes("copy_language"));
  assert.equal(checks(evaluateStoryTemplate(film, { library, profile: "composed" })).includes("copy_language"), false);
});

test("an unknown profile is refused rather than silently treated as authored", () => {
  assert.throws(() => evaluateStoryTemplate(healthy(), { library, profile: "strict" }), /profile/);
});

// -- the floors a generated film is held to ----------------------------------------------

test("a healthy composed film passes the whole gate", () => {
  const report = evaluateComposedFilm(healthy(), { library });
  assert.equal(report.verdict, "pass", report.errors.map((e) => `${e.check}: ${e.detail}`).join("\n"));
  assert.equal(report.measured.typefaces, 3);
});

test("a collapsed palette fails on effects, scene sizes and adjacency", () => {
  const film = healthy();
  // Below any floor, scaled or not — this is the film the old composer actually shipped:
  // one effect and three layouts, repeated for three minutes.
  film.fit.variety = {
    distinctEffects: 1,
    distinctLayouts: 3,
    distinctPhotoCounts: 1,
    adjacentRepeats: 2,
    effects: ["layer_scene"],
  };
  assert.ok(COMPOSED_MIN_DISTINCT_EFFECTS > 1 && COMPOSED_MIN_SCENE_SIZES > 1);
  const found = evaluateComposedFilm(film, { library }).errors.filter((e) => e.check === "composed_variety");
  assert.equal(found.length, 3, found.map((e) => e.detail).join("\n"));
});

test("defaults.fonts is caught pinning the film to one typeface", () => {
  // The trap this floor exists for: resolveFont() reads defaults.fonts BEFORE the library
  // theme, so pinning every role throws away the theme's display face and script accent.
  const film = healthy();
  film.defaults.fonts = {
    heading: "fonts/BeVietnamPro-Regular.ttf",
    body: "fonts/BeVietnamPro-Regular.ttf",
    title: "fonts/BeVietnamPro-Regular.ttf",
  };
  assert.equal(countTypefaces(film, library), 1);
  const found = evaluateComposedFilm(film, { library }).errors.filter((e) => e.check === "composed_typography");
  assert.equal(found.length, 1);
  assert.match(found[0].detail, /defaults\.fonts/);
  assert.ok(COMPOSED_MIN_TYPEFACES > 1);
});

test("photographs left on the floor fail; an album/track mismatch only warns", () => {
  const film = healthy();
  film.fit.unplacedPhotos = 7;
  film.fit.verdict = "too_few_photos";
  const report = evaluateComposedFilm(film, { library });
  assert.deepEqual(report.errors.filter((e) => e.check === "composed_spend").map((e) => e.detail),
    ["7 selected photograph(s) were never placed in a scene"]);
  // The pairing the customer chose is owned by applyStoryTemplate's misfit gate and its
  // --accept-misfit escape; a second, stricter gate here would overrule that decision.
  assert.equal(report.warnings.filter((e) => e.check === "composed_spend").length, 1);
});

test("a floor never asks a short film for more variety than it has scenes to spend", () => {
  // Six photographs make a six-scene film. Demanding five distinct effects of it is
  // demanding something the album cannot supply — and would fail the build for it.
  const film = healthy();
  film.scenes = film.scenes.slice(0, 6);
  film.fit.variety = {
    distinctEffects: 3, distinctLayouts: 3, distinctPhotoCounts: 3, adjacentRepeats: 0,
    effects: ["layer_scene", "slow_zoom_in", "pan_left"],
  };
  assert.equal(evaluateComposedFilm(film, { library }).verdict, "pass");
  // The same numbers in a full-length film are a collapsed palette.
  const long = healthy();
  long.fit.variety = { ...film.fit.variety };
  assert.ok(evaluateComposedFilm(long, { library }).errors.some((e) => e.check === "composed_variety"));
});

test("a photo-poor film is not asked for a scene size its album cannot pay for", () => {
  // Real job, caught by test/lite-tier.test.mjs: 11 photographs across 12 scenes. With
  // barely one photograph per scene there is no surplus to build a three-photo card from,
  // so the film has {1, 2} and no third size exists to find.
  const film = healthy();
  film.fit.photosUsed = 11;
  film.fit.photoCount = 11;
  film.fit.variety = {
    distinctEffects: 6, distinctLayouts: 5, distinctPhotoCounts: 2, adjacentRepeats: 0,
    effects: ["layer_scene", "slow_zoom_in", "pan_left", "pan_right", "slow_zoom_out", "collage_grid"],
  };
  assert.equal(evaluateComposedFilm(film, { library }).verdict, "pass");

  // A photo-RICH film with the same two sizes had the surplus and did not spend it.
  const rich = { ...film, fit: { ...film.fit, photosUsed: 40, photoCount: 40 } };
  assert.ok(evaluateComposedFilm(rich, { library }).errors.some((e) => /scene size/.test(e.detail)));
});

test("scene count is solved for a composed film, so only an author is held to the minimum", () => {
  const film = healthy();
  film.scenes = film.scenes.slice(0, 5);
  const authored = evaluateStoryTemplate(film, { library }).errors.filter((e) => e.check === "scene_variety");
  const composed = evaluateStoryTemplate(film, { library, profile: "composed" }).errors.filter((e) => e.check === "scene_variety");
  assert.ok(authored.some((e) => /scenes; a palette under/.test(e.detail)));
  assert.equal(composed.length, 0, composed.map((e) => e.detail).join("\n"));
});

// -- copy arrives after the storyboard ----------------------------------------------------

test("copy written by node 8b is merged the way the renderer merges it", () => {
  const film = healthy();
  film.scenes[0].text = { heading: "", body: "" };
  const merged = mergeComposedCopy(film, {
    scenes: { s01: { heading: "Ngày đầu tiên", captionPattern: "Một buổi sáng" } },
  });
  // Per-slot override, not replacement: `body` survives as the empty string the composer
  // declared, exactly as layerSceneBuilder's copyMap[scene.id]?.[slot.id] would leave it.
  assert.deepEqual(merged.scenes[0].text, { heading: "Ngày đầu tiên", body: "" });
  assert.equal(merged.scenes[0].captionPattern, "Một buổi sáng");
  // And the original is untouched — the gate must not mutate the storyboard it judges.
  assert.equal(film.scenes[0].text.heading, "");
});

test("a textRequired layout is judged on the copy, so the same film fails without it and passes with it", () => {
  const film = healthy();
  film.scenes[0] = { id: "s01", effect: "layer_scene", layout: "text_left_photo_right", durationSec: 5, text: { heading: "", body: "" } };
  const wordless = evaluateComposedFilm(film, { library }).errors.filter((e) => e.check === "balanced_text");
  assert.equal(wordless.length, 1);
  const written = evaluateComposedFilm(film, {
    library,
    copy: { scenes: { s01: { heading: "Buổi sáng ấy", body: "Nắng qua rèm, và một lời hứa." } } },
  }).errors.filter((e) => e.check === "balanced_text");
  assert.equal(written.length, 0);
});
