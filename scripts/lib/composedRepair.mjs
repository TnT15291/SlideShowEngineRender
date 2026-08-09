// THE ONE REPAIR A COMPOSED FILM CANNOT AUTHOR ITS WAY OUT OF.
//
// composeStoryboard picks each card's layout by PHOTO COUNT — that is the only thing it can
// know while it is still solving the shot list against the album and the track. Whether the
// scene will end up with WORDS is decided later and elsewhere: writeRecipeCopy for premium,
// the act loop in generateProjectTimeline for lite. So a `textRequired` layout can land on a
// scene that nobody ever writes for, and a textRequired layout with no copy renders its text
// region as bare background — half an empty frame. Measured on real films: 2 such scenes in a
// 41-scene lite job, 1 in a 38-scene premium one.
//
// A person fixes this by swapping the layout. So does this: the scene keeps its photographs,
// its duration and its place in the film, and only the composition changes — to one that
// costs exactly the same number of photographs and does not ask for words.
//
// EQUAL COST IS NOT NEGOTIABLE. The photo budget was solved before this runs (see
// applyStoryTemplate's `origin: "composed"` path, which does not re-solve), so a stand-in that
// spends a different number of photographs would leave the couple's pictures unplaced or ask
// for pictures that are not there. That is the same constraint the authored recipes' own
// `muteFallback` rule enforces, for the same reason.
import { photoDemand, layoutsByPhotoCount } from "./engineCapabilities.mjs";
import { visualSignature } from "./lookResolver.mjs";
import { mergeComposedCopy } from "./rules/composedFilm.mjs";
import { deriveComposedLooks } from "./composedLooks.mjs";

/** Does this scene put any words on screen? Mirrors templateRules' textOf, including the
 *  array-of-variants shape a slot may carry (see pickVariant in applyStoryTemplate). */
const first = (v) => (Array.isArray(v) ? v[0] : v);
const hasWords = (scene) => {
  if (typeof scene.captionPattern === "string" && scene.captionPattern.trim()) return true;
  return Object.values(scene.text ?? {}).some((v) => {
    const outer = first(v);
    const s = outer && typeof outer === "object" ? first(outer.value) : outer;
    return typeof s === "string" && s.trim() !== "";
  });
};

/**
 * The text slots a layout declares, empty and ready for the copywriter — except the FACT
 * slots, which no copywriter can know and which the brief fills through these tokens.
 *
 * Shared with composeStoryboard.mjs so the composer and the repair declare slots the same
 * way: a scene that came out of the repair must be indistinguishable from one the composer
 * emitted, or the difference shows up as a blank card months later.
 */
export function declareTextSlots(layout) {
  const out = {};
  for (const slot of layout?.textSlots ?? []) out[slot.id] = "";
  if ("names" in out) out.names = "{{groom}} & {{bride}}";
  if ("date" in out) out.date = "{{date}}";
  return out;
}

/**
 * @param {object} recipe   a composed storyboard
 * @param {{library: object, copy?: object|null}} options
 * @returns {{recipe: object, repairs: Array<{id: string, from: string, to: string}>, unrepaired: string[]}}
 */
export function repairComposedFilm(recipe, { library, copy = null }) {
  const layouts = new Map((library?.layouts ?? []).map((l) => [l.id, l]));
  const buckets = layoutsByPhotoCount(library);
  // Judged on the words the film will actually carry, which for premium arrive in a separate
  // file written after the storyboard. The merge is read-only; the repair rewrites the real
  // scenes, not the merged view.
  const withCopy = mergeComposedCopy(recipe, copy);
  const scenes = (recipe.scenes ?? []).map((s) => ({ ...s }));
  const repairs = [];
  const unrepaired = [];

  // How often each layout is already spent, so a repair reaches for the composition the film
  // has leaned on least rather than piling every swap onto the same alphabetically-first one.
  const usage = new Map();
  for (const scene of scenes) if (scene.layout) usage.set(scene.layout, (usage.get(scene.layout) ?? 0) + 1);

  const signatureOf = (scene) => (scene?.layout ? visualSignature({ ...scene, layout: scene.layout }) : null);

  for (const [index, scene] of scenes.entries()) {
    if (scene.effect !== "layer_scene") continue;
    const layout = layouts.get(scene.layout);
    if (!layout?.textRequired) continue;
    if (hasWords(withCopy.scenes[index])) continue;

    const demand = photoDemand(scene, library);
    const neighbours = new Set([signatureOf(scenes[index - 1]), signatureOf(scenes[index + 1])]);
    const candidates = (buckets.get(demand) ?? [])
      .map((id) => layouts.get(id))
      .filter((l) => l && !l.textRequired && l.id !== scene.layout)
      // A swap that lands the same picture next to itself trades one defect for another.
      .filter((l) => !neighbours.has(visualSignature({ ...scene, layout: l.id })))
      .sort((a, b) => (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0) || a.id.localeCompare(b.id));

    if (!candidates.length) {
      // Reported, not forced: a swap that changes the photo count is worse than the defect.
      unrepaired.push(scene.id);
      continue;
    }
    const pick = candidates[0];
    usage.set(scene.layout, Math.max(0, (usage.get(scene.layout) ?? 1) - 1));
    usage.set(pick.id, (usage.get(pick.id) ?? 0) + 1);
    repairs.push({ id: scene.id, from: scene.layout, to: pick.id });
    scene.layout = pick.id;
    scene.text = declareTextSlots(pick);
    delete scene.look; // dressed the OLD layout; the whole set is re-derived below
  }

  if (!repairs.length) return { recipe, repairs, unrepaired };

  // RE-DERIVE THE FILM'S FACE ON THE FINAL LAYOUTS.
  //
  // A swapped card was wearing a look built for the layout it no longer has, and the resolver
  // refuses a scene whose look and layout disagree. Dropping the look instead — the first
  // thing this did — quietly cost the film the arrangements it had just been given: measured
  // 11 arrangements down to 9 on the rich fixture, 6 to 5 on the ordinary one, which is most
  // of what the look layer had bought. Re-deriving from the same seed is deterministic, and
  // it is the only version where the repair and the look layer agree about what this film is.
  let looks = recipe.looks;
  let layoutPresets = recipe.layoutPresets;
  if (recipe.looks && recipe.libraryTheme) {
    const derived = deriveComposedLooks(scenes, {
      library, theme: recipe.libraryTheme, seed: recipe.id ?? "storyboard",
    });
    looks = derived.looks;
    layoutPresets = derived.layoutPresets;
  }

  // `fit.variety` was measured on the shot list as composed, and the gate reads it. Swapping a
  // layout can only move these two numbers — the effect stays layer_scene and the photo count
  // is equal by construction — so those two are what is restated.
  const distinctLayouts = new Set(scenes.filter((s) => s.layout).map((s) => s.layout)).size;
  let adjacentRepeats = 0;
  for (let i = 1; i < scenes.length; i++) {
    if (scenes[i].effect === scenes[i - 1].effect && scenes[i].layout === scenes[i - 1].layout) adjacentRepeats++;
  }

  return {
    recipe: {
      ...recipe,
      ...(looks ? { looks, layoutPresets } : {}),
      scenes,
      ...(recipe.fit ? { fit: { ...recipe.fit, variety: { ...recipe.fit.variety, distinctLayouts, adjacentRepeats } } } : {}),
    },
    repairs,
    unrepaired,
  };
}
