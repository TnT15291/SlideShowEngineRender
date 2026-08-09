// WHAT A FILM IS MADE OF, AS NUMBERS — so "premium looks cheaper than the template tier"
// stops being a feeling somebody has after watching one.
//
// The composed-film gate (lib/rules/composedFilm.mjs) answers a different question: is this
// film BROKEN. A film can clear every floor there and still be the thin one: eight scenes
// on the same three compositions, one transition, a single grade. That is what this
// measures, and it measures the SAME things on an authored recipe, so the answer has
// something to be measured against — the 25 recipes a person art-directed.
//
// WHY RATIOS AND PALETTE SIZES, NEVER RAW TOTALS. An authored recipe is a PALETTE the
// solver expands to fit the job — 18 authored scenes become 40 rendered ones on a long
// song — while a composed storyboard is already the finished shot list. Comparing
// "distinct looks" raw would flatter the composed film for being longer and punish the
// recipe for being a palette. So:
//   • vocabulary sizes (effects, transitions, typefaces) compare RAW — a palette is a
//     palette at either length, and this is exactly where the old composer scored 1;
//   • repetition compares as a RATIO per scene, plus the share of the film sitting on the
//     single most-used composition, which is what "it loops" actually means.
//
// Nothing here renders, and nothing here reads a photograph. Both halves are computable
// from the recipe and the library alone, which is what lets it run inside every build and
// inside the regression fixtures.
import { visualSignature, resolveTemplate } from "./lookResolver.mjs";
import { photoArrangementKey } from "./geometrySignature.mjs";
import { MONTAGE_EFFECTS } from "./engineCapabilities.mjs";
import { countTypefaces } from "./rules/composedFilm.mjs";

const share = (n, total) => (total ? +(n / total).toFixed(3) : 0);

/** The shape a viewer registers, before any styling: one photograph held, a designed card,
 *  a montage of many, or a beat with no photograph in it at all. */
export function shapeOf(scene) {
  if (scene.effect === "video_background") return "photoless";
  if (scene.effect === "layer_scene") return "card";
  if (MONTAGE_EFFECTS.has(scene.effect)) return "montage";
  return "single";
}

/** Every transition type the film can actually play. Composed storyboards state a
 *  `transitionGrammar.vocabulary`; authored recipes may only carry the strategy table, and
 *  createTransitionGrammar refuses anything outside the vocabulary it is given — so the
 *  union of the two is the real answer for both shapes of recipe. */
function transitionVocabulary(template) {
  const vocabulary = new Set(template.transitionGrammar?.vocabulary ?? []);
  for (const entry of Object.values(template.timelineRules?.transitionStrategy ?? {})) {
    if (typeof entry === "string") vocabulary.add(entry);
    else if (entry?.type) vocabulary.add(entry.type);
  }
  for (const scene of template.scenes ?? []) if (scene.transition?.type) vocabulary.add(scene.transition.type);
  return vocabulary;
}

/**
 * @param {object} template an authored recipe or a composed storyboard
 * @param {{library: object}} options
 * @returns {object} the scorecard
 */
