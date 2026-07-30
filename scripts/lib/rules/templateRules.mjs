// AUTHORING RULES FOR STORY TEMPLATES — what a recipe must satisfy BEFORE any job
// runs through it.
//
// These are not QA findings (lib/rules/contract.mjs governs those: evidence about ONE
// rendered job). Template rules judge the recipe file itself, once, at authoring/CI
// time — the same defect class the customer sees on EVERY job the recipe touches.
// Each rule exists because a real render showed the failure:
//
//   scene_variety        thin palettes loop: a 4-look recipe played the same card and
//                        the same stock clip for three minutes
//   look_adjacency       the same layout on two consecutive authored scenes reads as
//                        one frame lingering, before the solver ever repeats anything
//   photoless_repetition a photoless scene repeats as the SAME clip — it cannot pay a
//                        photo debt, it can only replay itself
//   photo_coverage       slots under ~8% of the canvas read as "a tiny photo lost on
//                        an empty page"; a scene whose photos cover <35% with no
//                        full-bleed background reads as an unfinished frame
//   canvas_background    mask/wall effects on the engine's pure-black default read as
//                        "nothing around the photo" — recipes must tint the canvas
//   balanced_text        a HALF-TEXT layout with muted/blank copy is half an empty
//                        frame: every repeat variant must keep words, and the scene
//                        must name a balanced muteFallback for wordless recurrences
//   signature_hybrid     the engine has Remotion/Blender scenes far richer than any
//                        native filter; a recipe that never spends one looks cheaper
//                        than the engine it runs on
//   repeat_depth         scenes without authored variants go mute when the song is
//                        long — authors owe the repeats at least two variants
//   face_safe_motion     a hardcoded zoom on a portrait slot overrides the subject-
//                        aware planner, and a zoomed portrait crop starts at the head
//   copy_language        recipes are authored in Vietnamese and an English film is made
//                        by REWRITING them (lib/recipeCopyPolicy.mjs runs writeRecipeCopy
//                        only for language "en"), so English-authored copy has no rewrite
//                        step on the default vi path — it just ships in the wrong language
import { inspectCaptionLanguage } from "../captionLanguage.mjs";
import {
  TEMPLATE_MIN_SCENES, TEMPLATE_MIN_DISTINCT_LOOKS, TEMPLATE_MIN_REPEATABLE_SCENES,
  TEMPLATE_MAX_PHOTOLESS_SCENES, SLOT_AREA_FLOOR, SLOT_AREA_FLOOR_GRID,
  SCENE_PHOTO_COVERAGE_MIN, SCENE_PHOTO_COVERAGE_MIN_TEXTED, CANVAS_BG_MIN_LUMA,
} from "./thresholds.mjs";
import {
  HYBRID_RENDERER, MONTAGE_EFFECTS, MONTAGE_SLOT, photoDemand,
} from "../engineCapabilities.mjs";
import { resolveScene, resolveTemplate, visualSignature } from "../lookResolver.mjs";

/** Effects that paint their own canvas on the engine's black default and therefore
 *  must carry params.background (see canvasBackground() in src/buildFfmpegCommand.ts). */
export const CANVAS_EFFECTS = new Set(["mask_reveal", "memory_wall"]);

const finding = (check, sceneId, detail) => ({ check, id: sceneId ?? "template", detail });

/** The visual state a viewer registers for a scene — what "repeat" means.
 *
 *  Delegated to lib/lookResolver.mjs so a recipe cannot score well here by naming two
 *  looks that render the same picture: the signature is computed from resolved geometry,
 *  frame and treatment, and an undressed look signs as its bare layout. For a scene with
 *  no look this is character-for-character what this function always returned. */
export const lookOf = visualSignature;

const hexLuma = (hex) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex ?? "").trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
};

// A slot value may be an ARRAY of 2-3 per-customer variants (see pickVariant in
// applyStoryTemplate.mjs) instead of a single string/object — take the first
// entry as representative; the rule only asks "does this scene supply copy at
// all", not which variant a given render picks.
const first = (v) => (Array.isArray(v) ? v[0] : v);
const textOf = (text) =>
  Object.values(text ?? {}).some((v) => {
    const outer = first(v);
    const s = outer && typeof outer === "object" ? first(outer.value) : outer;
    return typeof s === "string" && s.trim() !== "";
  });

const isBody = (scene, index, scenes) =>
  index > 0 && scene.durationRole !== "closing";

