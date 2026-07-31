// RECIPE LOOKS — the library owns safe geometry, the recipe owns visual identity.
//
// layouts/library.json holds PRIMITIVES: slots whose rendered bounds, including rotation,
// must stay inside the 1920x1080 canvas. A recipe may now name `looks`, each of which picks
// one of those primitives and dresses it — nudged slot geometry, a frame treatment, a photo
// treatment, a motion preset. A scene then names a look instead of a bare layout.
//
//   scene.look -> recipe.looks[look] -> shared layout -> recipe.defaults -> designTokens
//
// Why a resolver instead of letting each consumer merge for itself: `scene.layout` is
// read in six places (photoDemand, scenePhotoCount, templatePhotoRequests,
// recipeShotList, diversityPlanner, layerSceneBuilder), four of which run BEFORE the
// renderer, while the photo budget is being solved. Six independent merges is six
// chances to disagree. This module is the single one (see LOOKS-MIGRATION-PLAN.md).
//
// INVARIANTS
//   I1  A look may only modify slots the layout already has — never add, remove or
//       rename one. photoDemand() in engineCapabilities.mjs sizes the photo budget from
//       layout.photoSlots.length; keeping the count fixed is what lets that function
//       stay unaware that looks exist at all. Enforced by V2/V3 below.
//   I2  resolveScene is pure and idempotent: it derives everything from scene.look /
//       scene.layout and never reads its own output, so resolve(resolve(x)) == resolve(x).
//       recipeShotList swaps a scene's look mid-solve and re-resolves; that must be safe.
//   I3  Lint, shot list, renderer and metrics all call THIS module. No second merge.
//   I4  A scene with no look resolves to the library layout unchanged — recipes that
//       have not migrated render byte-for-byte as before.
import { hashSeed } from "./copyVariants.mjs";

/** Slot fields a look may override. `id` is absent on purpose (I1). */
const PHOTO_SLOT_OVERRIDABLE = new Set([
  "x", "y", "width", "height", "fit", "rotation", "suggestedAnimation", "frame", "role",
]);
const TEXT_SLOT_OVERRIDABLE = new Set([
  "x", "y", "width", "height", "align", "sizePx", "lineSpacing", "fontRole", "color", "role",
]);

/** Photo treatment keys the engine can apply per layer, via ImageSceneLayer.grade.
 *  Vignette is deliberately absent: it only exists as a whole-frame grade, and on a
 *  520x760 collage tile it reads as a dark ring inside the frame, not as atmosphere. */
const TREATMENT_KEYS = new Set(["saturation", "contrast", "brightness"]);

const clone = (value) => (value == null ? value : JSON.parse(JSON.stringify(value)));

const finding = (check, id, detail, severity = "error") => ({ check, id, detail, severity });

const layoutOf = (library, id) => (library?.layouts || []).find((l) => l.id === id);

/** Bounding box emitted by FFmpeg's rotate filter and overlaid at the slot's raw x/y. */
export function rotatedSlotBounds(slot) {
  const radians = ((slot.rotation ?? 0) * Math.PI) / 180;
  const cosine = Math.abs(Math.cos(radians));
  const sine = Math.abs(Math.sin(radians));
  const width = cosine * slot.width + sine * slot.height;
  const height = sine * slot.width + cosine * slot.height;
  return {
    x: slot.x,
    y: slot.y,
    width,
    height,
    right: slot.x + width,
    bottom: slot.y + height,
  };
}

function mergeSlots(baseSlots, overrides, allowed) {
  return (baseSlots || []).map((slot) => {
    const patch = overrides?.[slot.id];
    if (!patch) return clone(slot);
    const out = clone(slot);
    for (const [key, value] of Object.entries(patch)) {
      if (allowed.has(key)) out[key] = value;
    }
    return out;
  });
}

/** The geometry a viewer actually registers — what two scenes must differ in to look
 *  like two different pictures. Frame/treatment/motion ride along because a gold-matted
 *  triptych and a bare one are not the same frame. */
function geometryOf(layout, extras) {
  return JSON.stringify([
    (layout?.photoSlots || []).map((s) => [s.id, s.x, s.y, s.width, s.height, s.fit ?? null, s.rotation ?? null]),
    (layout?.textSlots || []).map((s) => [s.id, s.x, s.y, s.width, s.height, s.align ?? null, s.sizePx ?? null]),
    layout?.background ?? null,
    (layout?.panels || []).map((p) => [p.x, p.y, p.width, p.height, p.color ?? null, p.opacity ?? null, p.z ?? null]),
    extras?.frame ?? null,
    extras?.treatment ?? null,
    extras?.motion ?? null,
  ]);
}

