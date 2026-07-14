// Compose a shot list from what the job actually HAS, instead of from a shot list
// someone once wrote for one wedding.
//
// THE FIRST BUG THIS KILLED. The old premium generator carried 16 fixed scenes and 12
// fixed lines of text. It asked for 42 photo slots no matter what, so 23 photos meant
// showing one of them eight times, and 203 seconds of music meant 90 seconds of it
// playing over nothing. The scene count was never a function of the inputs.
//
// THE SECOND BUG, which the fix for the first one hid. Solving the COUNT is not the same
// as composing a FILM. This function used to compute one number — photosPerScene — and
// hand every scene the same one. Every scene therefore landed in the same layout bucket,
// and since the 2-photo bucket holds exactly one layout, a job could come out as the same
// frame twenty times. On the job that prompted this rewrite it came out as 23 scenes of
// one photo each, held ten seconds apiece, rotating three text cards: A-B-C-A-B-C. The
// engine has 29 effects and this function emitted one of them (layer_scene) plus a
// montage it almost never reached. It looked cheaper than the template tier.
//
// So there are two numbers, not one:
//
//   budget  = musicDuration / photoCount        seconds of film each photo carries
//   spend   = sceneDuration / photosInScene     what a shape costs per photo
//
// A montage shows 6 photos in 13 seconds: 2.2s each. If the budget is 8.8s each, that
// montage cannot appear often — not because it is ugly, but because it spends the photo
// set four times faster than the song can afford. Photo-rich jobs are the opposite.
//
// What CODE owns is still the arithmetic: how many scenes, what each costs, how long each
// runs. What it now also owns is VARIETY — because monotony is not a matter of taste
// either. It is a measurable property of a shot list, and a shot list that repeats one
// shape is wrong in the same way one that overruns the song is wrong.
//
// What the AI owns is the vocabulary: WHICH effects, WHICH transitions, and how much of
// the film is designed cards versus full-frame photography. That is Phụ lục A — the model
// picks enums, the code computes numbers — applied to the decision that had no owner.
import {
  sceneDur, xfadeDur, fitScale, describeFit, photoSeconds, MIN_SCENE, MAX_SCENE,
} from "./pacing.mjs";
import {
  SINGLE_PHOTO_EFFECTS, MONTAGE_EFFECTS, MONTAGE_MAX, MONTAGE_MIN, MONTAGE_SLOT,
  EASING_EFFECTS, MOTION_EFFECTS, layoutsByPhotoCount,
} from "./engineCapabilities.mjs";

export const CLOSING_SEC = 8;
export const DEFAULT_MAX_REUSE = 1;
export const MIN_K = 0.9;
export const MAX_K = 1.7;

export { layoutsByPhotoCount };

/** House vocabulary, used when there are no director notes (the Lite fallback) — still
 *  varied, because a wordless fallback film is not an excuse for a monotonous one. */
export const DEFAULT_GRAMMAR = {
  singlePhotoEffects: ["slow_zoom_in", "kenburns_tl", "pan_right", "slow_zoom_out", "kenburns_br", "dark_feather"],
  montageEffects: ["film_roll_up", "collage_grid", "memory_wall"],
  transitionPalette: ["crossfade", "dissolve", "fade_slow"],
  layoutMix: 0.35,
  easingCalm: "gentle",
  easingEnergetic: "snap",
};

/**
 * How many scenes, and how many photos in each.
 *
 * `ideal` is the scene count that needs no stretching at all. `capacity` is the count the
 * photo set can actually pay for. Which one binds tells you what kind of job this is:
 *
 *   capacity binds  -> photo-poor: few scenes, each holding one photo for a long time
 *   ideal binds     -> photo-rich: as many scenes as the song wants, each holding several
 */
export function planSceneCount({ photoCount, musicDuration, avgBase, maxReuse = DEFAULT_MAX_REUSE }) {
  const capacity = Math.max(1, Math.floor(photoCount * maxReuse));
  const forStory = Math.max(1, musicDuration - CLOSING_SEC);
  const ideal = Math.max(1, Math.round(forStory / avgBase));
  const scenes = Math.min(ideal, capacity);
  const photosPerScene = Math.max(1, Math.floor(capacity / scenes));
  const remainder = capacity - photosPerScene * scenes;
  return { scenes, photosPerScene, remainder, capacity, ideal, bound: ideal <= capacity ? "music" : "photos" };
}

