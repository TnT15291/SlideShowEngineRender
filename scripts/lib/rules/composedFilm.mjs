// THE GATE A COMPOSED FILM PASSES INSTEAD OF A PERSON.
//
// Two of the three tiers do not use an authored recipe. Premium composes its own shot list
// (composeStoryboard.mjs, node 8) and lite runs through the same composer. What they emit is
// an ordinary recipe — same format, same renderer — so it is judged by the same rules the
// 24 authored recipes must pass, under `profile: "composed"` (lib/rules/templateRules.mjs).
//
// Measured before this existed: the composed premium storyboard failed 10 of those rules and
// the composed lite storyboard 11, while every authored recipe passed. Nobody was told,
// because the lint only ever read story-templates/*.json.
//
// On top of the shared rules this adds the floors a reviewer would have caught by eye, and
// which only exist for a GENERATED film:
//
//   variety      lib/storyboard.mjs already computes `fit.variety` — distinct effects,
//                distinct scene sizes, adjacent repeats — and composeStoryboard printed it
//                to the console and nothing else. A number nobody reads is not a standard.
//   typography   resolved through createTemplateTheme, the renderer's own precedence, because
//                `defaults.fonts` outranks the library theme: writing one pins every role and
//                throws away the theme's display face AND its script accent. That is how every
//                lite film shipped with one typeface against an authored recipe's three.
//   spend        `fit` already knows when photographs could not be placed or the film does not
//                fill the track. Both were behind an opt-in --strict inside the composer.
//
// Copy arrives LATER than the storyboard (writeRecipeCopy fills the empty slots the composer
// declared), so pass `copy` to judge the film the customer will actually see — without it
// every textRequired layout reads as wordless and the text rules fire on all of them.
import { evaluateStoryTemplate } from "./templateRules.mjs";
import { createTemplateTheme } from "../templateTheme.mjs";
import {
  COMPOSED_MIN_DISTINCT_EFFECTS, COMPOSED_MIN_SCENE_SIZES, COMPOSED_MIN_TYPEFACES,
} from "./thresholds.mjs";

const finding = (check, id, detail) => ({ check, id: id ?? "film", detail });

/** The scenes as they will RENDER: the composer's empty slots filled by writeRecipeCopy.
 *  Mirrors layerSceneBuilder's `copyMap[scene.id]?.[slot.id]` — a per-slot override, not a
 *  replacement — so this judges the same words the renderer will draw. */
export function mergeComposedCopy(recipe, copy) {
  const map = copy?.scenes ?? {};
  if (!Object.keys(map).length) return recipe;
  return {
    ...recipe,
    scenes: (recipe.scenes ?? []).map((scene) => {
      const written = map[scene.id];
      if (!written) return scene;
      const { captionPattern, ...slots } = written;
      return {
        ...scene,
        text: { ...(scene.text ?? {}), ...slots },
        ...(captionPattern ? { captionPattern } : {}),
      };
    }),
  };
}

/** Distinct typefaces the film will actually set, by the renderer's own precedence. */
export function countTypefaces(recipe, library) {
  // No `direction`: chooseTier1Direction is a template-tier node, and a composed film's
  // theme is already its own (composeStoryboard writes libraryTheme from --theme).
  const { resolveFont } = createTemplateTheme({ library, template: recipe, direction: null });
  return new Set(["heading", "script_accent", "body"].map((role) => resolveFont(role))).size;
}

/**
 * @param {object} recipe   a storyboard emitted by composeStoryboard.mjs
 * @param {{library: object, copy?: object|null}} options
 * @returns {{errors: object[], warnings: object[], verdict: "pass"|"warning"|"error", measured: object}}
 */