/**
 * Resolve one scene's look into concrete geometry. Pure; returns a new object (I2).
 * A scene with no look, or a non-layer_scene, passes through with only `resolvedLayout`
 * attached (a clone of the library layout) so downstream code has one path (I3, I4).
 *
 * @returns {{scene: object, errors: object[]}}
 */
export function resolveScene(scene, { template, library }) {
  const errors = [];
  if (!scene || typeof scene !== "object") return { scene, errors };

  const lookId = scene.look;
  const look = lookId ? template?.looks?.[lookId] : undefined;

  if (lookId && scene.effect !== "layer_scene") {
    errors.push(finding("look_reachable", scene.id,
      `scene names look '${lookId}' but its effect is ${scene.effect ?? "unset"}; looks dress layer_scene geometry only`));
    return { scene, errors };
  }
  if (lookId && !look) {
    errors.push(finding("look_reachable", scene.id, `unknown look '${lookId}'`));
    return { scene, errors };
  }
  if (scene.effect !== "layer_scene") return { scene, errors };

  const layoutId = look?.layout ?? scene.layout;
  if (look && scene.layout && scene.layout !== look.layout) {
    errors.push(finding("look_reachable", scene.id,
      `scene sets layout '${scene.layout}' and look '${lookId}' whose layout is '${look.layout}' — drop one`));
    return { scene, errors };
  }

  const base = layoutOf(library, layoutId);
  if (!base) {
    // layerSceneBuilder throws on this too; resolving first means the lint catches it
    // in CI instead of a customer render catching it at scene 14.
    errors.push(finding("look_reachable", scene.id, `unknown layout '${layoutId}'`));
    return { scene, errors };
  }

  // Slot arrays are rebuilt only where the layout HAS them: a layout with no textSlots
  // key must not gain an empty one, or an un-migrated recipe stops resolving to exactly
  // what it rendered before (I4) and the no-op proof in test/look-resolver.test.mjs goes soft.
  const overrides = look?.layoutOverrides;
  const resolvedLayout = {
    ...clone(base),
    ...(base.photoSlots ? { photoSlots: mergeSlots(base.photoSlots, overrides?.photoSlots, PHOTO_SLOT_OVERRIDABLE) } : {}),
    ...(base.textSlots ? { textSlots: mergeSlots(base.textSlots, overrides?.textSlots, TEXT_SLOT_OVERRIDABLE) } : {}),
    ...(overrides?.background ? { background: clone(overrides.background) } : {}),
  };

  const treatment = look?.photoTreatment
    ? Object.fromEntries(Object.entries(look.photoTreatment).filter(([k]) => TREATMENT_KEYS.has(k)))
    : undefined;
  const extras = {
    frame: look?.frame ? clone(look.frame) : undefined,
    treatment: treatment && Object.keys(treatment).length ? treatment : undefined,
    motion: look?.motion ? clone(look.motion) : undefined,
  };

  // A look whose resolved picture is indistinguishable from the bare library layout gets
  // the bare signature, so it cannot inflate a diversity count by existing (V7 reports it).
  const dressed = geometryOf(resolvedLayout, extras) !== geometryOf(base, {});
  const signature = dressed
    ? `layer:${layoutId}#${hashSeed(geometryOf(resolvedLayout, extras)).toString(16).padStart(8, "0")}`
    : `layer:${layoutId}`;

  // Strip what a PREVIOUS resolution left behind before adding this one's. The solver
  // hands back a scene that already carries resolved fields and asks for it to be resolved
  // again under a new look; merging onto the old output would leave the new composition
  // wearing the old one's frame and grade — which is precisely what a wordless repeat did:
  // it adopted the matted quiet look and kept the arch frame of the beat it replaced.
  const { resolvedFrame, resolvedTreatment, resolvedMotion, ...carried } = scene;
  return {
    scene: {
      ...carried,
      layout: layoutId,
      resolvedLayout,
      ...(extras.frame ? { resolvedFrame: extras.frame } : {}),
      ...(extras.treatment ? { resolvedTreatment: extras.treatment } : {}),
      ...(extras.motion ? { resolvedMotion: extras.motion } : {}),
      resolvedSignature: signature,
    },
    errors,
  };
}

/**
 * Resolve every scene of a recipe, and validate the look definitions themselves.
 * @returns {{scenes: object[], errors: object[], warnings: object[]}}
 */