/** Rotate a palette by least-used, never repeating what came immediately before.
 *
 * Least-used rather than modulo, because modulo over a 3-item palette IS A-B-C-A-B-C —
 * which is exactly the film we are here to stop making. */
function createRotor(items, fallback) {
  const pool = (items || []).filter(Boolean);
  const used = new Map();
  let previous = null;
  return function next(exclude = null) {
    const options = pool.filter((id) => id !== previous && id !== exclude);
    const from = options.length ? options : pool;
    if (!from.length) return fallback;
    const pick = from.reduce((a, b) => ((used.get(b) ?? 0) < (used.get(a) ?? 0) ? b : a));
    used.set(pick, (used.get(pick) ?? 0) + 1);
    previous = pick;
    return pick;
  };
}

/**
 * How many photographs each scene spends — and therefore what each scene CAN be.
 *
 * THE SHAPE OF THE ANSWER MATTERS MORE THAN THE ARITHMETIC. Spreading the budget smoothly
 * across the scenes is the obvious thing to do, and it is wrong: with 23 photos over 15
 * scenes every scene wants 1.5 photographs, so every scene rounds to a 1- or 2-photo card
 * and the film has exactly one texture from beginning to end. Correct arithmetic, monotonous
 * film. That is the trap the first version of this fell into, one level up from the bug it
 * was written to fix.
 *
 * A film has a rhythm because its scenes are NOT alike. So the surplus — every photograph
 * beyond one per scene — is deliberately CONCENTRATED into a few montage beats instead of
 * being smeared over all of them. What comes out is bimodal, which is what a wedding film
 * actually looks like: long single frames that breathe, punctuated by a montage that spends
 * a dozen photographs in one sweep.
 *
 *   surplus = budget - scenes          photographs that do not fit "one each"
 *   a montage of size s                occupies ONE scene and absorbs (s-1) of the surplus
 *
 * Montages land on the loudest passages, never next to each other, and never so many that
 * the film becomes a slideshow of grids.
 */
function allocatePhotos({ budget, energyAt, times, buckets, montageCap = 0, cardSlots = 0 }) {
  const count = times.length;
  const photos = new Array(count).fill(1);
  const montageAt = new Set();
  let surplus = budget - count;

  // The scene count is capped at capacity upstream, so "one each" always fits and a
  // negative surplus can only come from rounding. Nothing to concentrate: every scene is a
  // single held frame, which is the right answer for a job this photo-poor anyway.
  if (surplus <= 0) return { photos, montageAt };

  const byEnergy = times.map((t, i) => ({ i, e: energyAt(t) })).sort((a, b) => b.e - a.e);
  const picked = [];

  // A montage is only worth being one at four photographs; below that it is a crossfade
  // with extra machinery. And it can only hold what the director's chosen montage effects
  // can hold — a palette of nothing but double_exposure tops out at two, so there are no
  // montages on this film, and the budget must not pretend otherwise.
  if (montageCap >= 4) {
    // HOW MANY MONTAGES THE JOB NEEDS — derived from the surplus, not from a fixed share of
    // the scenes. Capping the count at a fraction of the film reads as prudence and is not:
    // on a photo-rich job (200 photographs, a 200s track) it left 57 of the couple's photos
    // unplaced, because the few montages allowed were already full. The surplus has to go
    // somewhere, and a montage is the only shape with room for it.
    //
    // ~5 photographs per montage rather than the 12 it could hold: two montages of five are
    // a rhythm, one of nine is a lump. The ceiling is the non-adjacency rule itself — no two
    // montages in a row, and none on the bookends.
    const wanted = Math.min(Math.round(surplus / 5), Math.floor((count - 1) / 2));
    for (const { i } of byEnergy) {
      if (picked.length >= wanted) break;
      if (i === 0 || i === count - 1) continue;              // the opening is a title card
      if (picked.some((j) => Math.abs(j - i) <= 1)) continue; // never two montages in a row
      picked.push(i);
    }
    picked.sort((a, b) => a - b);
  }

  // Share the surplus BETWEEN the montages rather than pouring it all into the first one.
  // Handing the loudest beat everything it could hold produced a single nine-photo sweep
  // and left the second montage empty — one lump, not a rhythm.
  for (let k = 0; k < picked.length && surplus > 0; k++) {
    const share = Math.min(montageCap - 1, Math.ceil(surplus / (picked.length - k)));
    if (1 + share < 4) continue;
    photos[picked[k]] += share;
    surplus -= share;
    montageAt.add(picked[k]);
  }

  // Anything still left over enriches the CARDS — a card holding three photographs is a
  // different picture from a card holding one. Only a layout can render a multi-photo
  // scene that is not a montage, so enriching a scene MAKES it a card: this loop is bounded
  // by the card budget, or the surplus would quietly turn the whole film back into the
  // slideshow of text cards this rewrite exists to end.
  //
  // Size 3 over size 2 where the library allows it, because the 3-bucket holds three
  // layouts and the 2-bucket holds exactly one — enrich everything to 2 and you get the
  // same frame every time.
  const sizes = [3, 2].filter((n) => (buckets.get(n)?.length ?? 0) > 0);
  const preferred = sizes.sort((a, b) => (buckets.get(b).length - buckets.get(a).length) || b - a)[0];
  let cards = 0;
  for (const { i } of byEnergy) {
    if (surplus <= 0 || !preferred || cards >= cardSlots) break;
    if (montageAt.has(i) || i === 0) continue;
    const target = surplus >= preferred - 1 ? preferred : 2;
    const add = Math.min(target - photos[i], surplus);
    if (add > 0) { photos[i] += add; surplus -= add; cards++; }
  }
  // A stubborn remainder (every scene already topped up) goes back to the montages, which
  // are the only shapes with room left.
  for (const i of montageAt) {
    if (surplus <= 0) break;
    const room = Math.min(montageCap - photos[i], surplus);
    photos[i] += room;
    surplus -= room;
  }
  // Nowhere left to put them: the budget genuinely exceeds what these shapes can hold.
  // Say so in `fit` rather than silently leaving the couple's photographs on the floor.
  return { photos, montageAt, unplaced: Math.max(0, surplus) };
}

