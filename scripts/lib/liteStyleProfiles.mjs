// A profile deliberately carries NO `fonts`. It used to pin every slot to
// BeVietnamPro, and generateProjectTimeline wrote that into `defaults.fonts`,
// which createTemplateTheme.resolveFont() consults BEFORE the library theme —
// so a Lite film set the couple's names in the same UI sans as its body copy
// while the theme's own display face (Cormorant, Fraunces, PlayfairDisplay) and
// script accent (Allura, JosefinSans) sat unused. Every measured Lite timeline
// came out with exactly one typeface against three in every template-tier film.
// Leaving `fonts` off lets `libraryTheme` below supply the voice, which is the
// same path the template tier already takes.
// HOW WIDE A PROFILE'S VOCABULARY IS, AND WHY IT GREW.
//
// Each profile used to offer 5 single-photo effects, 2 montages and 3 transitions. Scored
// against the 25 authored recipes (scripts/gradeComposedFilm.mjs) a lite film came out at 8
// distinct effects against the corpus's 11 — the widest gap on the whole scorecard, and the
// one a customer comparing the two tiers would actually see. The engine offers 24 single
// effects and 9 montages; the profiles were spending a fifth of it.
//
// Widened to 8 singles / 3 montages / 5 transitions each — one transition per ROLE the
// composer can fill (default, chapter, peak, quiet, final), since a shorter palette makes two
// roles play the same cut. Every addition is chosen for the profile's own mood rather than to
// make a number go up: the gentle profile takes soft focus and a dream bloom, the film
// profile takes the print-and-grain family, the editorial one takes the graphic effects.
export const LITE_STYLE_PROFILES = Object.freeze({
  white_wedding_gentle: Object.freeze({
    id: "white_wedding_gentle",
    libraryTheme: "white_weddings",
    grade: { temperature: 5600, saturation: 1.02, contrast: 1.02, glow: 0.08 },
    captionBacking: { color: "#000000", opacity: 0.42 },
    singlePhotoEffects: [
      "slow_zoom_in", "slow_zoom_out", "pan_left", "pan_right", "portrait_blur_background",
      "kenburns_tl", "circle_focus", "dream_glow",
    ],
    montageEffects: ["photo_strip_up", "collage_grid", "double_exposure"],
    transitionPalette: ["crossfade", "dissolve", "fade_slow", "fade_to_white", "smooth_right"],
    layoutMix: 0.32,
  }),
  warm_film_story: Object.freeze({
    id: "warm_film_story",
    libraryTheme: "warm_film",
    grade: { temperature: 5850, saturation: 1.05, contrast: 1.03, glow: 0.12 },
    captionBacking: { color: "#21140f", opacity: 0.46 },
    singlePhotoEffects: [
      "kenburns_tl", "kenburns_br", "slow_zoom_in", "pan_left", "portrait_blur_background",
      "pan_up", "polaroid", "dark_feather",
    ],
    montageEffects: ["film_roll_up", "photo_strip_left", "memory_wall"],
    transitionPalette: ["dissolve", "fade_to_black", "smooth_left", "crossfade", "fade_slow"],
    layoutMix: 0.28,
  }),
  editorial_clean: Object.freeze({
    id: "editorial_clean",
    libraryTheme: "editorial_bold",
    grade: { temperature: 5500, saturation: 0.98, contrast: 1.06, glow: 0.04 },
    captionBacking: { color: "#000000", opacity: 0.36 },
    singlePhotoEffects: [
      "slow_zoom_in", "pan_right", "spotlight_focus", "mirror_split", "portrait_reflection",
      "slow_zoom_out", "tilt_shift", "prism_split",
    ],
    montageEffects: ["collage_grid", "memory_wall", "film_roll_right"],
    transitionPalette: ["crossfade", "wipe_left", "smooth_right", "fade_to_black", "dissolve"],
    layoutMix: 0.38,
  }),
});

export function resolveLiteStyleProfile({ prompt = "", requested } = {}) {
  if (requested) {
    const profile = LITE_STYLE_PROFILES[requested];
    if (!profile) throw new Error(`Unknown Lite style profile "${requested}"`);
    return { profile, provenance: "requested" };
  }
  const normalized = String(prompt).toLowerCase();
  const id = /film|ấm|warm|vintage/.test(normalized) ? "warm_film_story"
    : /editorial|tạp chí|clean|sạch|tối giản|minimal/.test(normalized) ? "editorial_clean"
      : "white_wedding_gentle";
  return { profile: LITE_STYLE_PROFILES[id], provenance: id === "white_wedding_gentle" ? "fallback" : "prompt" };
}
