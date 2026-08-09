// A COMPOSED FILM'S OWN FACE.
//
// The library owns safe geometry; a recipe owns visual identity through `looks`
// (lib/lookResolver.mjs). The 24 authored recipes needed exactly that to stop being
// interchangeable: nine white_weddings recipes were once byte-identical because they all sat
// on the same primitives, and only per-recipe looks and layoutOverrides pulled them apart.
//
// Composed films never got that layer. Premium and lite both emitted bare `layout:` ids, so
// every film either tier has ever made shares one set of photo geometry with every other —
// and the scorecard says so out loud: 0.714 arrangements per card against the authored
// corpus's 0.778, on a film with 21 cards.
//
// So this derives a look set PER JOB. Deterministic from the job's name, because two runs of
// the same job must produce the same film, and two different couples must not get the same
// one. Three things vary, and they are three different kinds of thing:
//
//   grade        from the film's OWN theme. composeStoryboard hardcoded white_weddings'
//                grade (5600/1.05/1.03/0.12) for every film, so a warm_film job rendered at
//                the wrong temperature with no grain, and super8_nostalgia and
//                teal_orange_editorial lost their LUTs — the entire identity of those two.
//   frame        one job-specific preset in `layoutPresets`, the way warm-film-01 owns
//                `sprocket_edge`.
//   arrangement  where the photographs actually SIT. This is the only one that moves a
//                picture: frame, type and grade do not, which is how 64% of scenes once
//                shared an arrangement while every guard read green (see
//                lib/geometrySignature.mjs). A variant is a named, topology-preserving
//                transform of the layout's own slots — never a new set of coordinates
//                invented from nothing.
//
// NOTHING HERE IS TRUSTED. Every candidate look is put through validateLook — the same V1-V5
// the authored corpus answers to, including the canvas boundary and the "photo covers the
// words" check — and through photoArrangementKey, which must actually CHANGE or the look is
// a re-skin that inflates a diversity count without moving anything. A candidate that fails
// either is dropped and the next variant tried; a layout where none survive keeps its bare
// primitive, which is exactly what it had before this file existed.
import { validateLook, rotatedSlotBounds } from "./lookResolver.mjs";
import { photoArrangementKey } from "./geometrySignature.mjs";
import { hashSeed } from "./copyVariants.mjs";
import {
  SLOT_AREA_FLOOR, SLOT_AREA_FLOOR_GRID, SCENE_PHOTO_COVERAGE_MIN, SCENE_PHOTO_COVERAGE_MIN_TEXTED,
} from "./rules/thresholds.mjs";

/** Deterministic small integer from a seed and a label — the same primitive the copy
 *  variants use, so "this job's look" and "this job's words" are decided the same way. */
const pick = (seed, label, count) => (count ? hashSeed(`${seed}:${label}`) % count : 0);
const choose = (seed, label, options) => options[pick(seed, label, options.length)];
const round = (n) => Math.round(n);

/** The photo slots a look may move: everything except a full-bleed background, which fills
 *  the canvas by definition and stops being a background the moment it is nudged. */
function movableSlots(layout) {
  const backgroundId = layout.background?.type === "photo_full_bleed" ? layout.background.slot : null;
  return (layout.photoSlots || []).filter((slot) => slot.id !== backgroundId);
}

/** The rectangle the photographs already occupy. Every variant stays inside it, which is
 *  what keeps a generated look from covering the words or leaving the canvas: the layout's
 *  designer already decided where the photo band belongs, and a look only rearranges what
 *  happens INSIDE it. */
function bandOf(slots) {
  const bounds = slots.map(rotatedSlotBounds);
  return {
    x: Math.min(...bounds.map((b) => b.x)),
    y: Math.min(...bounds.map((b) => b.y)),
    right: Math.max(...bounds.map((b) => b.right)),
    bottom: Math.max(...bounds.map((b) => b.bottom)),
  };
}

