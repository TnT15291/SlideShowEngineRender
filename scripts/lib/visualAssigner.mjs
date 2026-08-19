/**
 * Hand the shot list its pictures.
 *
 * The first film's 99 visuals were placed by hand across 53 beats — days of
 * work, and the single thing standing between this pipeline and a second film.
 * The rules below are not invented: they are read back off that hand-assigned
 * cut, which is the only evidence available of what a good version looks like.
 *
 * MEASURED FROM THE ANTT CUT (81 photos, 18 clips):
 *
 *   pillarboxing        6/81 = 7.4% non-landscape, on an album that is 121/339
 *                       portrait. The editor spent landscape first, deliberately.
 *   repeated photos     0
 *   adjacent same effect 0, across nine zoompan effects used 7-10 times each
 *   portrait handling   5 of the 6 non-landscape photos carry
 *                       `portrait_blur_background`, which fills the frame with a
 *                       blurred copy instead of leaving bars down the sides
 *   adjacent same pool  40 — because a section draws from one pool by design
 *
 * That last number killed a rule this module was planned to have ("never put two
 * slides from the same pool next to each other"). It is not a defect; it is what
 * a sectioned film looks like, and enforcing the opposite would have forced the
 * assigner to reach outside a section's pool and away from its landscape
 * photographs — trading the thing that shows (bars down the sides of the frame)
 * for a thing that does not (which folder a picture came from).
 *
 * The human always wins: a beat that already carries a `visual`/`visuals` the
 * editor wrote is passed through untouched, and the photographs it uses are
 * struck off the pool so nothing else takes them.
 */

/** Effects that move a landscape photograph. Nine, in the order the ANTT cut favoured them. */
export const LANDSCAPE_EFFECTS = [
  "slow_zoom_in", "pan_right", "slow_zoom_out", "pan_left",
  "kenburns_br", "kenburns_tr", "pan_up", "kenburns_bl", "kenburns_tl",
];

/** A frame-filling treatment, so a tall photograph does not sit between two bars. */
export const PORTRAIT_EFFECT = "portrait_blur_background";

/** Landscape first, then square, then portrait — the ordering the 7.4% depends on. */
const ORIENTATION_RANK = { landscape: 0, square: 1, portrait: 2 };

function orientationRank(photo) {
  return ORIENTATION_RANK[photo?.orient] ?? ORIENTATION_RANK.portrait;
}

/**
 * Does this beat already carry an editor's decision?
 *
 * `visuals: []` counts as a decision — it is how a beat inside a merged window
 * is deliberately left with nothing of its own to show.
 */
export function hasAuthoredVisual(beat) {
  if (Array.isArray(beat.visuals)) return true;
  return Boolean(beat.visual) && beat.visual.kind !== "pending";
}

function authoredVisuals(beat) {
  if (Array.isArray(beat.visuals)) return beat.visuals;
  return hasAuthoredVisual(beat) ? [beat.visual] : [];
}

/**
 * Spread `count` visuals over `beats`, front-loaded.
 *
 * The builder flattens a group's beats and spends visuals[part-1] in order, so
 * which beat a picture hangs on changes nothing about the film. It changes a
 * lot about reading script.json afterwards, which is why they are spread rather
 * than piled onto the first beat.
 */
export function distribute(count, beats) {
  const shares = new Array(beats).fill(0);
  for (let index = 0; index < count; index += 1) shares[index % beats] += 1;
  return shares;
}

/**
 * @param {object} input
 * @param {any[]} input.groups        from planGroups() — the builder's own view of the shot list
 * @param {Record<string,string[]>} input.sectionPools  section id → pool names, in preference order
 * @param {Record<string,number[]>} input.pools         pool name → indices into `photos`
 * @param {any[]} input.photos        [{ file, orient }], indexed as the pools refer to them
 * @param {any[]} input.clips         [{ file, duration }] from footage.json
 * @param {(group:any)=>number} input.slideDuration     seconds a group's part will occupy
 */