export function resolveTemplate(template, { library }) {
  const errors = [];
  const warnings = [];
  const scenes = [];

  for (const [lookId, look] of Object.entries(template?.looks || {})) {
    for (const item of validateLook(lookId, look, { template, library })) {
      (item.severity === "warning" ? warnings : errors).push(item);
    }
  }

  for (const scene of template?.scenes || []) {
    const resolved = resolveScene(scene, { template, library });
    for (const item of resolved.errors) {
      (item.severity === "warning" ? warnings : errors).push(item);
    }
    scenes.push(resolved.scene);
  }

  // V6 / V7 need the whole recipe in view.
  const declared = Object.keys(template?.looks || {});
  if (declared.length) {
    const used = new Set();
    const collect = (scene) => {
      if (scene?.look) used.add(scene.look);
      if (scene?.muteFallback?.look) used.add(scene.muteFallback.look);
      for (const variant of scene?.repeatable?.variants || []) if (variant.look) used.add(variant.look);
    };
    for (const scene of template.scenes || []) collect(scene);
    for (const lookId of declared) {
      if (!used.has(lookId)) {
        warnings.push(finding("look_overrides", lookId, "look is declared but no scene uses it", "warning"));
      }
    }

    const bySignature = new Map();
    for (const lookId of declared) {
      const probe = resolveScene(
        { id: `__look_${lookId}`, effect: "layer_scene", look: lookId },
        { template, library },
      );
      const signature = probe.scene?.resolvedSignature;
      if (!signature) continue;
      if (bySignature.has(signature)) {
        warnings.push(finding("look_overrides", lookId,
          `renders identically to look '${bySignature.get(signature)}' — use one look, or make them actually differ`, "warning"));
      } else {
        bySignature.set(signature, lookId);
      }
    }
  }

  return { scenes, errors, warnings };
}

/**
 * Validate one look definition. Returns findings; never throws.
 *   V1 unknown_layout     look.layout is not in the library
 *   V2 unknown_slot       an override names a slot the layout does not have (I1)
 *   V3 slot_count_drift   the resolved layout gained or lost a photo slot (I1)
 *   V4 out_of_canvas      an overridden slot leaves the canvas or the safe margin
 *   V5 text_occlusion     an overridden photo slot buries a text slot
 *   V6 unused_look        declared, never used                       (resolveTemplate)
 *   V7 look_is_noise      two looks resolve to the same picture       (resolveTemplate)
 */