const fitsBand = (slots, band) => slots.every((slot) => {
  const b = rotatedSlotBounds(slot);
  // A pixel of slack: the transforms round to integers and a band edge derived from the
  // slots themselves would otherwise reject a slot for landing exactly where it started.
  return b.x >= band.x - 1 && b.y >= band.y - 1 && b.right <= band.right + 1 && b.bottom <= band.bottom + 1;
});

const overlapArea = (a, b) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
  * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/**
 * A variant may not make two photographs collide that the layout kept apart.
 *
 * `tighten` grows every frame and pulls it inward, which is right for a scatter — the prints
 * were always meant to sit on top of one another — and wrong for a grid, where two tiles
 * touching reads as a mistake rather than a composition. The layout already says which it
 * is, by whether its own slots overlap; this only forbids CHANGING that answer.
 */
function keepsSlotsApart(before, after) {
  for (let i = 0; i < before.length; i++) {
    for (let j = i + 1; j < before.length; j++) {
      const was = overlapArea(before[i], before[j]);
      const now = overlapArea(after[i], after[j]);
      const smallest = Math.min(after[i].width * after[i].height, after[j].width * after[j].height);
      if (was <= 0 && now / Math.max(1, smallest) > 0.02) return false;
    }
  }
  return true;
}

/**
 * The same coverage floor templateRules holds every recipe to, applied BEFORE the look is
 * offered rather than after the gate rejects it.
 *
 * Three of the five variants shrink their frames, and a layout already sitting on the 35%
 * floor cannot afford a single per-cent — measured: polaroid_scatter, circle_trio_stagger
 * and diagonal_staircase_trio all failed the gate the first time this ran. The check is here
 * so the generator picks a variant that fits instead of proposing one that cannot.
 */
function keepsCoverage(layout, after, canvasArea) {
  const backgroundId = layout.background?.type === "photo_full_bleed" ? layout.background.slot : null;
  if (backgroundId) return true; // accents riding on a full-bleed photo, not the frame itself
  const floor = after.length >= 6 ? SLOT_AREA_FLOOR_GRID : SLOT_AREA_FLOOR;
  let total = 0;
  for (const slot of after) {
    const fraction = (slot.width * slot.height) / canvasArea;
    if (fraction < floor) return false;
    total += fraction;
  }
  return total >= (layout.textRequired ? SCENE_PHOTO_COVERAGE_MIN_TEXTED : SCENE_PHOTO_COVERAGE_MIN);
}

/**
 * The arrangement variants. Each one is a whole-band transform that preserves TOPOLOGY —
 * a grid stays a grid, a scatter stays a scatter — so a variant cannot turn a composition
 * into one its layout was never designed to hold. They are written to be recognisable:
 * a person looking at two of them should be able to say which is which.
 */
/** Re-centre one slot on (x, y) while keeping the size it has been given. */
const centredOn = (slot, x, y) => ({ ...slot, x: round(x - slot.width / 2), y: round(y - slot.height / 2) });

/**
 * Put the transformed slots back inside the band.
 *
 * `spread` taught this the hard way: the band is the bounding box of the slots themselves,
 * so pushing the outermost frame outward can NEVER fit — the outermost frame is what defines
 * the edge. Rejecting the variant for that would have thrown away the composition rather than
 * the setting, and on the library's own layouts it threw away four of five. So the push is a
 * WISH: take the strongest one that fits, stepping back toward "leave the centres where they
 * are", and clamp the last few pixels per slot. A push of 1.0 with resized frames is still a
 * different picture — the sizes changed, and that is what the arrangement key reads.
 */