export function assignVisuals({ groups, sectionPools, pools, photos, clips = [], slideDuration }) {
  const usedPhotos = new Set();
  const usedClips = new Set();
  const warnings = [];

  // Everything the editor already chose is reserved before the first automatic
  // pick, so the assigner can never hand out a photograph a beat already uses.
  for (const group of groups) {
    for (const beat of group.beats) {
      for (const visual of authoredVisuals(beat)) {
        if (visual?.kind === "photo" && visual.src) usedPhotos.add(visual.src);
        if (visual?.kind === "clip" && visual.src) usedClips.add(visual.src);
      }
    }
  }

  const assignments = new Map();
  let previousEffect = "";
  let previousClip = "";
  let effectCursor = 0;

  // One group per line of the film, so "the section just changed" and "the last
  // picture was this one" are answerable while walking forward.
  const firstGroupOfSection = new Map();
  for (const group of groups) {
    const section = group.beats[0]?.section ?? "";
    if (!firstGroupOfSection.has(section)) firstGroupOfSection.set(section, group);
  }

  // Clips are the scarce, expensive material. Spend one where it does the most
  // work — opening a section — and spread whatever is left evenly rather than
  // emptying the shelf into the first two minutes.
  const totalParts = groups.reduce((sum, group) => sum + (hasAuthoredVisual(group.beats[0]) ? 0 : 1), 0);
  const spareClips = Math.max(0, clips.length - usedClips.size - firstGroupOfSection.size);
  const clipInterval = spareClips > 0 ? Math.max(1, Math.floor(totalParts / spareClips)) : Infinity;

  let partIndex = 0;
  for (const group of groups) {
    if (group.part !== 1) continue;
    const authored = group.beats.some((beat) => hasAuthoredVisual(beat));
    if (authored) {
      // Remember what the editor's pictures were, so the next automatic pick
      // does not repeat their effect or restart the same clip.
      const last = group.beats.flatMap(authoredVisuals).at(-1);
      if (last?.effect) previousEffect = last.effect;
      previousClip = last?.kind === "clip" ? last.src : "";
      partIndex += group.partCount;
      continue;
    }

    const section = group.beats[0]?.section ?? "";
    const poolNames = sectionPools[section] ?? [];
    const duration = slideDuration(group);
    const picked = [];

    for (let part = 0; part < group.partCount; part += 1) {
      partIndex += 1;
      const opensSection = part === 0 && firstGroupOfSection.get(section) === group;
      const wantsClip = opensSection || (clipInterval !== Infinity && partIndex % clipInterval === 0);

      if (wantsClip) {
        // A clip shorter than its slide makes the builder throw, and two
        // neighbouring slides on one clip both restart it at zero, which reads
        // as the picture jumping backwards.
        const clip = clips.find((candidate) =>
          !usedClips.has(candidate.file) && candidate.file !== previousClip && candidate.duration + 0.001 >= duration);
        if (clip) {
          usedClips.add(clip.file);
          previousClip = clip.file;
          previousEffect = "";
          picked.push({ kind: "clip", src: clip.file, assignedBy: "auto" });
          continue;
        }
      }

      const photo = nextPhoto({ poolNames, pools, photos, usedPhotos });
      if (!photo) {
        warnings.push(`${group.beats.map((beat) => beat.id).join("+")}: pool(s) ${poolNames.join(", ") || "(none declared)"} ran out of unused photographs.`);
        break;
      }
      usedPhotos.add(photo.entry.file);
      previousClip = "";
      const effect = photo.entry.orient === "landscape"
        ? pickEffect(previousEffect, effectCursor++)
        : PORTRAIT_EFFECT;
      previousEffect = effect;
      picked.push({ kind: "photo", src: photo.entry.file, effect, pool: photo.pool, photoIndex: photo.index, assignedBy: "auto" });
    }

    if (picked.length) {
      const shares = distribute(picked.length, group.beats.length);
      let cursor = 0;
      for (const [offset, beat] of group.beats.entries()) {
        assignments.set(beat.id, picked.slice(cursor, cursor + shares[offset]));
        cursor += shares[offset];
      }
    }
  }

  return { assignments, warnings };
}

/**
 * The next unused photograph, landscape before square before portrait.
 *
 * Pools are consulted in the order the section declares them, and each pool is
 * exhausted of landscape frames before the next pool is opened — that ordering
 * is the whole of the 7.4% figure.
 */
function nextPhoto({ poolNames, pools, photos, usedPhotos }) {
  const candidates = [];
  for (const [preference, pool] of poolNames.entries()) {
    for (const index of pools[pool] ?? []) {
      const entry = photos[index];
      if (!entry || usedPhotos.has(entry.file)) continue;
      candidates.push({ entry, index, pool, preference, rank: orientationRank(entry) });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.rank - b.rank || a.preference - b.preference || a.index - b.index);
  return candidates[0];
}

/** Round-robin, skipping whatever ran last so no cut lands on the same motion twice. */
function pickEffect(previous, cursor) {
  for (let offset = 0; offset < LANDSCAPE_EFFECTS.length; offset += 1) {
    const effect = LANDSCAPE_EFFECTS[(cursor + offset) % LANDSCAPE_EFFECTS.length];
    if (effect !== previous) return effect;
  }
  return LANDSCAPE_EFFECTS[0];
}
