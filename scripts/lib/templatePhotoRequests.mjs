import { editorialRole } from "./tier1Editorial.mjs";
import { MONTAGE_EFFECTS, MONTAGE_MAX } from "./engineCapabilities.mjs";

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
          orient: definition.orient || "any",
          role: editorialRole(scene, definition),
          allowSequence: Boolean(scene.allowSequence),
          cohesionMode: scene.cohesionMode || "auto",
          hero: definition.quality === "best" || Boolean(definition.motion),
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
    });
  });

  return requests;
}