export function evaluateComposedFilm(recipe, { library, copy = null }) {
  const rendered = mergeComposedCopy(recipe, copy);
  const rules = evaluateStoryTemplate(rendered, { library, profile: "composed" });
  const errors = [...rules.errors];
  const warnings = [...rules.warnings];

  const fit = recipe.fit ?? {};
  const variety = fit.variety ?? {};
  const typefaces = countTypefaces(recipe, library);
  // A film cannot show more variety than it has room for. The composer solves its scene count
  // from the album and the track, so a photo-poor job legitimately runs short — and a floor
  // that asks a six-scene film for five distinct effects is asking it to change on every
  // second scene. No floor may demand more than one new thing every two scenes.
  const sceneCount = (recipe.scenes ?? []).length;
  const floor = (want) => Math.max(2, Math.min(want, Math.ceil(sceneCount / 2)));

  // SCENE SIZES ARE BOUGHT WITH SURPLUS PHOTOGRAPHS. A scene can only be bigger than one
  // photograph if there are photographs to spare, so a film with fewer than two per scene
  // has {1, 2} and nothing else available to it — measured on a real 11-photo, 12-scene job.
  // Asking it for a third size is asking the album for photographs it does not contain.
  const perScene = sceneCount ? (fit.photosUsed ?? fit.photoCount ?? 0) / sceneCount : 0;
  const sizeFloor = perScene < 2 ? Math.min(2, COMPOSED_MIN_SCENE_SIZES) : floor(COMPOSED_MIN_SCENE_SIZES);

  if ((variety.distinctEffects ?? 0) < floor(COMPOSED_MIN_DISTINCT_EFFECTS)) {
    errors.push(finding("composed_variety", null,
      `${variety.distinctEffects ?? 0} distinct effect(s) [${(variety.effects ?? []).join(", ")}]; minimum is ${floor(COMPOSED_MIN_DISTINCT_EFFECTS)}`));
  }
  if ((variety.distinctPhotoCounts ?? 0) < sizeFloor) {
    errors.push(finding("composed_variety", null,
      `${variety.distinctPhotoCounts ?? 0} distinct scene size(s); minimum is ${sizeFloor} — a film where every scene spends the same number of photographs has no rhythm`));
  }
  // The composer's layout rotor and single-effect rotor both avoid their own predecessor, so
  // an adjacent repeat means a rotor ran out of vocabulary rather than that one slipped past.
  if ((variety.adjacentRepeats ?? 0) > 0) {
    errors.push(finding("composed_variety", null,
      `${variety.adjacentRepeats} adjacent scene pair(s) share an effect and a layout — the palette is too thin to avoid itself`));
  }
  if (typefaces < COMPOSED_MIN_TYPEFACES) {
    errors.push(finding("composed_typography", null,
      `${typefaces} typeface(s) after resolution; minimum is ${COMPOSED_MIN_TYPEFACES}`
      + (recipe.defaults?.fonts ? ` — defaults.fonts is set and outranks the "${recipe.libraryTheme}" theme's own faces` : "")));
  }
  if (fit.unplacedPhotos) {
    errors.push(finding("composed_spend", null,
      `${fit.unplacedPhotos} selected photograph(s) were never placed in a scene`));
  }
  // A WARNING, not an error, and deliberately so: `too_few_photos` / `too_many_photos` judge
  // the ALBUM against the TRACK, which is a pairing the customer chose and which two gates
  // downstream already own — composeStoryboard's own --strict, and applyStoryTemplate's
  // misfit check, which refuses a film that drifts more than 10% from the track unless
  // --accept-misfit records a customer who was told the cost and chose it anyway. Failing the
  // build a third time on the same fact would take a film away from that customer.
  if (fit.verdict && fit.verdict !== "ok") {
    warnings.push(finding("composed_spend", null,
      `shot list fits the track poorly (${fit.verdict}): ${fit.message ?? ""}`.trim()));
  }

  return {
    errors,
    warnings,
    verdict: errors.length ? "error" : warnings.length ? "warning" : "pass",
    measured: {
      scenes: (recipe.scenes ?? []).length,
      typefaces,
      distinctEffects: variety.distinctEffects ?? 0,
      distinctLayouts: variety.distinctLayouts ?? 0,
      distinctPhotoCounts: variety.distinctPhotoCounts ?? 0,
      adjacentRepeats: variety.adjacentRepeats ?? 0,
      photosUsed: fit.photosUsed ?? null,
      photoCount: fit.photoCount ?? null,
    },
  };
}