/**
 * The shot list. Returns scenes with an effect, a layout or a photo count, a duration and
 * a transition role — plus the `fit` report, which callers are expected to surface.
 */
export function composeStoryboard({
  photoCount,
  musicDuration,
  energy,
  library,
  acts = [],
  maxReuse = DEFAULT_MAX_REUSE,
  grammar = {},
  montageEffect,
}) {
  const g = { ...DEFAULT_GRAMMAR, ...grammar };
  // A director that named a montage effect the old way still gets heard.
  if (montageEffect && !grammar.montageEffects) g.montageEffects = [montageEffect, ...DEFAULT_GRAMMAR.montageEffects];

  const singles = g.singlePhotoEffects.filter((e) => SINGLE_PHOTO_EFFECTS.has(e));
  const montages = (g.montageEffects.filter((e) => MONTAGE_EFFECTS.has(e)).length
    ? g.montageEffects.filter((e) => MONTAGE_EFFECTS.has(e))
    : DEFAULT_GRAMMAR.montageEffects);
  const singleRotor = createRotor(singles.length ? singles : DEFAULT_GRAMMAR.singlePhotoEffects, "slow_zoom_in");

  // The most photographs any of the director's montage effects can actually hold. The
  // budget is solved against this, so a beat is never allocated nine photographs and then
  // handed to a double_exposure, which holds two — the other seven would simply vanish.
  const montageCap = montages.length ? Math.max(...montages.map((e) => MONTAGE_MAX[e])) : 0;

  const montageUse = new Map();
  let previousMontage = null;
  /** A montage effect that can hold exactly this many photographs, least-used first. */
  function pickMontage(want) {
    const fits = montages.filter((e) => MONTAGE_MIN[e] <= want && want <= MONTAGE_MAX[e]);
    const pool = fits.length ? fits : montages.filter((e) => MONTAGE_MAX[e] >= want);
    if (!pool.length) return null;
    const options = pool.filter((e) => e !== previousMontage);
    const from = options.length ? options : pool;
    const pick = from.reduce((a, b) => ((montageUse.get(b) ?? 0) < (montageUse.get(a) ?? 0) ? b : a));
    montageUse.set(pick, (montageUse.get(pick) ?? 0) + 1);
    previousMontage = pick;
    return pick;
  }

  const buckets = layoutsByPhotoCount(library);
  const layoutRotors = new Map();
  for (const [n, ids] of buckets) layoutRotors.set(n, createRotor(ids, ids[0]));

  const avgBase = sampleAvgBase(energy, musicDuration);
  const shape = planSceneCount({ photoCount, musicDuration, avgBase, maxReuse });

  // Where each scene FALLS in the song — needed before the shapes are known, so estimate
  // with the natural length and correct once the real durations exist.
  const times = Array.from({ length: shape.scenes }, (_, i) => (i * (musicDuration - CLOSING_SEC)) / shape.scenes);

  // HOW MANY SCENES MAY BE DESIGNED CARDS. layer_scene is the only effect that can carry
  // text, and the only one that cannot move — so it is punctuation, not prose. Left
  // ungoverned the composer made the entire film out of it, which is what a slideshow is.
  //
  // The quota has to be known BEFORE the photographs are handed out, because a scene
  // holding more than one photograph can only be rendered by a layout: enriching a scene is
  // the same act as making it a card, and a budget that does not know that will hand out a
  // surplus the shot list then has to turn into cards it has no room for.
  const layoutQuota = Math.max(1, Math.round(shape.scenes * clamp(g.layoutMix, 0.1, 0.6)));
  let layoutsUsed = 0;

  const { photos: wanted, montageAt, unplaced = 0 } = allocatePhotos({
    budget: shape.capacity,
    energyAt: (t) => energy.at(t),
    times,
    buckets,
    montageCap,
    cardSlots: Math.max(0, layoutQuota - 1), // the opening is already one
  });

  const actFor = (i) =>
    acts.length ? acts[Math.min(acts.length - 1, Math.floor((i * acts.length) / shape.scenes))] : undefined;

  let previousLayout = null;
  const draft = wanted.map((want, i) => {
    const t = times[i];
    const e = energy.at(t);
    const act = actFor(i);
    const isOpening = i === 0;

    const actChanged = i > 0 && act !== actFor(i - 1);

    // A scene holding more than one photograph HAS to be a card — a layout is the only
    // thing that can render one. The allocator already bounded how many of those exist, so
    // this is not a loophole in the quota; it is the same decision, read back. Beyond that,
    // a card earns its place where the film needs a breath or a title: the opening, an act
    // change, or a quiet passage.
    const wantsCard =
      isOpening ||
      want >= 2 ||
      (layoutsUsed < layoutQuota && (actChanged || e < 0.42) && buckets.has(1));

    let scene;
    const montageEffectFor = montageAt.has(i) ? pickMontage(want) : null;
    if (montageEffectFor) {
      // Decided during allocation, not here: the surplus was already spent against this
      // scene's size, so re-deciding its shape now would leave photographs unplaced.
      scene = {
        effect: montageEffectFor,
        photos: clamp(want, MONTAGE_MIN[montageEffectFor], MONTAGE_MAX[montageEffectFor]),
        slot: MONTAGE_SLOT[montageEffectFor],
      };
    } else if (wantsCard) {
      const n = pickLayoutSize(buckets, want);
      const layout = layoutRotors.get(n)(previousLayout);
      previousLayout = layout;
      layoutsUsed++;
      scene = { effect: "layer_scene", layout, photos: n };
    } else {
      // ONE photograph, full frame — the shape that was missing from this composer
      // entirely. On a photo-poor job it is most of the film, and that is exactly why the
      // effect has to MOVE: this frame is about to be held for eight seconds.
      const effect = singleRotor();
      scene = { effect, photos: 1, slot: "hero" };
    }

    const base = shapeDuration(scene, sceneDur(e));
    return {
      id: `s${String(i + 1).padStart(2, "0")}`,
      ...(act ? { act } : {}),
      ...scene,
      base,
      xfade: xfadeDur(e),
      energy: +e.toFixed(3),
      transitionRole: transitionRoleFor({ i, e, actChanged, isOpening }),
      ...(EASING_EFFECTS.has(scene.effect) ? { easing: e > 0.6 ? g.easingEnergetic : g.easingCalm } : {}),
    };
  });

  // Lay the scenes out at their natural length, then scale the whole set so it lands on
  // the track. Scaling is uniform, so the RATIOS survive — a montage still runs twice as
  // long as a held single, which is what rhythm actually is.
  const k = fitScale({
    baseDurations: draft.map((s) => s.base),
    transitions: draft.map((s) => s.xfade),
    targetDuration: Math.max(1, musicDuration - CLOSING_SEC),
  });

  const scenes = draft.map((s) => ({
    ...s,
    duration: +Math.min(MAX_SCENE, Math.max(MIN_SCENE, s.base * k)).toFixed(2),
  }));

  // The closing card carries no photo and is not stretched: it is a full stop, and a full
  // stop does not get longer because the song did.
  const closingLayout = (buckets.get(0) || [])[0];
  if (closingLayout) {
    scenes.push({
      id: "s99_closing",
      act: "ending",
      layout: closingLayout,
      effect: "layer_scene",
      photos: 0,
      base: CLOSING_SEC,
      xfade: 0,
      duration: CLOSING_SEC,
      transitionRole: "final",
    });
  }

  const photosUsed = scenes.reduce((n, s) => n + s.photos, 0);
  return {
    scenes,
    fit: {
      ...describeFit(k),
      scale: +k.toFixed(3),
      budgetSecondsPerPhoto: +photoSeconds(musicDuration, photoCount).toFixed(2),
      photosUsed,
      photoCount,
      maxReuse,
      boundBy: shape.bound,
      sceneCount: scenes.length,
      // Photographs the shot list could not place: every shape was full. Reported rather
      // than swallowed — leaving the couple's pictures on the floor is a thing they are
      // entitled to hear about, not a rounding detail.
      ...(unplaced ? { unplacedPhotos: unplaced } : {}),
      variety: describeVariety(scenes),
    },
  };
}