export function scoreFilm(template, { library }) {
  const canvas = library?.meta?.canvas ?? { width: 1920, height: 1080 };
  // RESOLVED, like every other reader of a scene's geometry. An authored recipe names a
  // `look`, not a `layout`, so the unresolved signature of every one of its cards is
  // `layer:undefined` — measured on the corpus that scored a typical recipe as spending
  // half its scenes on ONE composition, and its distinct-layout count as zero.
  const scenes = resolveTemplate(template, { library }).scenes;

  const looks = new Map();
  const arrangements = new Set();
  const layouts = new Set();
  const effects = new Set();
  const shapes = { single: 0, card: 0, montage: 0, photoless: 0 };
  // Cards that HAVE an arrangement to vary. A closing card holds no photograph and a
  // full-bleed composition is one picture filling the canvas — photoArrangementKey returns
  // "[]" for both and says in as many words that a caller measuring sharing must skip them.
  // Counting them in the denominator only was the same mistake wearing a different hat: it
  // charged a film for compositions that cannot exist.
  let arrangeable = 0;

  for (const scene of scenes) {
    effects.add(scene.renderer && scene.template ? `${scene.renderer}/${scene.template}` : scene.effect);
    shapes[shapeOf(scene)]++;
    const look = visualSignature(scene);
    looks.set(look, (looks.get(look) ?? 0) + 1);
    if (scene.effect !== "layer_scene") continue;
    const layout = scene.resolvedLayout ?? null;
    if (scene.layout) layouts.add(scene.layout);
    // A scene the resolver refuses is the gate's business, not the scorecard's — measure
    // what resolves and let the film be judged for the rest where that is the job.
    if (!layout) continue;
    const key = photoArrangementKey(scene, library, canvas);
    if (key === "[]") continue;
    arrangements.add(key);
    arrangeable++;
  }

  const cards = arrangeable;
  const mostUsedLook = Math.max(0, ...looks.values());
  return {
    scenes: scenes.length,
    // Vocabulary — compared raw.
    distinctEffects: effects.size,
    distinctTransitions: transitionVocabulary(template).size,
    typefaces: countTypefaces(template, library),
    distinctLayouts: layouts.size,
    // Repetition — compared as ratios, because one side is a palette and one is a shot list.
    distinctLooks: looks.size,
    looksPerScene: share(looks.size, scenes.length),
    distinctArrangements: arrangements.size,
    arrangementsPerCard: share(arrangements.size, cards),
    // The share of the film sitting on its single most-repeated composition: "it loops",
    // stated as a number.
    topLookShare: share(mostUsedLook, scenes.length),
    shapeMix: {
      single: share(shapes.single, scenes.length),
      card: share(shapes.card, scenes.length),
      montage: share(shapes.montage, scenes.length),
      photoless: share(shapes.photoless, scenes.length),
    },
  };
}

const median = (values) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle] : +((sorted[middle - 1] + sorted[middle]) / 2).toFixed(3);
};

/** The band the art-directed corpus sits in: the median of each metric across every
 *  authored recipe. Not a floor to clear — a place to stand next to. */
export function corpusBaseline(recipes, { library }) {
  const cards = recipes.map((recipe) => scoreFilm(recipe, { library }));
  const at = (pick) => median(cards.map(pick));
  return {
    recipes: recipes.length,
    scenes: at((c) => c.scenes),
    distinctEffects: at((c) => c.distinctEffects),
    distinctTransitions: at((c) => c.distinctTransitions),
    typefaces: at((c) => c.typefaces),
    distinctLayouts: at((c) => c.distinctLayouts),
    distinctLooks: at((c) => c.distinctLooks),
    looksPerScene: at((c) => c.looksPerScene),
    distinctArrangements: at((c) => c.distinctArrangements),
    arrangementsPerCard: at((c) => c.arrangementsPerCard),
    topLookShare: at((c) => c.topLookShare),
    shapeMix: {
      single: at((c) => c.shapeMix.single),
      card: at((c) => c.shapeMix.card),
      montage: at((c) => c.shapeMix.montage),
      photoless: at((c) => c.shapeMix.photoless),
    },
  };
}

/**
 * Metrics a composed film can fairly be asked to match the corpus on: vocabulary sizes, and
 * the two ratios that are per-card or per-scene on BOTH sides.
 *
 * `looksPerScene` and `distinctLooks` are deliberately absent, and it is worth saying why
 * rather than leaving it to be rediscovered. An authored recipe is a PALETTE of around
 * twenty scenes that a person wrote to be twenty different pictures, and the corpus median
 * of looksPerScene is 1.000. A composed shot list of 38 scenes cannot reach 1.000 without 38
 * distinct compositions, and the library does not contain 38. A metric no composed film can
 * ever pass makes the "below the corpus" line permanently wrong, which is how a report stops
 * being read. Both are still measured and printed — they are the right numbers to watch a
 * tier against ITSELF over time, which is what the regression fixtures do.
 *
 * `topLookShare` is better LOWER, and the shape mix has no good direction at all — a film
 * that is 100% montage is as wrong as one that is 0%.
 */
export const HIGHER_IS_BETTER = Object.freeze([
  "distinctEffects", "distinctTransitions", "typefaces", "distinctLayouts",
  "distinctArrangements", "arrangementsPerCard",
]);