/**
 * Evaluate one story template against the authoring rules.
 * @returns {{errors: object[], warnings: object[], verdict: string}}
 */
export function evaluateStoryTemplate(template, { library }) {
  const errors = [];
  const warnings = [];
  const layouts = new Map((library?.layouts ?? []).map((l) => [l.id, l]));
  const canvas = library?.meta?.canvas ?? { width: 1920, height: 1080 };
  const canvasArea = canvas.width * canvas.height;

  // EVERY GEOMETRY RULE BELOW READS RESOLVED GEOMETRY, through the same resolver the
  // build uses. Judging the authored layout instead would mean a recipe whose look nudges
  // a slot gets measured on coordinates nobody renders — the lint would pass a frame it
  // never looked at. See LOOKS-MIGRATION-PLAN.md §3.
  const resolution = resolveTemplate(template, { library });
  errors.push(...resolution.errors.map((f) => finding(f.check, f.id, f.detail)));
  warnings.push(...resolution.warnings.map((f) => finding(f.check, f.id, f.detail)));
  const scenes = resolution.scenes;

  const resolveAlternative = (scene, alternative) => {
    if (!alternative) return null;
    const merged = { ...scene, ...alternative };
    if (alternative.look) delete merged.layout;
    else if (alternative.layout) delete merged.look;
    return resolveScene(merged, { template, library }).scene;
  };
  const layoutOfScene = (scene) =>
    scene.effect === "layer_scene" ? (scene.resolvedLayout ?? layouts.get(scene.layout)) : null;

  // -- look_fallback_shape --------------------------------------------------------
  // A stand-in that names both is ambiguous, and the two paths pick differently.
  for (const scene of scenes) {
    const alternatives = [
      ["muteFallback", scene.muteFallback],
      ...(scene.repeatable?.variants ?? []).map((v, i) => [`repeat variant ${i + 1}`, v]),
    ];
    for (const [label, alternative] of alternatives) {
      if (alternative?.look && alternative?.layout) {
        errors.push(finding("look_fallback_shape", scene.id,
          `${label} names both look '${alternative.look}' and layout '${alternative.layout}' — name one`));
      }
      if (alternative?.look && !template.looks?.[alternative.look]) {
        errors.push(finding("look_reachable", scene.id,
          `${label} names unknown look '${alternative.look}'`));
      }
    }
  }

  // -- scene_variety ------------------------------------------------------------
  if (scenes.length < TEMPLATE_MIN_SCENES) {
    errors.push(finding("scene_variety", null,
      `${scenes.length} scenes; a palette under ${TEMPLATE_MIN_SCENES} makes the solver repeat it sooner`));
  }
  const looks = new Set(scenes.map(lookOf));
  if (looks.size < TEMPLATE_MIN_DISTINCT_LOOKS) {
    errors.push(finding("scene_variety", null,
      `${looks.size} distinct looks (${[...looks].join(", ")}); minimum is ${TEMPLATE_MIN_DISTINCT_LOOKS}`));
  }

  // -- look_adjacency -----------------------------------------------------------
  for (let i = 1; i < scenes.length; i++) {
    if (lookOf(scenes[i]) === lookOf(scenes[i - 1])) {
      errors.push(finding("look_adjacency", scenes[i].id,
        `authored back-to-back with ${scenes[i - 1].id}: both are ${lookOf(scenes[i])}`));
    }
  }

  // -- photoless_repetition -----------------------------------------------------
  const photoless = scenes.filter((s) => s.effect === "video_background");
  if (photoless.length > TEMPLATE_MAX_PHOTOLESS_SCENES) {
    errors.push(finding("photoless_repetition", null,
      `${photoless.length} video_background scenes; more than ${TEMPLATE_MAX_PHOTOLESS_SCENES} photoless beats turn the film into stock footage`));
  }
  const clips = photoless.map((s) => s.background).filter(Boolean);
  for (const clip of new Set(clips)) {
    if (clips.filter((c) => c === clip).length > 1) {
      errors.push(finding("photoless_repetition", null, `the same clip appears twice: ${clip}`));
    }
  }

  // -- photo_coverage (once per distinct COMPOSITION used) ------------------------
  //
  // Memoised on the visual signature, not the layout id. Two looks may sit on one layout
  // and place their slots differently; keying on the id would measure the first and wave
  // the second through on numbers it does not use — the exact hole a look could hide in.
  const seenCompositions = new Set();
  for (const scene of scenes) {
    const layout = layoutOfScene(scene);
    const composition = lookOf(scene);
    if (!layout || seenCompositions.has(composition)) continue;
    seenCompositions.add(composition);
    const bgSlot = layout.background?.type === "photo_full_bleed" ? layout.background.slot : null;
    const slots = (layout.photoSlots ?? []).filter((s) => s.id !== bgSlot);
    if (!slots.length) continue;
    const floor = slots.length >= 6 ? SLOT_AREA_FLOOR_GRID : SLOT_AREA_FLOOR;
    for (const slot of slots) {
      const frac = (slot.width * slot.height) / canvasArea;
      // Slots riding ON a full-bleed photo background are accents, not the frame.
      if (!bgSlot && frac < floor) {
        errors.push(finding("photo_coverage", scene.id,
          `layout ${layout.id} slot ${slot.id} covers ${(frac * 100).toFixed(1)}% of the canvas; floor is ${(floor * 100).toFixed(0)}%`));
      }
    }
    if (!bgSlot) {
      const total = slots.reduce((sum, s) => sum + (s.width * s.height) / canvasArea, 0);
      const min = layout.textRequired ? SCENE_PHOTO_COVERAGE_MIN_TEXTED : SCENE_PHOTO_COVERAGE_MIN;
      if (total < min) {
        errors.push(finding("photo_coverage", scene.id,
          `layout ${layout.id} photos cover ${(total * 100).toFixed(0)}% of the canvas; minimum is ${(min * 100).toFixed(0)}%`));
      }
    }
  }

  // -- canvas_background ---------------------------------------------------------
  for (const scene of scenes.filter((s) => CANVAS_EFFECTS.has(s.effect))) {
    const luma = hexLuma(scene.params?.background);
    if (luma == null) {
      errors.push(finding("canvas_background", scene.id,
        `${scene.effect} draws on the engine's pure-black canvas; set params.background to a theme-tinted hex`));
    } else if (luma < CANVAS_BG_MIN_LUMA) {
      errors.push(finding("canvas_background", scene.id,
        `params.background ${scene.params.background} has luma ${luma.toFixed(0)}; minimum is ${CANVAS_BG_MIN_LUMA} (near-black reads as no background at all)`));
    }
  }

  // -- montage_slot -------------------------------------------------------------
  for (const scene of scenes.filter((s) => MONTAGE_EFFECTS.has(s.effect))) {
    const expected = MONTAGE_SLOT[scene.effect];
    const actual = (scene.photoSlots ?? []).map((slot) => slot.slot);
    if (!actual.includes(expected)) {
      errors.push(finding("montage_slot", scene.id,
        `${scene.effect} reads photo slot ${expected}; recipe supplies ${actual.join(", ") || "none"}`));
    }
  }

  // -- balanced_text -------------------------------------------------------------
  scenes.forEach((scene, index) => {
    const layout = layoutOfScene(scene);
    if (!layout?.textRequired) return;
    if (!textOf(scene.text)) {
      errors.push(finding("balanced_text", scene.id,
        `layout ${layout.id} is textRequired but the scene supplies no copy — its text region renders as empty background`));
    }
    if (!isBody(scene, index, scenes)) return;
    const demand = photoDemand(scene, library);
    const fallback = scene.muteFallback;
    // The stand-in may be named as a look or as a bare layout; both resolve here, so the
    // rule judges the composition that will actually stand in.
    const resolvedFallback = resolveAlternative(scene, fallback);
    const fallbackLayout = resolvedFallback ? layoutOfScene(resolvedFallback) : null;
    if (!fallback || !fallbackLayout) {
      errors.push(finding("balanced_text", scene.id,
        `body scene on textRequired layout ${layout.id} needs a muteFallback layout for wordless recurrences`));
    } else {
      if (fallbackLayout.textRequired) {
        errors.push(finding("balanced_text", scene.id,
          `muteFallback ${fallbackLayout.id} is itself textRequired — a wordless repeat would still be half-empty`));
      }
      const fallbackDemand = photoDemand(resolvedFallback, library);
      if (fallbackDemand !== demand) {
        errors.push(finding("balanced_text", scene.id,
          `muteFallback ${fallback.look ?? fallback.layout} costs ${fallbackDemand} photo(s) but the scene costs ${demand} — the solver only adopts an equal-cost stand-in`));
      }
    }
    for (const [i, variant] of (scene.repeatable?.variants ?? []).entries()) {
      const vLayout = layoutOfScene(resolveAlternative(scene, variant) ?? scene);
      const vText = variant.text !== undefined ? variant.text : scene.text;
      if (vLayout?.textRequired && !textOf(vText)) {
        errors.push(finding("balanced_text", scene.id,
          `repeat variant ${i + 1} blanks the copy on textRequired layout ${vLayout.id}; keep words or switch the variant's layout`));
      }
    }
  });

  // -- signature_hybrid ----------------------------------------------------------
  const hybrids = scenes.filter((s) => s.renderer && s.template);
  if (hybrids.length < 2) {
    errors.push(finding("signature_hybrid", null,
      `${hybrids.length} Remotion/Blender signature scene(s); each recipe must carry 2-3`));
  }
  if (hybrids.length > 3) {
    errors.push(finding("signature_hybrid", hybrids[3].id,
      `${hybrids.length} Remotion/Blender signature scenes; keep at most 3 so signature moments stay special`));
  }
  for (const scene of hybrids) {
    const known = HYBRID_RENDERER[scene.template];
    if (!known) {
      errors.push(finding("signature_hybrid", scene.id, `unknown hybrid template ${scene.template}`));
    } else if (known !== scene.renderer) {
      errors.push(finding("signature_hybrid", scene.id,
        `template ${scene.template} is rendered by ${known}, not ${scene.renderer}`));
    }
  }
  const slow = hybrids.filter((s) => HYBRID_RENDERER[s.template] === "blender");
  if (slow.length > 1) {
    errors.push(finding("signature_hybrid", slow[1].id,
      `${slow.length} Blender scenes; each costs minutes of render time — spend at most one per film`));
  }

  // -- repeat_depth --------------------------------------------------------------
  const withVariants = scenes.filter((s, i) => isBody(s, i, scenes)
    && (s.repeatable?.variants?.length ?? 0) >= 2);
  if (withVariants.length < TEMPLATE_MIN_REPEATABLE_SCENES) {
    errors.push(finding("repeat_depth", null,
      `${withVariants.length} body scene(s) carry >=2 repeat variants; minimum is ${TEMPLATE_MIN_REPEATABLE_SCENES} — long songs mute-cycle everything else`));
  }

  // -- face_safe_motion ----------------------------------------------------------
  for (const scene of scenes) {
    for (const slot of scene.photoSlots ?? []) {
      if (slot.orient === "portrait" && /zoom/.test(slot.motion ?? "")) {
        errors.push(finding("face_safe_motion", scene.id,
          `slot ${slot.slot} hardcodes ${slot.motion} on a portrait — leave motion to the subject-aware planner`));
      }
    }
  }

  // -- copy_language -------------------------------------------------------------
  //
  // Judged with the SAME detector QA runs on the finished film
  // (lib/captionLanguage.mjs), so a recipe that passes here cannot raise
  // wrong_caption_language on the default vi path — the two cannot drift apart.
  //
  // Two recipes shipped authored entirely in English while their own intro prose was
  // Vietnamese: classic-multisong-album-01 and studio-white-prewedding-01. Every
  // Vietnamese job on them rendered English cards and QA flagged the film, once per job,
  // for a defect that lives in the recipe.
  const copy = [];
  const collectCopy = (value) => {
    if (typeof value === "string") copy.push(value);
    else if (Array.isArray(value)) value.forEach(collectCopy);
    // A slot may be authored as { value, ... } — see textOf above.
    else if (value && typeof value === "object") collectCopy(value.value);
  };
  for (const scene of scenes) {
    for (const source of [scene, scene.muteFallback, ...(scene.repeatable?.variants ?? [])]) {
      if (!source) continue;
      Object.values(source.text ?? {}).forEach(collectCopy);
      collectCopy(source.captionPattern);
    }
  }
  const copyLanguage = inspectCaptionLanguage(copy, "vi");
  if (copyLanguage.flags?.includes("wrong_caption_language")) {
    errors.push(finding("copy_language", null,
      `${copy.length} authored copy string(s) carry no Vietnamese at all (${copyLanguage.signals.enWords} English words). `
      + `Recipes are authored in Vietnamese; an English film comes from writeRecipeCopy.mjs rewriting them`));
  }

  return {
    errors, warnings,
    verdict: errors.length ? "error" : warnings.length ? "warning" : "pass",
  };
}
