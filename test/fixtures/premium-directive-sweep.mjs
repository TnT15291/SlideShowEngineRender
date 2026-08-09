// The shape that lost fifteen of a customer's photographs.
//
// Trimmed from projects/layout-primitives-premium-baseline: an opening act holding
// three six-photo montages, a ledger carrying one ordinary order — "mở đầu tĩnh" —
// and a love_story act with montages that still have room to grow. Every number here
// is the real job's, so a regression on this fixture is a regression on that film.
//
// No photographs needed: the whole defect lives in scene shape and photo demand.

/** A composed storyboard — `origin: "composed"` means the scene plan, the photo budget
 *  and the durations were already solved together. That is exactly the contract the
 *  directive layer used to break. */
export function sweepStoryboard() {
  return {
    id: "premium-directive-sweep",
    source: { origin: "composed", notes: "Solved against 30 photos." },
    timelineRules: { durationStrategy: { baseSceneSec: 5.5, calmSceneSec: 7, buildSceneSec: 4.5, montageSec: 12, closingSec: 8 } },
    scenes: [
      // index 0 is structural — it carries the couple's names.
      { id: "s01", act: "opening", effect: "layer_scene", layout: "text_left_photo_right", durationSec: 4.59, photoSlots: [] },
      { id: "s02", act: "opening", effect: "memory_wall", durationSec: 8.96, photoSlots: [{ slot: "memories", count: 6 }] },
      { id: "s03", act: "opening", effect: "still", durationSec: 3.79, photoSlots: [{ slot: "hero", count: 1 }] },
      { id: "s04", act: "opening", effect: "photo_strip_up", durationSec: 8.96, photoSlots: [{ slot: "film_roll", count: 6 }] },
      { id: "s05", act: "opening", effect: "slow_zoom_in", durationSec: 4.42, photoSlots: [{ slot: "hero", count: 1 }] },
      { id: "s06", act: "opening", effect: "slow_zoom_out", durationSec: 4.33, photoSlots: [{ slot: "hero", count: 1 }] },
      { id: "s07", act: "opening", effect: "collage_grid", durationSec: 8.96, photoSlots: [{ slot: "grid", count: 6 }] },
      { id: "s08", act: "opening", effect: "kenburns_tl", durationSec: 4.42, photoSlots: [{ slot: "hero", count: 1 }] },
      // Somewhere for freed photographs to go.
      { id: "s09", act: "love_story", effect: "slow_zoom_in", durationSec: 5.5, photoSlots: [{ slot: "hero", count: 1 }] },
      { id: "s10", act: "love_story", effect: "memory_wall", durationSec: 7, photoSlots: [{ slot: "memories", count: 3 }] },
      { id: "s11", act: "love_story", effect: "film_roll_up", durationSec: 8, photoSlots: [{ slot: "film_roll", count: 4 }] },
      { id: "s12_closing", act: "ending", effect: "layer_scene", layout: "closing_card", durationSec: 8, photoSlots: [] },
    ],
  };
}

/** "mở đầu tĩnh" as parseBrief compiles it. Byte for byte the order in
 *  projects/layout-primitives-premium-baseline/directives.json. */
export const STILL_OPENING = {
  id: "r0.1", round: 0, source: "prompt", quote: "mở đầu tĩnh",
  kind: "effect", op: "set", scope: { act: "opening" },
  target: "still", strength: "must", confidence: 0.9,
};

/** What each scene costs the photo pool. Stands in for scenePhotoCount(), which needs
 *  the layout library; the fixture declares every slot explicitly so it does not. */
export const photoDemand = (scene) =>
  (scene.photoSlots || []).reduce((n, s) => n + (s.count || 1), 0);

export const totalDemand = (scenes) => scenes.reduce((n, s) => n + photoDemand(s), 0);

/** The longest run of consecutive scenes sharing one effect — the measure behind
 *  MAX_LAYOUT_RUN, and the reason seven still frames in a row is a defect. */
export function longestEffectRun(scenes) {
  let best = 0, run = 0, prev = null;
  for (const s of scenes) {
    run = s.effect === prev ? run + 1 : 1;
    prev = s.effect;
    if (run > best) best = run;
  }
  return best;
}