export function validateLook(lookId, look, { template, library }) {
  const out = [];
  const canvas = library?.meta?.canvas || { width: 1920, height: 1080 };
  const safe = library?.meta?.safeMargin ?? 70;

  if (!look?.layout) {
    out.push(finding("look_overrides", lookId, "look has no layout"));
    return out;
  }
  const base = layoutOf(library, look.layout);
  if (!base) {
    out.push(finding("look_overrides", lookId, `unknown layout '${look.layout}'`)); // V1
    return out;
  }

  const overrides = look.layoutOverrides || {};
  const photoIds = new Set((base.photoSlots || []).map((s) => s.id));
  const textIds = new Set((base.textSlots || []).map((s) => s.id));
  for (const id of Object.keys(overrides.photoSlots || {})) {
    if (!photoIds.has(id)) {
      out.push(finding("look_overrides", lookId,
        `overrides photo slot '${id}', which layout ${look.layout} does not have (a look may dress slots, not invent them)`)); // V2
    }
  }
  for (const id of Object.keys(overrides.textSlots || {})) {
    if (!textIds.has(id)) {
      out.push(finding("look_overrides", lookId,
        `overrides text slot '${id}', which layout ${look.layout} does not have`)); // V2
    }
  }
  for (const [id, patch] of Object.entries(overrides.photoSlots || {})) {
    for (const key of Object.keys(patch || {})) {
      if (!PHOTO_SLOT_OVERRIDABLE.has(key)) {
        out.push(finding("look_overrides", lookId,
          `photo slot '${id}' overrides '${key}', which is not overridable${key === "id" ? " (renaming a slot breaks the photo budget)" : ""}`));
      }
    }
  }

  // Resolve against a template built from THIS look alone: a look is validatable on its
  // own, whether or not the recipe that owns it has been wired up yet.
  const { scene: probe } = resolveScene(
    { id: `__look_${lookId}`, effect: "layer_scene", look: lookId },
    { template: { ...template, looks: { ...(template?.looks || {}), [lookId]: look } }, library },
  );
  const resolved = probe?.resolvedLayout;
  if (!resolved) return out;

  if ((resolved.photoSlots || []).length !== (base.photoSlots || []).length) {
    out.push(finding("look_overrides", lookId,
      `resolves to ${(resolved.photoSlots || []).length} photo slot(s) but layout ${look.layout} has ${(base.photoSlots || []).length} — the photo budget is sized from the layout`)); // V3
  }

  // V4, photos: match preflightTimeline's hard canvas boundary. Allowing even a small
  // bleed here only defers the same failure until the resolved scene reaches preflight.
  const bgSlot = resolved.background?.type === "photo_full_bleed" ? resolved.background.slot : null;
  for (const slot of resolved.photoSlots || []) {
    if (!overrides.photoSlots?.[slot.id]) continue;
    const bounds = rotatedSlotBounds(slot);
    if (bounds.x < 0 || bounds.y < 0
      || bounds.right > canvas.width || bounds.bottom > canvas.height) {
      out.push(finding("look_overrides", lookId,
        `photo slot '${slot.id}' resolves to ${slot.x},${slot.y} ${slot.width}x${slot.height} ` +
        `and renders as ${bounds.width.toFixed(1)}x${bounds.height.toFixed(1)} after ${slot.rotation ?? 0}° rotation, ` +
        `outside the ${canvas.width}x${canvas.height} canvas`)); // V4
    }
  }
  // Text has no such licence: a heading cropped by the frame edge is never intended.
  for (const slot of resolved.textSlots || []) {
    if (!overrides.textSlots?.[slot.id]) continue;
    if (slot.x < safe || slot.y < safe
      || slot.x + slot.width > canvas.width - safe || slot.y + slot.height > canvas.height - safe) {
      out.push(finding("look_overrides", lookId,
        `text slot '${slot.id}' resolves to ${slot.x},${slot.y} ${slot.width}x${slot.height}, outside the ${safe}px safe margin`)); // V4
    }
  }

  // V5: a nudged photo slot that buries the words. Only meaningful when the layout is
  // not a full-bleed background composition, where photos are supposed to sit under text.
  if (!bgSlot) {
    for (const text of resolved.textSlots || []) {
      const area = Math.max(1, text.width * text.height);
      for (const photo of resolved.photoSlots || []) {
        if (!overrides.photoSlots?.[photo.id]) continue;
        const w = Math.max(0, Math.min(text.x + text.width, photo.x + photo.width) - Math.max(text.x, photo.x));
        const h = Math.max(0, Math.min(text.y + text.height, photo.y + photo.height) - Math.max(text.y, photo.y));
        const covered = (w * h) / area;
        if (covered > 0.2) {
          out.push(finding("look_overrides", lookId,
            `photo slot '${photo.id}' covers ${(covered * 100).toFixed(0)}% of text slot '${text.id}'`)); // V5
        }
      }
    }
  }

  return out;
}

/**
 * Turn a look's photoTreatment into an image layer's `grade` (src/types.ts LayerGrade).
 *
 * It is NOT folded into the layer's technicalColor. That field is the album normalizer's
 * output — the correction that makes one couple's photographs agree with each other — and
 * the timeline schema bounds it hard (saturation 0.9..1.1) precisely so an automatic
 * correction can never do anything dramatic. A look asking for a near-monochrome title
 * plate is dramatic on purpose. Two authorities, two fields; the engine applies the
 * correction first and the mood on its result.
 */
export function gradeOf(treatment) {
  if (!treatment) return undefined;
  const round = (n) => Math.round(n * 1000) / 1000;
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const grade = {};
  if (treatment.saturation != null) grade.saturation = round(clamp(treatment.saturation, 0, 2));
  if (treatment.contrast != null) grade.contrast = round(clamp(treatment.contrast, 0.5, 2));
  if (treatment.brightness != null) grade.brightness = round(clamp(treatment.brightness, -0.3, 0.3));
  return Object.keys(grade).length ? grade : undefined;
}

/** The fingerprint a viewer registers. Resolved scenes carry it; unresolved ones fall
 *  back to the pre-looks definition, so this is a drop-in for templateRules.lookOf(). */
export function visualSignature(scene) {
  if (scene?.resolvedSignature) return scene.resolvedSignature;
  if (scene?.renderer && scene?.template) return `${scene.renderer}:${scene.template}`;
  if (scene?.effect === "layer_scene") return `layer:${scene.layout}`;
  return scene?.effect;
}