function place(slots, band, push) {
  const cx = (band.x + band.right) / 2;
  const cy = (band.y + band.bottom) / 2;
  const attempt = (k) => slots.map((slot) => centredOn(
    slot,
    cx + (slot.x + slot.width / 2 - cx) * k,
    cy + (slot.y + slot.height / 2 - cy) * k,
  ));
  const steps = [push];
  for (let k = push; Math.abs(k - 1) > 0.005; k += (push > 1 ? -0.01 : 0.01)) steps.push(+k.toFixed(3));
  steps.push(1);
  for (const k of steps) {
    const moved = attempt(k);
    if (fitsBand(moved, band)) return moved;
  }
  // Last resort: hold the sizes and slide each frame back over the edge it crossed. A few
  // pixels, and keepsSlotsApart still has to agree with the result.
  return attempt(1).map((slot) => {
    const b = rotatedSlotBounds(slot);
    const dx = b.x < band.x ? band.x - b.x : b.right > band.right ? band.right - b.right : 0;
    const dy = b.y < band.y ? band.y - b.y : b.bottom > band.bottom ? band.bottom - b.bottom : 0;
    return { ...slot, x: round(slot.x + dx), y: round(slot.y + dy) };
  });
}

const resized = (slot, scale) => ({
  ...slot, width: round(slot.width * scale), height: round(slot.height * scale),
  x: slot.x + (slot.width - round(slot.width * scale)) / 2,
  y: slot.y + (slot.height - round(slot.height * scale)) / 2,
});

export const ARRANGEMENT_VARIANTS = Object.freeze({
  /** Air between the pictures: each frame a little smaller, set a little further apart. */
  spread(slots, band, [shrink, push]) {
    return place(slots.map((slot) => resized(slot, shrink)), band, push);
  },
  /** The opposite reading: the pictures pulled together into one block. */
  tighten(slots, band, [grow, pull]) {
    return place(slots.map((slot) => resized(slot, grow)), band, pull);
  },
  /** Alternate frames stepped down the band, like prints laid out by hand. */
  cascade(slots, band, [depth]) {
    const step = Math.min(48, (band.bottom - band.y) * depth);
    if (step < 12) return null; // too shallow a band for the step to read as one
    const stepped = slots.map((slot, index) => {
      const small = resized(slot, 0.94);
      return { ...small, y: small.y + (index % 2 ? step : -step) };
    });
    return place(stepped, band, 1);
  },
  /** One picture given the weight, the rest stepping back from it. */
  feature(slots, band, [up, down]) {
    if (slots.length < 2) return null;
    let hero = 0;
    slots.forEach((slot, index) => {
      if (slot.width * slot.height > slots[hero].width * slots[hero].height) hero = index;
    });
    return place(slots.map((slot, index) => resized(slot, index === hero ? up : down)), band, 1);
  },
  /** Off-square, alternating — the snapshot-on-a-table reading. */
  tilt(slots, band, [degrees, shrink]) {
    return place(slots.map((slot, index) => ({
      ...resized(slot, shrink),
      rotation: +((slot.rotation ?? 0) + (index % 2 ? degrees : -degrees)).toFixed(1),
    })), band, 1);
  },
});

/**
 * How hard each variant pulls, three settings apiece.
 *
 * Seeded ORDER alone was not enough to tell two films apart: most layouts have room for
 * only one or two of the five variants, so both couples landed on the same one — measured,
 * 16 of 17 arrangements identical between two jobs on the same album. The strength is what
 * separates them. Every setting is small enough that the composition still reads as the one
 * the layout's designer drew, and each is far enough from its neighbours to survive the 1%
 * quantisation in photoArrangementKey — otherwise two strengths would score as one.
 */
const STRENGTHS = Object.freeze({
  spread: [[0.90, 1.08], [0.87, 1.12], [0.93, 1.05]],
  tighten: [[1.04, 0.94], [1.07, 0.91], [1.02, 0.965]],
  cascade: [[0.06], [0.045], [0.075]],
  feature: [[1.08, 0.90], [1.13, 0.86], [1.05, 0.94]],
  tilt: [[3, 0.88], [2, 0.91], [4, 0.85]],
});

const VARIANT_INTENT = {
  spread: "the frames given air, each a little smaller and set a little further apart",
  tighten: "the frames pulled into one block, closer and slightly larger",
  cascade: "alternate frames stepped down the band, like prints laid out by hand",
  feature: "one photograph given the weight, the others stepping back from it",
  tilt: "the prints set off-square, alternating, as if dropped on a table",
};

