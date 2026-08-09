import { editorialRole } from "./tier1Editorial.mjs";
import { MONTAGE_EFFECTS, MONTAGE_MAX } from "./engineCapabilities.mjs";

/**
 * The orientation a slot's own SHAPE demands, for the 104 library slots that declare none.
 *
 * The solver has full orientation machinery — a strict filter, a supply-aware `hardness`
 * ordering that serves constrained slots first, and a fallback for when the album cannot
 * pay. It was simply never given a constraint to enforce: every `photoSlots` entry in
 * layouts/library.json leaves `orient` unset, so all 104 resolved to "any" and the solver
 * seated whatever came next. What that produced is a portrait photograph in the 3.93:1
 * banner of `stacked_horizon_trio`; QA's crop check then found no focus that could hold the
 * face, "rescued" it by swapping cover for contain, and the photo rendered at **17% of its
 * slot** with the page showing through the other 83%. Two more scenes on the same job
 * landed at 40% and 56%.
 *
 * The threshold is set by what a mismatch actually costs. Photographs are near-enough 3:2
 * and 2:3, so in a slot of aspect `a` a wrong-way photo fills about `0.67 / a` of it —
 * below 55% once `a` passes ~1.22. Slots squarer than that take either orientation without
 * a visible hole and stay unconstrained, because an unnecessary constraint just spends the
 * fallback. A recipe that declares its own `orient` still wins; this only fills the silence.
 */
const SLOT_ORIENT_ASPECT = 1.25;

export function impliedSlotOrient(slot) {
  const { width, height } = slot || {};
  if (!(width > 0 && height > 0)) return "any";
  const aspect = width / height;
  if (aspect >= SLOT_ORIENT_ASPECT) return "landscape";
  if (aspect <= 1 / SLOT_ORIENT_ASPECT) return "portrait";
  return "any";
}

export function principalSlotId(layout) {
  return layout?.background?.type === "photo_full_bleed"
    ? layout.background.slot
    : layout?.photoSlots?.[0]?.id ?? null;
}

export function buildPhotoAssignmentRequests({ scenes, library, direction }) {
  const requests = [];

  scenes.forEach((scene, order) => {
    if (scene.durationRole === "closing" || scene.effect === "video_background") return;

    if (scene.effect === "layer_scene") {
      // A look never changes how many slots there are (lookResolver.mjs, I1), so the
      // request COUNT is the same either way — but principalSlotId and the per-slot
      // definitions must read the geometry that will actually be rendered.
      const layout = scene.resolvedLayout
        || (library.layouts || []).find((candidate) => candidate.id === scene.layout);
      for (const slot of layout?.photoSlots || []) {
        const definition = (scene.photoSlots || []).find((candidate) => candidate.slot === slot.id) || {};
        if (order === 0 && slot.id === principalSlotId(layout)) continue;
        requests.push({
          key: `${scene.id}:${slot.id}`,
          sceneId: scene.id,
          order,
          count: 1,
          // The recipe's own word first; the slot's geometry only fills the silence.
          orient: definition.orient || impliedSlotOrient(slot),
          role: editorialRole(scene, definition),
          allowSequence: Boolean(scene.allowSequence),
          cohesionMode: scene.cohesionMode || "auto",
          hero: definition.quality === "best" || Boolean(definition.motion),
          ...(scene.photoHints?.length ? { preferred: scene.photoHints } : {}),
        });
      }
      return;
    }

    const slot = (scene.photoSlots || [])[0];
    if (!slot) return;
    const multi = MONTAGE_EFFECTS.has(scene.effect);
    if (order === 0 && !multi) return;
    const paired = scene.effect === "double_exposure" || scene.template === "gl_transition";
    const base = slot.count || (paired ? 2 : 1);
    const multiplier = direction?.pacing?.controls?.montagePhotoMultiplier ?? 1;
    const count = multi && !slot.fixedCount
      ? Math.min(MONTAGE_MAX[scene.effect] ?? Infinity, Math.max(1, Math.round(base * multiplier)))
      : base;
    requests.push({
      key: `${scene.id}:${slot.slot}`,
      sceneId: scene.id,
      order,
      count,
      orient: slot.orient || "any",
      role: editorialRole(scene, slot),
      allowSequence: Boolean(scene.allowSequence),
      cohesionMode: scene.cohesionMode || "auto",
      hero: slot.quality === "best" || slot.slot === "hero",
      ...(scene.photoHints?.length ? { preferred: scene.photoHints } : {}),
    });
  });

  return requests;
}
