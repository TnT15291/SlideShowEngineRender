// The scorecard (scripts/lib/filmScorecard.mjs) measures an authored recipe and a composed
// storyboard with the same ruler. The traps are all in "the same ruler" — an authored recipe
// names a `look` where a composed one names a `layout`, and a palette is not a shot list.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { scoreFilm, corpusBaseline, shapeOf, HIGHER_IS_BETTER } from "../scripts/lib/filmScorecard.mjs";

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
const recipes = fs.readdirSync("story-templates").filter((f) => f.endsWith(".json"))
  .map((f) => JSON.parse(fs.readFileSync(path.join("story-templates", f), "utf8")));

test("an authored recipe is measured on its RESOLVED geometry, not on a layout id it never names", () => {
  // Every card in a migrated recipe names a look. Read unresolved, all of them sign as
  // `layer:undefined` — which scored a typical recipe as spending half its scenes on one
  // composition and using zero layouts. Both numbers were the ruler's fault, not the film's.
  const looksRecipe = recipes.find((r) => Object.keys(r.looks ?? {}).length > 0);
  assert.ok(looksRecipe, "the corpus should contain at least one recipe using looks");
  const card = scoreFilm(looksRecipe, { library });
  assert.ok(card.distinctLayouts > 0, "a recipe built entirely from looks still spends layouts");
  assert.ok(card.topLookShare < 0.5, `one composition holds ${card.topLookShare} of the film`);
});

test("every authored recipe scores as the palette a person wrote it to be", () => {
  // `look_adjacency` only forbids a repeat NEXT to itself, so a recipe may reuse a look
  // further along — classic-luxury-01 does, at 16 looks over 17 scenes. The corpus still
  // sits at or beside 1.000, which is the reason a 38-scene shot list is not asked to match
  // it. If this floor ever breaks, the corpus changed, not the scorecard.
  for (const recipe of recipes) {
    const card = scoreFilm(recipe, { library });
    assert.ok(card.looksPerScene >= 0.9,
      `${recipe.id} repeats compositions: ${card.distinctLooks} looks over ${card.scenes} scenes`);
    assert.ok(card.typefaces >= 1);
  }
  const medianLooks = corpusBaseline(recipes, { library }).looksPerScene;
  assert.equal(medianLooks, 1, "the corpus median is what a composed film would have to beat");
});

test("the comparison set excludes the metrics a shot list can never win", () => {
  assert.equal(HIGHER_IS_BETTER.includes("looksPerScene"), false);
  assert.equal(HIGHER_IS_BETTER.includes("distinctLooks"), false);
  assert.ok(HIGHER_IS_BETTER.includes("distinctEffects"));
  assert.ok(HIGHER_IS_BETTER.includes("distinctTransitions"));
});

test("shape is read from the effect, hybrids included", () => {
  assert.equal(shapeOf({ effect: "layer_scene", layout: "photo_duo" }), "card");
  assert.equal(shapeOf({ effect: "collage_grid" }), "montage");
  assert.equal(shapeOf({ effect: "slow_zoom_in" }), "single");
  assert.equal(shapeOf({ effect: "video_background" }), "photoless");
  // A hybrid renders one photograph full-frame; the composer swaps it in for a single.
  assert.equal(shapeOf({ effect: "still", renderer: "remotion", template: "kinetic_typography" }), "single");
});

test("transitions are counted from the vocabulary AND the strategy table", () => {
  // A composed storyboard states both; a hand-written recipe may state only the strategy,
  // and createTransitionGrammar refuses any type outside the vocabulary it is handed.
  const strategyOnly = {
    id: "x", libraryTheme: "white_weddings", scenes: [],
    timelineRules: { transitionStrategy: { default: { type: "crossfade" }, final: { type: "fade_slow" } } },
  };
  assert.equal(scoreFilm(strategyOnly, { library }).distinctTransitions, 2);
  const both = { ...strategyOnly, transitionGrammar: { vocabulary: ["crossfade", "dissolve", "wipe_left"] } };
  assert.equal(scoreFilm(both, { library }).distinctTransitions, 4);
});

test("the corpus baseline is a median over the whole corpus, not one recipe", () => {
  const baseline = corpusBaseline(recipes, { library });
  assert.equal(baseline.recipes, recipes.length);
  assert.ok(baseline.distinctEffects >= 1);
  assert.ok(baseline.scenes >= 8, "TEMPLATE_MIN_SCENES is 8 and every recipe passes the lint");
  // Median, so it must sit inside the corpus's own range.
  const effects = recipes.map((r) => scoreFilm(r, { library }).distinctEffects);
  assert.ok(baseline.distinctEffects >= Math.min(...effects) && baseline.distinctEffects <= Math.max(...effects));
});