/** This job's colour, from ITS OWN theme rather than one theme's numbers copied everywhere.
 *  Only the four continuous fields are nudged; `lut`, `grain`, `vignette`, `flicker` and
 *  `letterbox` are what the theme IS and are carried through untouched. */
export function composedGrade(theme, seed) {
  return nudgeGrade(theme?.colorGrade ?? {}, seed);
}

/** The nudge itself, over any base grade — lite substitutes its style profile's grade for
 *  the theme's, and two couples on one profile should still not get the same numbers. */
export function nudgeGrade(base = {}, seed) {
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const nudge = (label, value, span, lo, hi, digits) => {
    if (value == null) return undefined;
    const offset = (pick(seed, label, 5) - 2) / 2; // -1, -0.5, 0, 0.5, 1
    return +clamp(value + offset * span, lo, hi).toFixed(digits);
  };
  const grade = {
    ...base,
    ...(base.temperature != null ? { temperature: nudge("temp", base.temperature, 200, 3800, 7200, 0) } : {}),
    ...(base.saturation != null ? { saturation: nudge("sat", base.saturation, 0.04, 0.85, 1.2, 3) } : {}),
    ...(base.contrast != null ? { contrast: nudge("con", base.contrast, 0.03, 0.9, 1.2, 3) } : {}),
    ...(base.glow != null ? { glow: nudge("glow", base.glow, 0.04, 0, 0.3, 3) } : {}),
  };
  // A theme with no grade of its own still gets a defensible one rather than nothing.
  return Object.keys(grade).length ? grade : { temperature: 5600, saturation: 1.05, contrast: 1.03, glow: 0.12 };
}

/** One frame preset per job, the way warm-film-01 owns `sprocket_edge`. Radii stay small
 *  enough that frameRadiusErrors cannot fire on any slot the library contains. */
export function composedFrame(theme, seed) {
  const palette = theme?.palette ?? {};
  const border = choose(seed, "frame:border", [0, 6, 10, 14]);
  return {
    radius: choose(seed, "frame:radius", [0, 12, 20, 28, 36]),
    ...(border ? {
      border,
      borderColor: choose(seed, "frame:color", [
        palette.numeral_white, palette.cream_bg, palette.white, "#FFFFFF",
      ].filter(Boolean)),
      shadow: true,
    } : {}),
  };
}

/**
 * Derive this job's look set and dress the scenes with it.
 *
 * @param {object[]} scenes  the composed shot list (mutated: cards gain `look`)
 * @param {{library: object, theme: string, seed: string, template?: object}} options
 * @returns {{looks: object, layoutPresets: object, applied: object[], skipped: string[]}}
 */