/** What the shot list actually looks like — the number the old composer could not have
 *  reported, because the answer was always "one effect, three layouts". */
function describeVariety(scenes) {
  const effects = new Set(scenes.map((s) => s.effect));
  const layouts = new Set(scenes.filter((s) => s.layout).map((s) => s.layout));
  const shapes = new Set(scenes.map((s) => s.photos));
  let repeats = 0;
  for (let i = 1; i < scenes.length; i++) {
    if (scenes[i].effect === scenes[i - 1].effect && scenes[i].layout === scenes[i - 1].layout) repeats++;
  }
  return {
    distinctEffects: effects.size,
    distinctLayouts: layouts.size,
    distinctPhotoCounts: shapes.size,
    adjacentRepeats: repeats,
    effects: [...effects],
  };
}

/** The layout bucket that best spends `want` photographs, never more than the pool owes. */
function pickLayoutSize(buckets, want) {
  for (let n = Math.min(want, 4); n >= 1; n--) if (buckets.get(n)?.length) return n;
  return 1;
}

/** A shape's natural length. The music says how fast the film breathes; the SHAPE says how
 *  long this particular breath is — a six-photo montage cannot land in the same 5 seconds
 *  as a single held portrait, and pretending it can is why every scene came out 6.58s. */
function shapeDuration(scene, base) {
  if (MONTAGE_EFFECTS.has(scene.effect)) {
    return +(base * clamp(0.55 + 0.26 * scene.photos, 1.05, 2.3)).toFixed(2);
  }
  if (scene.effect === "layer_scene") {
    // A card has to be READ, and a card with more photographs has more to look at.
    return +(base * (1.06 + 0.09 * Math.max(0, scene.photos - 1))).toFixed(2);
  }
  // A single photograph: the ones that move can hold; the static ones must not outstay.
  return +(base * (MOTION_EFFECTS.includes(scene.effect) ? 1 : 0.84)).toFixed(2);
}

function transitionRoleFor({ i, e, actChanged, isOpening }) {
  if (isOpening) return "default";
  if (actChanged) return "chapter";
  if (e > 0.72) return "peak";
  return "default";
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** Mean natural scene length across the track — the scale the song is asking for. */
function sampleAvgBase(energy, musicDuration) {
  let sum = 0;
  let n = 0;
  for (let t = 0; t < musicDuration; t += 5) {
    sum += sceneDur(energy.at(t));
    n++;
  }
  return n ? sum / n : sceneDur(0.5);
}
