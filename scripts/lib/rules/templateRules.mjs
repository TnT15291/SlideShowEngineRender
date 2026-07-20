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
import {
  TEMPLATE_MIN_SCENES, TEMPLATE_MIN_DISTINCT_LOOKS, TEMPLATE_MIN_REPEATABLE_SCENES,
  TEMPLATE_MAX_PHOTOLESS_SCENES, SLOT_AREA_FLOOR, SLOT_AREA_FLOOR_GRID,
  SCENE_PHOTO_COVERAGE_MIN, SCENE_PHOTO_COVERAGE_MIN_TEXTED, CANVAS_BG_MIN_LUMA,
} from "./thresholds.mjs";
import {
  HYBRID_SIGNATURE_TEMPLATES, HYBRID_RENDERER, MONTAGE_EFFECTS, photoDemand,
} from "../engineCapabilities.mjs";

/** Effects that paint their own canvas on the engine's black default and therefore
 *  must carry params.background (see canvasBackground() in src/buildFfmpegCommand.ts). */
export const CANVAS_EFFECTS = new Set(["mask_reveal", "memory_wall"]);

const finding = (check, sceneId, detail) => ({ check, id: sceneId ?? "template", detail });

/** The visual state a viewer registers for a scene — what "repeat" means. */
export function lookOf(scene) {
  if (scene.renderer && scene.template) return `${scene.renderer}:${scene.template}`;
  if (scene.effect === "layer_scene") return `layer:${scene.layout}`;
  return scene.effect;
}

const hexLuma = (hex) => {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex ?? "").trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
};

const textOf = (text) =>
  Object.values(text ?? {}).some((v) => {
    const s = v && typeof v === "object" ? v.value : v;
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
  const scenes = template.scenes ?? [];
  const layouts = new Map((library?.layouts ?? []).map((l) => [l.id, l]));
  const canvas = library?.meta?.canvas ?? { width: 1920, height: 1080 };
  const canvasArea = canvas.width * canvas.height;
  const layoutOfScene = (scene) =>
    scene.effect === "layer_scene" ? layouts.get(scene.layout) : null;

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

  // -- photo_coverage (via the library's geometry, once per layout used) ---------
  const seenLayouts = new Set();
  for (const scene of scenes) {
    const layout = layoutOfScene(scene);
    if (!layout || seenLayouts.has(layout.id)) continue;
    seenLayouts.add(layout.id);
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
    const fallbackLayout = fallback?.layout ? layouts.get(fallback.layout) : null;
    if (!fallback || !fallbackLayout) {
      errors.push(finding("balanced_text", scene.id,
        `body scene on textRequired layout ${layout.id} needs a muteFallback layout for wordless recurrences`));
    } else {
      if (fallbackLayout.textRequired) {
        errors.push(finding("balanced_text", scene.id,
          `muteFallback ${fallbackLayout.id} is itself textRequired — a wordless repeat would still be half-empty`));
      }
      const fallbackDemand = photoDemand({ ...scene, ...fallback }, library);
      if (fallbackDemand !== demand) {
        errors.push(finding("balanced_text", scene.id,
          `muteFallback ${fallback.layout} costs ${fallbackDemand} photo(s) but the scene costs ${demand} — the solver only adopts an equal-cost stand-in`));
      }
    }
    for (const [i, variant] of (scene.repeatable?.variants ?? []).entries()) {
      const vLayout = layouts.get(variant.layout ?? scene.layout);
      const vText = variant.text !== undefined ? variant.text : scene.text;
      if (vLayout?.textRequired && !textOf(vText)) {
        errors.push(finding("balanced_text", scene.id,
          `repeat variant ${i + 1} blanks the copy on textRequired layout ${vLayout.id}; keep words or switch the variant's layout`));
      }
    }
  });

  // -- signature_hybrid ----------------------------------------------------------
  const hybrids = scenes.filter((s) => s.renderer && s.template);
  if (!hybrids.length) {
    errors.push(finding("signature_hybrid", null,
      "no Remotion/Blender signature scene; the recipe never spends the engine's richest effects"));
  }
  for (const scene of hybrids) {
    const known = HYBRID_RENDERER[scene.template];
    if (!known) {
      errors.push(finding("signature_hybrid", scene.id, `unknown hybrid template ${scene.template}`));
    } else if (known !== scene.renderer) {
      errors.push(finding("signature_hybrid", scene.id,
        `template ${scene.template} is rendered by ${known}, not ${scene.renderer}`));
    } else if (!HYBRID_SIGNATURE_TEMPLATES.has(scene.template) && scene.template !== "gl_transition") {
      errors.push(finding("signature_hybrid", scene.id,
        `${scene.template} needs more photos than the recipe path can hand a hybrid scene (only assets=1 templates, or gl_transition's pair, resolve correctly here)`));
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

  return {
    errors, warnings,
    verdict: errors.length ? "error" : warnings.length ? "warning" : "pass",
  };
}