export function deriveComposedLooks(scenes, { library, theme: themeId, seed }) {
  const canvas = library?.meta?.canvas ?? { width: 1920, height: 1080 };
  const theme = library?.designTokens?.themes?.[themeId] ?? {};
  const layoutById = new Map((library?.layouts ?? []).map((l) => [l.id, l]));
  const frameId = "job_frame";
  const layoutPresets = { [frameId]: composedFrame(theme, seed) };
  const looks = {};
  const applied = [];
  const skipped = [];

  const treatment = {
    saturation: +(1 + (pick(seed, "treat:sat", 5) - 2) * 0.015).toFixed(3),
    contrast: +(1 + (pick(seed, "treat:con", 5) - 2) * 0.012).toFixed(3),
  };

  const cardsByLayout = new Map();
  for (const scene of scenes) {
    if (scene.effect !== "layer_scene" || !scene.layout) continue;
    if (!cardsByLayout.has(scene.layout)) cardsByLayout.set(scene.layout, []);
    cardsByLayout.get(scene.layout).push(scene);
  }
  const variantNames = Object.keys(ARRANGEMENT_VARIANTS);
  const canvasArea = canvas.width * canvas.height;

  for (const [layoutId, cards] of cardsByLayout) {
    const layout = layoutById.get(layoutId);
    if (!layout) continue;
    const movable = movableSlots(layout);
    if (!movable.length) { skipped.push(layoutId); continue; }
    const band = bandOf(movable);
    const baseKey = photoArrangementKey({ effect: "layer_scene", layout: layoutId, resolvedLayout: layout }, library, canvas);

    // EVERY variant that survives, not the first one — because a layout a film spends six
    // times showing one arrangement six times is the exact debt this file exists to pay. One
    // look per layout would have left arrangements-per-card where it was.
    const survivors = [];
    // Each job starts its search at a different point, so two couples on one layout do not
    // both take the same variant first.
    const offset = pick(seed, `variant:${layoutId}`, variantNames.length);
    const keys = new Set([baseKey]);

    // Each (job, layout, variant) also gets a strength, and a candidate that fails at one
    // strength is retried at the others: the constraints are tight enough that "spread by
    // 12%" can be refused where "spread by 5%" fits, and refusing the whole variant would
    // have thrown away a composition the layout could carry.
    const attempts = [];
    for (const name of variantNames) {
      const settings = STRENGTHS[name];
      const start = pick(seed, `strength:${layoutId}:${name}`, settings.length);
      for (let s = 0; s < settings.length; s++) {
        attempts.push({ name, strength: settings[(start + s) % settings.length], rank: s });
      }
    }
    attempts.sort((a, b) =>
      a.rank - b.rank
      || ((variantNames.indexOf(a.name) - offset + variantNames.length) % variantNames.length)
       - ((variantNames.indexOf(b.name) - offset + variantNames.length) % variantNames.length));

    for (const { name, strength } of attempts) {
      if (looks[`${layoutId}__${name}`]) continue; // one look per variant name per layout
      const moved = ARRANGEMENT_VARIANTS[name](movable, band, strength);
      if (!moved || !fitsBand(moved, band)) continue;
      if (!keepsSlotsApart(movable, moved)) continue;
      if (!keepsCoverage(layout, moved, canvasArea)) continue;

      const photoSlots = {};
      for (const slot of moved) {
        photoSlots[slot.id] = {
          x: slot.x, y: slot.y, width: slot.width, height: slot.height,
          ...(slot.rotation != null ? { rotation: slot.rotation } : {}),
        };
      }
      const lookId = `${layoutId}__${name}`;
      const look = {
        intent: VARIANT_INTENT[name],
        layout: layoutId,
        frame: frameId,
        photoTreatment: treatment,
        layoutOverrides: { photoSlots },
      };
      const stub = { looks: { [lookId]: look }, layoutPresets };
      if (validateLook(lookId, look, { template: stub, library }).length) continue;

      // The whole point: a look that does not move a photograph is a re-skin, and the debt
      // ledger in lib/geometrySignature.mjs exists because a corpus full of those measured
      // as diverse. Prove it moved, and that it moved somewhere no sibling look already is.
      const resolved = {
        effect: "layer_scene", layout: layoutId,
        resolvedLayout: { ...layout, photoSlots: layout.photoSlots.map((s) => ({ ...s, ...(photoSlots[s.id] ?? {}) })) },
      };
      const key = photoArrangementKey(resolved, library, canvas);
      if (keys.has(key)) continue;
      keys.add(key);

      looks[lookId] = look;
      survivors.push(lookId);
      // A layout used twice needs two arrangements, not five: looks nothing renders are
      // dead weight in the recipe and the resolver warns about them.
      if (survivors.length >= cards.length) break;
    }

    if (!survivors.length) { skipped.push(layoutId); continue; }
    cards.forEach((scene, index) => {
      // `layout` stays alongside `look`: the resolver accepts both when they agree, and
      // every pre-resolution reader in the pipeline (photoDemand, the repair pass,
      // describeVariety) is keyed on it.
      scene.look = survivors[index % survivors.length];
      applied.push({ id: scene.id, look: scene.look });
    });
  }

  return { looks, layoutPresets, applied, skipped };
}
