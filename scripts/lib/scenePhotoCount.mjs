// How many photos a scene demands from the photo-assignment solver, given the
// layout library and (optionally) a tier-1 direction's montage multiplier.
//
// Shared by applyStoryTemplate.mjs (the real build, which knows `direction`) and
// revisionDiff.mjs (a preview, which does not — a preview cannot know which
// direction a rebuild will pick, so it calls this without one and gets the
// multiplier's neutral default instead of a guess; see revisionDiff.mjs).
import { MONTAGE_EFFECTS, MONTAGE_MAX } from "./engineCapabilities.mjs";

export function scenePhotoCount(scene, { library, direction } = {}) {
  if (scene.effect === "video_background") return 0;
  if (scene.effect === "layer_scene") {
    // scene.resolvedLayout and the library layout always agree on slot COUNT — a recipe
    // look may dress slots but never add or remove one (lib/lookResolver.mjs, invariant
    // I1, enforced by V2/V3). That is what lets the photo budget ignore looks entirely.
    const layout = scene.resolvedLayout
      || (library?.layouts || []).find((l) => l.id === scene.layout);
    return layout?.photoSlots?.length || 0;
  }
  const multiplier = direction?.pacing?.controls?.montagePhotoMultiplier ?? 1;
  return (scene.photoSlots || []).reduce((sum, slot) => {
    const count = slot.count || 1;
    const demand = MONTAGE_EFFECTS.has(scene.effect) && !slot.fixedCount
      ? Math.min(MONTAGE_MAX[scene.effect] ?? Infinity, Math.max(1, Math.round(count * multiplier)))
      : count;
    return sum + demand;
  }, 0);
}
