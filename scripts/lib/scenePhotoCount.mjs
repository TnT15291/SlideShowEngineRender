// How many photos a scene demands from the photo-assignment solver, given the
// layout library and (optionally) a tier-1 direction's montage multiplier.
//
// Shared by applyStoryTemplate.mjs (the real build, which knows `direction`) and
// revisionDiff.mjs (a preview, which does not — a preview cannot know which
// direction a rebuild will pick, so it calls this without one and gets the
// multiplier's neutral default instead of a guess; see revisionDiff.mjs).
export function scenePhotoCount(scene, { library, direction } = {}) {
  if (scene.effect === "video_background") return 0;
  if (scene.effect === "layer_scene") {
    const layout = (library?.layouts || []).find((l) => l.id === scene.layout);
    return layout?.photoSlots?.length || 0;
  }
  const multiplier = direction?.pacing?.controls?.montagePhotoMultiplier ?? 1;
  return (scene.photoSlots || []).reduce((sum, slot) => sum + Math.max(1, Math.round((slot.count || 1) * multiplier)), 0);
}
