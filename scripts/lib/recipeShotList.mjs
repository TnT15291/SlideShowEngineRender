// Solve a RECIPE's shot list against the photo budget, instead of counting its scenes
// by hand.
//
// THE BUG THIS EXISTS TO KILL. A recipe used to declare a fixed list of scenes — nine
// of them — and `expandScenes()` repeated the ones an author had explicitly marked
// `repeatable`, until either the photos ran out or a repeat cap was hit. Neither loop
// had ever been told how long the song was. Measured across all four recipes and two
// real job shapes, EVERY combination came up short:
//
//     warm-film-01     23 photos / 203s track  ->  72s of film   (36% of the song)
//     warm-film-01     60 photos / 150s track  -> 123s of film   (82%)
//     cinematic-film   60 photos / 150s track  ->  65s of film   (43%) — 0 repeatable scenes
//     modern-teal      60 photos / 150s track  ->  41s of film   (27%) — 0 repeatable scenes
//     editorial-bold   23 photos / 203s track  ->  could not build at all
//
// Three of the four recipes had no repeatable scene at all, so they emitted a film of
// a FIXED length — 41 to 65 seconds — no matter which song the customer chose or how
// many photos they sent. The customer's song was simply cut off.
//
// THE IDEA THAT WAS MISSING is the same one composeStoryboard already runs for premium:
//
//     budget = musicDuration / photoCount     seconds of film each photo must carry
//     spend  = sceneDuration / photosInScene  what a scene costs per photo
//
// A montage showing 8 photos in 12s spends them at 1.5s each. On a 23-photo/203s job the
// budget is 8.8s each — so that montage burns the customer's whole set six times faster
// than the song can pay for it, and the film ends with two thirds of the song left. The
// montage is not ugly. It is UNAFFORDABLE, and only the budget can say so.
//
// WHAT THE RECIPE STILL OWNS. This does not turn Tier 1 into premium. The recipe keeps
// everything that makes it art-directed — the theme, the layouts, the copy, the story
// arc, the transition grammar, the colour defaults. What it no longer owns is HOW MANY
// scenes there are, because that was never a matter of taste: it is arithmetic, and the
// arithmetic has a right answer that depends on the job.
//
// So the recipe's scenes become a PALETTE, drawn from in the order their author wrote
// them, as many times as the budget will pay for — and no more.
import { fitScale, describeFit, photoSeconds, MIN_SCENE, MAX_SCENE } from "./pacing.mjs";
import { planSceneCount, CLOSING_SEC, DEFAULT_MAX_REUSE } from "./storyboard.mjs";
import { MONTAGE_EFFECTS, MONTAGE_MAX, MONTAGE_SLOT } from "./engineCapabilities.mjs";

/** Effects whose photo count we CHOOSE rather than read off a layout. These are the
 *  budget's shock absorbers: on a photo-rich job they soak up the surplus, and on a
 *  photo-poor one they shrink out of the way.
 *
 *  The tables live in lib/engineCapabilities.mjs now. They used to live here AND in
 *  applyStoryTemplate, and the two disagreed about how many photos a film_roll holds —
 *  8 here, 12 there — so the number you got depended on which file reached the scene. */
const VARIABLE_SLOT = MONTAGE_SLOT;
const VARIABLE_MAX = MONTAGE_MAX;
const isVariable = (scene) => MONTAGE_EFFECTS.has(scene.effect);

/** Strip a scene's authored words. Used when a scene recurs past the variants its author
 *  supplied: a wordless repeat is honest, and the same heading three times is not. */
function mute(scene) {
  const next = { ...scene };
  delete next.captionPattern;
  if (next.text) next.text = Object.fromEntries(Object.keys(next.text).map((k) => [k, ""]));
  return next;
}

/**
 * @param {object}   recipe          the art direction (scenes, timelineRules, defaults)
 * @param {number}   photoCount      how many photos this couple actually sent
 * @param {number}   musicDuration   how long their song actually is
 * @param {function} durationOf      (scene, tSeconds) => natural seconds. Injected: the
 *                                   caller owns the pacing multiplier and the energy curve.
 * @param {function} photoDemandOf   (scene) => photos consumed. Injected: the caller owns
 *                                   the layout library, which is the only thing that knows
 *                                   what a layer_scene costs.
 * @returns {{scenes: object[], fit: object}}
 */
