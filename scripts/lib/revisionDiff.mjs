// WHAT WILL THIS CHANGE ACTUALLY DO? — the answer, before the customer commits to it.
//
// reviseProject prints the directives it compiled ("effect/set film_roll_up @ the whole
// film") and that reads like a preview, but it is not one: it is a restatement of the
// REQUEST, not of the CONSEQUENCE. The two come apart badly, because applying a
// directive to a storyboard is destructive in two ways nothing currently mentions:
//
//   1. A single-image retarget deletes the scene's `layout` and `text`
//      (directives.mjs). "dùng polaroid" quietly strips an art-directed card down to a
//      bare photograph — and the dedication the customer wrote on it goes with it.
//   2. A montage ABSORBS its neighbours: splice(head.i, run.length, montage). Ask for a
//      film roll and three designed scenes cease to exist.
//
// Both are deliberate and both are correct — a montage that did not absorb would
// over-draw the photo budget. What is not correct is that they happen silently. The
// customer types one sentence and finds out what it cost by watching the next cut.
//
// So: apply to a COPY, diff, and say it in words a person can act on. This module
// decides nothing and writes nothing — the caller owns the ledger.
//
// Structural scenes (the title card, the closing card) are already exempt from sweeps
// inside applyToStoryboard, so they never show up here. That is the point: this reports
// what the engine WILL do, by asking the engine, rather than by re-deriving its rules
// and drifting away from them.
import { applyToStoryboard } from "./directives.mjs";

const clone = (o) => JSON.parse(JSON.stringify(o));

/** The words on a scene, flattened. A recipe slot is either a bare string or
 *  {value, sizePx, ...} — the customer wrote the same sentence either way. */
export function textOf(scene) {
  const t = scene?.text;
  if (!t || typeof t !== "object") return [];
  return Object.values(t)
    .map((v) => (typeof v === "string" ? v : v && typeof v === "object" ? v.value : ""))
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => s.trim());
}

const byId = (scenes) => new Map((scenes || []).map((s) => [s.id, s]));
const strategy = (doc) => doc?.timelineRules?.transitionStrategy || {};

/** Diff two storyboards into things a customer would recognise. */
export function diffStoryboard(before, after) {
  const a = byId(before.scenes);
  const b = byId(after.scenes);

  // Gone entirely — absorbed into a montage. Their words go with them, so quote the
  // words: "3 scenes removed" is a statistic, the dedication is the actual loss.
  const removed = (before.scenes || [])
    .filter((s) => !b.has(s.id))
    .map((s) => ({ id: s.id, effect: s.effect, layout: s.layout || null, text: textOf(s) }));

  const added = (after.scenes || []).filter((s) => !a.has(s.id)).map((s) => ({ id: s.id, effect: s.effect }));

  const changed = [];
  for (const [id, was] of a) {
    const now = b.get(id);
    if (!now) continue;
    const lostText = textOf(was).filter((t) => !textOf(now).includes(t));
    const entry = {
      id,
      effect: was.effect !== now.effect ? { from: was.effect, to: now.effect } : null,
      lostLayout: was.layout && !now.layout ? was.layout : null,
      lostText,
    };
    if (entry.effect || entry.lostLayout || lostText.length) changed.push(entry);
  }

  const sa = strategy(before);
  const sb = strategy(after);
  const transition = {};
  for (const key of ["default", "final"]) {
    if (sa[key]?.type !== sb[key]?.type) transition[key] = { from: sa[key]?.type ?? null, to: sb[key]?.type ?? null };
  }

  return {
    changed,
    removed,
    added,
    transition,
    // The three ways a customer loses something they had. Anything here deserves a
    // question, not a progress bar.
    destructive:
      removed.length > 0 ||
      changed.some((c) => c.lostText.length > 0 || c.lostLayout),
    any: changed.length > 0 || removed.length > 0 || added.length > 0 || Object.keys(transition).length > 0,
  };
}

/** How many photos a scene consumes, given the layout library.
 *
 *  A montage absorbs neighbours until it hits the photo cap, so the report's "which
 *  scenes disappear" IS this number. Get it wrong and the preview warns about the wrong
 *  scenes, which is worse than not warning at all.
 *
 *  DUPLICATED, KNOWINGLY, from scenePhotoCount() in applyStoryTemplate.mjs — which is
 *  not exported and is mid-edit in another session. This is the drift risk this codebase
 *  otherwise refuses to take (see how the directive whitelists load from timeline.schema
 *  .json), so it is a debt, not a pattern: when applyStoryTemplate settles, export its
 *  version and delete this one. The `montagePhotoMultiplier` from a tier-1 direction is
 *  deliberately NOT read here — a preview does not know which direction a rebuild will
 *  pick, and inventing one would make the report authoritative about a guess. */
export function photoDemandFrom(library) {
  return (scene) => {
    if (scene.effect === "video_background") return 0;
    if (scene.effect === "layer_scene") {
      const layout = (library?.layouts || []).find((l) => l.id === scene.layout);
      return layout?.photoSlots?.length || 0;
    }
    return (scene.photoSlots || []).reduce((sum, slot) => sum + (slot.count || 1), 0);
  };
}

/** Apply `before` and `after` directive sets to copies of the storyboard and diff them.
 *  `after` is the FULL active set once the new round lands — not just the new round —
 *  because supersession means the round's effect is only visible against the whole. */
export function previewChange({ storyboard, before = [], after = [], availablePhotos = Infinity, photoDemand } = {}) {
  const opts = { availablePhotos, photoDemand };
  const base = clone(storyboard);
  applyToStoryboard(base, before, opts);
  const next = clone(storyboard);
  applyToStoryboard(next, after, opts);
  return diffStoryboard(base, next);
}

/** The diff, in sentences. Returns [] when nothing about the film changes — which is
 *  itself worth saying out loud: a request that compiles to valid directives and then
 *  changes nothing is the failure mode a receipt is supposed to catch. */
export function formatDiff(diff) {
  const lines = [];
  for (const c of diff.changed) {
    if (c.effect) lines.push(`  ${c.id}: ${c.effect.from} → ${c.effect.to}`);
    if (c.lostLayout) lines.push(`      loses its designed layout (${c.lostLayout})`);
    for (const t of c.lostText) lines.push(`      LOSES THE WORDS: ${JSON.stringify(t)}`);
  }
  for (const r of diff.removed) {
    lines.push(`  ${r.id}: REMOVED — absorbed into the montage`);
    for (const t of r.text) lines.push(`      LOSES THE WORDS: ${JSON.stringify(t)}`);
  }
  for (const a of diff.added) lines.push(`  ${a.id}: new ${a.effect} scene`);
  for (const [key, t] of Object.entries(diff.transition)) {
    lines.push(`  transition (${key}): ${t.from ?? "recipe default"} → ${t.to}`);
  }
  return lines;
}
