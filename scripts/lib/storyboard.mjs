// Compose a shot list from what the job actually HAS, instead of from a shot list
// someone once wrote for one wedding.
//
// The old premium generator carried 16 fixed scenes and 12 fixed lines of text. It
// asked for 42 photo slots no matter what, so 23 photos meant showing one of them
// eight times, and 203 seconds of music meant 90 seconds of it playing over
// nothing. The scene count was never a function of the inputs, and that is the bug
// — the hardcoded names were only its most visible symptom.
//
// What the numbers actually say:
//
//   budget  = musicDuration / photoCount        seconds of film each photo carries
//   spend   = sceneDuration / photosInScene     what a layout costs per photo
//
// A montage shows 6 photos in 13 seconds: 2.2s each. If the budget is 8.8s each,
// that montage cannot appear — not because it is ugly, but because it spends the
// photo set four times faster than the song can afford. Photo-rich jobs are the
// opposite: with 200 photos and a 200s track the budget is 1s per photo, and
// single-photo scenes would leave most of the set on the floor.
//
// So: CODE decides how many scenes there are and what each one costs. The AI
// decides what they SAY and how they look. That is Phụ lục A — the model picks
// enums, the code computes numbers — applied to the one decision that was never
// computed at all.
import { sceneDur, xfadeDur, fitScale, describeFit, photoSeconds, MIN_SCENE, MAX_SCENE } from "./pacing.mjs";

export const CLOSING_SEC = 8;
export const DEFAULT_MAX_REUSE = 1;
export const MIN_K = 0.9;
export const MAX_K = 1.7;

/** Layouts grouped by how many photos they consume. Ids must exist in the library. */
export function layoutsByPhotoCount(library) {
  const buckets = new Map();
  for (const l of library.layouts || []) {
    const n = (l.photoSlots || []).length;
    if (!buckets.has(n)) buckets.set(n, []);
    buckets.get(n).push(l.id);
  }
  return buckets;
}

/**
 * How many scenes, and how many photos in each.
 *
 * `ideal` is the scene count that needs no stretching at all. `capacity` is the
 * count the photo set can actually pay for. The answer is the smaller of the two,
 * and which one binds tells you what kind of job this is:
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

/** Pick a layout that consumes exactly `n` photos, rotating within its bucket so a
 *  23-scene film is not 23 copies of the same frame. */
function pickLayout(buckets, n, seen) {
  for (let k = n; k >= 1; k--) {
    const options = buckets.get(k);
    if (!options?.length) continue;
    const counts = options.map((id) => seen.get(id) ?? 0);
    const least = Math.min(...counts);
    const id = options[counts.indexOf(least)];
    seen.set(id, (seen.get(id) ?? 0) + 1);
    return { layout: id, photos: k };
  }
  return null;
}

/**
 * The shot list. Returns scenes with a layout, a photo count and a duration, plus
 * the `fit` report — which callers are expected to surface rather than swallow.
 */
export function composeStoryboard({
  photoCount,
  musicDuration,
  energy,
  library,
  acts = [],
  maxReuse = DEFAULT_MAX_REUSE,
  montageEffect = "film_roll_up",
}) {
  const buckets = layoutsByPhotoCount(library);
  const avgBase = sampleAvgBase(energy, musicDuration);
  const shape = planSceneCount({ photoCount, musicDuration, avgBase, maxReuse });

  // Hand the extra photos to the earliest scenes, so a photo-rich job opens with
  // its richest frames rather than trailing them at the end.
  const perScene = Array.from({ length: shape.scenes }, (_, i) =>
    shape.photosPerScene + (i < shape.remainder ? 1 : 0)
  );

  const seen = new Map();
  const actFor = (i) => (acts.length ? acts[Math.min(acts.length - 1, Math.floor((i * acts.length) / shape.scenes))] : undefined);

  // Two passes: lay the scenes out at their natural length, then scale the whole
  // set so it lands on the track. Scaling is uniform, so the music still decides
  // which scenes breathe and which cut — it just no longer decides, alone, how
  // long the film is.
  let t = 0;
  const draft = perScene.map((n, i) => {
    const e = energy.at(t);
    const base = sceneDur(e);
    const xf = xfadeDur(e);
    const many = n >= 5;
    const chosen = many ? { layout: null, photos: n } : pickLayout(buckets, n, seen) ?? { layout: null, photos: n };
    t += base - xf;
    return {
      id: `s${String(i + 1).padStart(2, "0")}`,
      act: actFor(i),
      layout: chosen.layout,
      effect: chosen.layout ? "layer_scene" : montageEffect,
      photos: chosen.photos,
      base,
      xfade: xf,
    };
  });

  const k = fitScale({
    baseDurations: draft.map((s) => s.base),
    transitions: draft.map((s) => s.xfade),
    targetDuration: Math.max(1, musicDuration - CLOSING_SEC),
  });

  const scenes = draft.map((s) => ({
    ...s,
    duration: +Math.min(MAX_SCENE, Math.max(MIN_SCENE, s.base * k)).toFixed(2),
  }));

  // The closing card carries no photo and is not stretched: it is a full stop, and
  // a full stop does not get longer because the song did.
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
    },
  };
}

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