export function solveRecipeShotList({
  recipe,
  photoCount,
  musicDuration,
  durationOf,
  photoDemandOf,
  maxReuse = DEFAULT_MAX_REUSE,
  bodyPhotoBudget,
}) {
  const all = (recipe.scenes || []).map((s) => ({ ...s }));
  if (!all.length) throw new Error(`${recipe.id}: the recipe has no scenes`);

  // The bookends are authored, not solved. The opening card introduces the couple and the
  // closing card carries their names and their date; neither is a beat you can have more
  // or fewer of because the song is long.
  const closingIndex = all.findIndex((s) => s.durationRole === "closing");
  const closing = closingIndex >= 0 ? all[closingIndex] : null;
  const opening = all[0] === closing ? null : all[0];
  const body = all.filter((s) => s !== opening && s !== closing);
  if (!body.length) throw new Error(`${recipe.id}: the recipe has only bookends — there is no film to solve`);

  const openingDur = opening ? durationOf(opening, 0) : 0;
  const closingDur = closing ? durationOf(closing, Math.max(0, musicDuration - 10)) : 0;
  // HOW MANY PHOTOS THE BODY MAY SPEND — and why the caller has to say.
  //
  // Not every photo a bookend shows comes out of the pool, and not every photo it takes is
  // counted by photoDemandOf(). The opening's principal frame is the RESERVED hero, held
  // out of the pool on purpose. The closing shows that same hero again as a full-bleed
  // background that its layout does not declare at all, so its demand reads as 0 while it
  // is really 1. Guessing at either from here produced a budget that was over by one, and
  // the shortfall never surfaced on the bookend — it surfaced on a montage twenty scenes
  // later. Only applyStoryTemplate knows which photos it reserved and which slots it will
  // actually ask the pool for, so it tells us, and we do not guess.
  const storySeconds = Math.max(1, musicDuration - openingDur - closingDur);
  const storyPhotos = Math.max(1, bodyPhotoBudget ?? (
    photoCount - (opening ? photoDemandOf(opening) : 0) - (closing ? photoDemandOf(closing) : 0)
  ));

  // The natural length of a scene from THIS recipe — not premium's energy curve. A recipe
  // that says its scenes breathe for 7 seconds is making an artistic claim, and the
  // solver's job is to decide how many of them there are, not to overrule how long they
  // feel.
  const naturalOf = new Map(body.map((s) => [s, Math.max(MIN_SCENE, durationOf(s, 0))]));
  const avgBase = [...naturalOf.values()].reduce((a, b) => a + b, 0) / body.length;

  // One implementation of the count, shared with premium. planSceneCount subtracts a
  // closing card of its own, and this function has already subtracted the recipe's real
  // one — so it is added back rather than the formula being copied and left to drift.
  const shape = planSceneCount({
    photoCount: storyPhotos,
    musicDuration: storySeconds + CLOSING_SEC,
    avgBase,
    maxReuse,
  });

  // The palette, in the order its author wrote it. Cycling preserves the authored
  // sequence for as long as the budget can pay for it; only the repeats are ours.
  const demandOf = (scene) => photoDemandOf(scene);
  const cheapest = Math.min(...body.map((s) => (isVariable(s) ? 1 : demandOf(s))));

  const wanted = Array.from({ length: shape.scenes }, (_, i) =>
    shape.photosPerScene + (i < shape.remainder ? 1 : 0)
  );

  // A scene id is a KEY, not a label: the photo assignment is stored under `sceneId:slot`,
  // so two scenes sharing an id would be handed the same photograph and one of them would
  // silently show the other's frame. Two substitutions in the same round can land on the
  // same source scene, which is exactly how that collision happened.
  const takenIds = new Set([opening?.id, closing?.id].filter(Boolean));
  const uniqueId = (id) => {
    let out = id;
    for (let n = 2; takenIds.has(out); n++) out = `${id}_${n}`;
    takenIds.add(out);
    return out;
  };

  // WHAT MAY STAND IN FOR A SCENE THE BUDGET CANNOT AFFORD.
  //
  // Not a scene that shows no photograph. The first version of this let any cheap scene
  // substitute, and the cheapest scene in warm-film-01 is a stock flower VIDEO costing
  // zero photos — so on a photo-poor job it was chosen again and again, and the finished
  // film played the same clip of flowers SIX times. A scene that carries no photo cannot
  // pay a photo debt; all it can do is repeat itself.
  //
  // And substitutes rotate by least-used rather than by modulo, so a 20-scene film is not
  // the same two layouts alternating for three minutes.
  const substitutes = body.filter((s) => !isVariable(s) && photoDemandOf(s) >= 1);
  // Counted against the SOURCE scene, not the emitted one: `s05_breath` and `s05_breath_r2`
  // are the same layout on screen, and it is the layout the viewer gets tired of.
  const timesUsed = new Map();
  const bump = (sourceId) => timesUsed.set(sourceId, (timesUsed.get(sourceId) ?? 0) + 1);
  const leastUsed = (pool) =>
    pool.reduce((a, b) => ((timesUsed.get(b.id) ?? 0) < (timesUsed.get(a.id) ?? 0) ? b : a));

  const scenes = [];
  let spent = 0;
  for (let i = 0; i < wanted.length; i++) {
    const round = Math.floor(i / body.length);
    const source = body[i % body.length];
    const want = wanted[i];
    let paletteSource = source;

    let scene = round === 0 ? { ...source } : variantOf(source, round);
    if (round > 0) scene.id = `${source.id}_r${round}`;

    // A photoless scene is authored punctuation — a title card, a video interlude. It
    // earns its place ONCE, where its author put it. Every recurrence after that is the
    // same clip again, so later rounds hand its slot to a scene that shows a photograph.
    if (round > 0 && !isVariable(scene) && photoDemandOf(scene) === 0 && substitutes.length) {
      const pick = leastUsed(substitutes);
      paletteSource = pick;
      scene = variantOf(pick, round);
      scene.id = `${pick.id}_r${round}`;
    }

    if (isVariable(scene)) {
      // A montage is sized by the budget: as many photos as this beat can afford, never
      // the 8 its author happened to type.
      const count = Math.max(2, Math.min(VARIABLE_MAX[scene.effect], want));
      if (spent + count > storyPhotos) break;
      scene.photoSlots = [{ slot: VARIABLE_SLOT[scene.effect], count }];
      spent += count;
    } else {
      const need = demandOf(scene);
      // A scene that costs more photos than this beat can afford is SUBSTITUTED, not
      // crammed in. Over-drawing the pool is what made editorial-bold-01 fail to build.
      if (need > want || spent + need > storyPhotos) {
        const affordable = substitutes.filter((s) => demandOf(s) <= Math.min(want, storyPhotos - spent));
        if (!affordable.length) break;
        const pick = leastUsed(affordable);
        paletteSource = pick;
        scene = round === 0 ? { ...pick } : variantOf(pick, round);
        scene.id = round === 0 ? pick.id : `${pick.id}_r${round}`;
      }
      spent += demandOf(scene);
    }
    // Copy variants follow how often the SOURCE has appeared, not the global round.
    // Substitution can choose the same source more than once inside one round; using
    // `round` there repeated the same sentence three times even after variantOf stopped
    // cycling. First use gets authored copy, later uses consume variants, then go mute.
    const occurrence = timesUsed.get(paletteSource.id) ?? 0;
    if (occurrence > 0) {
      const copy = variantOf(paletteSource, occurrence);
      delete scene.captionPattern;
      delete scene.text;
      if (copy.captionPattern != null) scene.captionPattern = copy.captionPattern;
      if (copy.text != null) scene.text = copy.text;
    }
    bump(paletteSource.id);
    scene.id = uniqueId(scene.id);
    scenes.push(scene);
  }

  // Photo-rich jobs leave a surplus the fixed layouts cannot absorb. Hand it to the
  // montages, which is what they are for — rather than leaving the couple's photos on the
  // floor without saying so.
  let surplus = storyPhotos - spent;
  if (surplus > 0) {
    for (const scene of scenes) {
      if (surplus <= 0) break;
      if (!isVariable(scene)) continue;
      const slot = scene.photoSlots[0];
      const room = VARIABLE_MAX[scene.effect] - slot.count;
      const add = Math.min(room, surplus);
      slot.count += add;
      surplus -= add;
    }
  }

  // Durations last: lay the scenes out at the length the recipe says they feel, then scale
  // the whole set once so it lands on the track. Scaling is uniform, so the recipe still
  // decides which beats breathe and which cut — it just no longer decides, alone, how long
  // the film is.
  const xfade = recipe.timelineRules?.transitionStrategy?.default?.duration ?? 0.8;
  let t = openingDur;
  const bases = scenes.map((s) => {
    const base = Math.max(MIN_SCENE, durationOf(s, t));
    t += base - xfade;
    return base;
  });
  const k = fitScale({
    baseDurations: bases,
    transitions: scenes.map(() => xfade),
    targetDuration: storySeconds,
  });
  scenes.forEach((s, i) => {
    s.durationSec = +Math.min(MAX_SCENE, Math.max(MIN_SCENE, bases[i] * k)).toFixed(2);
  });

  const solved = [
    ...(opening ? [{ ...opening, durationSec: +openingDur.toFixed(2) }] : []),
    ...scenes,
    ...(closing ? [{ ...closing, durationSec: +closingDur.toFixed(2) }] : []),
  ];

  const photosUsed = solved.reduce((n, s) => n + photoDemandOf(s), 0);
  return {
    scenes: solved,
    fit: {
      ...describeFit(k),
      scale: +k.toFixed(3),
      budgetSecondsPerPhoto: +photoSeconds(musicDuration, photoCount).toFixed(2),
      photosUsed,
      photoCount,
      photosLeftOver: Math.max(0, photoCount - photosUsed),
      boundBy: shape.bound,
      sceneCount: solved.length,
      cheapestSceneCosts: cheapest,
    },
  };
}

/** A recurrence of an authored scene. The author's own `repeatable.variants` come first
 *  — they wrote them precisely so a second pass would not read like the first — and once
 *  those run out the scene recurs WITHOUT its words rather than repeating them. */
function variantOf(source, round) {
  const config = typeof source.repeatable === "object" ? source.repeatable : {};
  const variants = config.variants || [];
  const variant = variants[round - 1];
  if (!variant) return mute({ ...source, repeatable: undefined });
  return { ...source, ...variant, repeatable: undefined };
}
