import { createTemplateTheme } from "./templateTheme.mjs";
import { resolveScene } from "./lookResolver.mjs";

/**
 * Geometry Signature V2.
 *
 * This metric intentionally ignores slot ids, frames, treatments, colors and
 * text content. It measures composition, not styling.
 */

const AXIS_BUCKETS = 100;

/**
 * @param {unknown} value
 * @param {string} label
 */
function positiveNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number`);
  }
  return value;
}

/**
 * @param {object} record
 * @param {string} field
 * @param {number} [fallback]
 */
function numberField(record, field, fallback) {
  const value = record?.[field] ?? fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${field} must be a finite number`);
  }
  return value;
}

/** @param {number} value @param {number} step */
const quantize = (value, step) => Math.round(value / step);

/** @param {number} left @param {number} right */
const equalMeasure = (left, right) =>
  Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));

/** @param {number} delta @param {number} threshold */
const reachesThreshold = (delta, threshold) =>
  delta > threshold || equalMeasure(delta, threshold);

/**
 * Key V2: quantized photo slots, text slots, panels and background geometry.
 *
 * Horizontal fields use 1% of canvas width, vertical fields use 1% of canvas
 * height, and photo rotation uses one-degree buckets. Array order is retained
 * because later photo slots and panels can paint over earlier ones.
 *
 * @param {object} resolvedLayout
 * @param {{width: number, height: number}} canvas
 * @returns {string}
 */
export function geometryKey(resolvedLayout, canvas) {
  if (!resolvedLayout || typeof resolvedLayout !== "object") {
    throw new TypeError("resolvedLayout must be an object");
  }
  const width = positiveNumber(canvas?.width, "canvas.width");
  const height = positiveNumber(canvas?.height, "canvas.height");
  const xStep = width / AXIS_BUCKETS;
  const yStep = height / AXIS_BUCKETS;

  const box = (slot) => [
    quantize(numberField(slot, "x"), xStep),
    quantize(numberField(slot, "y"), yStep),
    quantize(numberField(slot, "width"), xStep),
    quantize(numberField(slot, "height"), yStep),
  ];

  const photo = (resolvedLayout.photoSlots || []).map((slot) => [
    ...box(slot),
    quantize(numberField(slot, "rotation", 0), 1),
  ]);
  const text = (resolvedLayout.textSlots || []).map(box);
  const panels = (resolvedLayout.panels || []).map((panel) => [
    panel.type ?? "rect",
    ...box(panel),
    panel.z === "over_photos" ? "over_photos" : "under_photos",
  ]);
  const background = [
    resolvedLayout.background?.type ?? null,
    resolvedLayout.background?.slot ?? null,
  ];

  return JSON.stringify({ photo, text, panels, background });
}

/**
 * The layout a scene actually renders, preferring its resolved form.
 * @param {object} resolvedScene
 * @param {object} library
 */
function layoutOfScene(resolvedScene, library) {
  if (!resolvedScene || typeof resolvedScene !== "object") {
    throw new TypeError("resolvedScene must be an object");
  }
  const layout = resolvedScene.resolvedLayout
    || (library?.layouts || []).find((candidate) => candidate.id === resolvedScene.layout);
  if (!layout) {
    throw new TypeError("resolvedScene must reference a known layout");
  }
  return layout;
}

/**
 * The slot layerSceneBuilder paints as a full-bleed backdrop, which it renders without a
 * frame. Shared so the silhouette and perceptual keys cannot disagree about which slot
 * that is.
 * @param {object} resolvedScene
 * @param {object} layout
 */
function backgroundSlotIdOf(resolvedScene, layout) {
  const background = resolvedScene.durationRole === "closing"
    ? { type: "photo_full_bleed", slot: "__bookend" }
    : layout.background;
  return background?.type === "photo_full_bleed" ? background.slot : null;
}

/**
 * Resolve one photo slot's effective frame, using the renderer's precedence: a scene slot
 * wins over the look, which wins over the layout slot; recipe presets win over library ones.
 * @param {object} resolvedScene
 * @param {object} template
 * @param {object} library
 */
function frameResolverFor(resolvedScene, template, library) {
  const resolveFrame = createTemplateTheme({ library, template, direction: undefined }).resolveFrame;
  return (slot) => {
    const definition = (resolvedScene.photoSlots || [])
      .find((candidate) => candidate.slot === slot.id) || {};
    return resolveFrame(definition.frame || resolvedScene.resolvedFrame || slot.frame);
  };
}

/**
 * Classify the rendered silhouette of each photo slot.
 *
 * Frame precedence and named-preset resolution intentionally share the renderer's
 * rules: a scene slot wins over the look, which wins over the layout slot; recipe
 * presets win over library presets. Background-photo slots are always rectangular
 * because layerSceneBuilder renders them without a frame.
 *
 * @param {object} resolvedScene
 * @param {object} template
 * @param {object} library
 * @returns {string}
 */
export function slotShapeKey(resolvedScene, template, library) {
  const layout = layoutOfScene(resolvedScene, library);
  const frameOf = frameResolverFor(resolvedScene, template, library);
  const backgroundSlotId = backgroundSlotIdOf(resolvedScene, layout);

  const shapes = (layout.photoSlots || []).map((slot) => {
    if (slot.id === backgroundSlotId) return "rect";

    const frame = frameOf(slot);
    const radius = frame?.radius;
    if (typeof radius !== "number" || !Number.isFinite(radius) || radius <= 0) return "rect";

    const width = positiveNumber(slot.width, `photo slot '${slot.id ?? "unknown"}' width`);
    const height = positiveNumber(slot.height, `photo slot '${slot.id ?? "unknown"}' height`);
    if (!equalMeasure(radius, Math.min(width, height) / 2)) return "rect";
    return equalMeasure(width, height) ? "circle" : "pill";
  });

  return JSON.stringify(shapes);
}

/**
 * Where the photographs sit on the canvas, and nothing else.
 *
 * The narrowest of the three keys in this file, and the one that answers what a viewer
 * actually asks of a slide: are the pictures in the same places? geometryKey() folds in
 * text, panels and background, so two scenes with an identical photo arrangement but
 * different copy score as different compositions (124 geometry keys over 103 real
 * arrangements). perceptualSignature() folds in frame, type scale and grade, none of which
 * move a photograph — which is how 64% of photo-bearing scenes came to share an arrangement
 * with another recipe while every guard in the repo read green.
 *
 * The full-bleed background slot is excluded on purpose. It fills the canvas by definition,
 * so every recipe on `full_bleed_quote` "shares" it and no override can ever change that;
 * counting it would report debt that cannot be paid.
 *
 * Scenes with no photographs (`closing_names`) return `"[]"`. That is not an arrangement,
 * and callers measuring sharing must skip it rather than treat every closing card as one.
 *
 * @param {object} resolvedScene a scene already through resolveScene()
 * @param {object} library
 * @param {{width: number, height: number}} canvas
 * @returns {string}
 */
export function photoArrangementKey(resolvedScene, library, canvas) {
  const layout = layoutOfScene(resolvedScene, library);
  const width = positiveNumber(canvas?.width, "canvas.width");
  const height = positiveNumber(canvas?.height, "canvas.height");
  const xStep = width / AXIS_BUCKETS;
  const yStep = height / AXIS_BUCKETS;
  const backgroundSlotId = backgroundSlotIdOf(resolvedScene, layout);

  return JSON.stringify(
    (layout.photoSlots || [])
      .filter((slot) => slot.id !== backgroundSlotId)
      .map((slot) => [
        quantize(numberField(slot, "x"), xStep),
        quantize(numberField(slot, "y"), yStep),
        quantize(numberField(slot, "width"), xStep),
        quantize(numberField(slot, "height"), yStep),
        quantize(numberField(slot, "rotation", 0), 1),
      ]),
  );
}

/**
 * Perceptual bands. Deliberately coarse: each boundary is a step a viewer can name.
 * @type {[number, string][]}
 */
const BORDER_BANDS = [
  [0, "none"],      // no border drawn at all
  [4, "hairline"],  // a drawn line, not a mat
  [12, "thin"],
  [24, "mat"],      // reads as a mount around the photograph
];
const BORDER_BAND_ABOVE = "heavy";
/**
 * Corner radius as a fraction of the largest radius the slot can take.
 * @type {[number, string][]}
 */
const RADIUS_BANDS = [
  [0, "square"],
  [0.12, "soft"],
  [0.5, "rounded"],
  [0.95, "wide"],
];

/** @param {string} hex */
function borderLuma(hex) {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return 0.2126 * ((value >> 16) & 255)
    + 0.7152 * ((value >> 8) & 255)
    + 0.0722 * (value & 255);
}

/** @param {[number, string][]} bands @param {number} value @param {string} above */
function bandOf(bands, value, above) {
  for (const [ceiling, name] of bands) {
    if (value <= ceiling) return name;
  }
  return above;
}

/**
 * Describe one slot's frame the way a viewer registers it, not the way it is written.
 * Two frames land in the same bucket when nobody could tell them apart at a glance:
 * a 16px and a 24px corner radius on a borderless tile are both "a slightly soft
 * rectangle". Border colour only survives when there is a border to colour.
 *
 * @param {object} frame
 * @param {object} slot
 */
function frameBand(frame, slot) {
  if (!frame) return "bare";
  const border = Number.isFinite(frame.border) ? frame.border : 0;
  const weight = bandOf(BORDER_BANDS, border, BORDER_BAND_ABOVE);

  let tone = "none";
  if (border > 0) {
    const luma = borderLuma(frame.borderColor);
    tone = luma == null ? "unknown" : luma < 85 ? "dark" : luma <= 170 ? "mid" : "light";
  }

  const radius = Number.isFinite(frame.radius) ? frame.radius : 0;
  const largest = Math.min(slot.width, slot.height) / 2;
  let shape = "square";
  if (radius > 0 && largest > 0) {
    const ratio = radius / largest;
    shape = bandOf(RADIUS_BANDS, ratio, slot.width === slot.height ? "circle" : "pill");
  }

  return [weight, tone, shape, frame.shadow ? "shadow" : "flat"].join(":");
}

/**
 * Type scale is perceived logarithmically, so bands are ratios rather than pixel counts:
 * 8% steps sit near the just-noticeable difference for a heading taken in at a glance.
 *
 * geometryKey() covers where the text sits, never how big it is set — it measures
 * composition on purpose. Without this, the twenty-five closing cards, whose names run
 * from 112px to 160px, all collapsed into one picture and `closing_names` looked like the
 * corpus's worst duplicate when it is in fact differentiated on the one axis that layout
 * has. Alignment and font role ride along: left-ranged and centred names, or a script and
 * a sans, are not the same card.
 */
const TYPE_STEP = 1.08;

/** @param {object} layout */
function typeBands(layout) {
  return (layout.textSlots || []).map((slot) => {
    const size = Number.isFinite(slot.sizePx) ? slot.sizePx : 0;
    const band = size > 0 ? Math.round(Math.log(size) / Math.log(TYPE_STEP)) : 0;
    return [band, slot.align ?? null, slot.fontRole ?? null].join(":");
  });
}

/**
 * Quantise a look's grade. A 2% saturation change is not a different picture.
 * @param {object} treatment
 */
function gradeBand(treatment) {
  if (!treatment) return "neutral";
  const step = (value, fallback, size) =>
    (value == null ? fallback : Math.round(value / size) * size).toFixed(2);
  return [
    step(treatment.saturation, 1, 0.15),
    step(treatment.contrast, 1, 0.15),
    step(treatment.brightness, 0, 0.1),
  ].join("/");
}

/**
 * The fingerprint of what a viewer actually sees: composition, plus the dressing that
 * survives being looked at from across a room.
 *
 * This exists because `visualSignature()` in lookResolver.mjs hashes the frame by its
 * exact definition, so giving every recipe its own `layoutPresets` entry made all 300
 * recipe pairs score 0% overlap — the cross-recipe guard could no longer fail, while
 * thirteen recipes still drew the same three-photo row. That is the regression this
 * measures. Bytes differing is not a picture differing.
 *
 * Do NOT swap this in for `visualSignature()`: that one drives the solver's runtime
 * diversity choices (diversityPlanner) and the lint's repeat detection, where an exact
 * fingerprint is the correct tool. This one is for comparing finished products.
 *
 * @param {object} resolvedScene a scene already through resolveScene()
 * @param {object} template
 * @param {object} library
 * @param {{width: number, height: number}} canvas
 * @returns {string}
 */
export function perceptualSignature(resolvedScene, template, library, canvas) {
  const layout = layoutOfScene(resolvedScene, library);
  const frameOf = frameResolverFor(resolvedScene, template, library);
  const backgroundSlotId = backgroundSlotIdOf(resolvedScene, layout);

  const frames = (layout.photoSlots || []).map((slot) => (
    slot.id === backgroundSlotId ? "bare" : frameBand(frameOf(slot), slot)
  ));

  return JSON.stringify([
    geometryKey(layout, canvas),
    frames,
    typeBands(layout),
    gradeBand(resolvedScene.resolvedTreatment),
  ]);
}

/**
 * Whether a look changes photo composition enough to count as custom geometry.
 *
 * Text, panels and background are intentionally excluded from this adoption
 * gate. Position and size use axis-specific 1% canvas thresholds, rotation uses
 * one degree, and silhouette changes are delegated to slotShapeKey().
 *
 * @param {object} resolvedScene
 * @param {object} baseLayout
 * @param {object} template
 * @param {object} library
 * @param {{width: number, height: number}} canvas
 * @returns {boolean}
 */
export function meaningfullyDiffers(resolvedScene, baseLayout, template, library, canvas) {
  if (!resolvedScene || typeof resolvedScene !== "object") {
    throw new TypeError("resolvedScene must be an object");
  }
  if (!baseLayout || typeof baseLayout !== "object") {
    throw new TypeError("baseLayout must be an object");
  }
  const resolvedLayout = resolvedScene.resolvedLayout
    || (library?.layouts || []).find((candidate) => candidate.id === resolvedScene.layout);
  if (!resolvedLayout) {
    throw new TypeError("resolvedScene must reference a known layout");
  }

  const xThreshold = positiveNumber(canvas?.width, "canvas.width") / AXIS_BUCKETS;
  const yThreshold = positiveNumber(canvas?.height, "canvas.height") / AXIS_BUCKETS;
  const resolvedSlots = resolvedLayout.photoSlots || [];
  const baseSlots = baseLayout.photoSlots || [];
  if (resolvedSlots.length !== baseSlots.length) return true;

  // Slots pair by index, not by id. mergeSlots() rebuilds the array from the base layout in
  // order and V3 rejects any look that changes the slot count, so index i is the same slot on
  // both sides. A future primitive that reorders slots would make this compare the wrong pair.
  for (let index = 0; index < resolvedSlots.length; index++) {
    const resolved = resolvedSlots[index];
    const base = baseSlots[index];
    if (
      reachesThreshold(Math.abs(numberField(resolved, "x") - numberField(base, "x")), xThreshold)
      || reachesThreshold(Math.abs(numberField(resolved, "width") - numberField(base, "width")), xThreshold)
      || reachesThreshold(Math.abs(numberField(resolved, "y") - numberField(base, "y")), yThreshold)
      || reachesThreshold(Math.abs(numberField(resolved, "height") - numberField(base, "height")), yThreshold)
      || reachesThreshold(Math.abs(
        numberField(resolved, "rotation", 0) - numberField(base, "rotation", 0),
      ), 1)
    ) {
      return true;
    }
  }

  const baseScene = { ...resolvedScene, resolvedLayout: baseLayout, resolvedFrame: undefined };
  return slotShapeKey(resolvedScene, template, library) !== slotShapeKey(baseScene, template, library);
}

/** @param {object[]} occurrences */
function summarizeOccurrences(occurrences) {
  const byKey = new Map();
  for (const occurrence of occurrences) {
    let group = byKey.get(occurrence.key);
    if (!group) {
      group = { key: occurrence.key, recipes: new Set(), occurrences: [] };
      byKey.set(occurrence.key, group);
    }
    if (occurrence.recipeId) group.recipes.add(occurrence.recipeId);
    group.occurrences.push(occurrence);
  }

  const groups = [...byKey.values()]
    .map((group) => ({
      key: group.key,
      share: group.recipes.size,
      recipes: [...group.recipes].sort(),
      occurrences: group.occurrences,
    }))
    .sort((left, right) => right.share - left.share || left.key.localeCompare(right.key));

  return {
    distinct: groups.length,
    shared: groups.filter((group) => group.share >= 2).length,
    maxShare: groups.reduce((maximum, group) => Math.max(maximum, group.share), 0),
    over12Count: groups.filter((group) => group.share > 12).length,
    occurrences: occurrences.length,
    groups,
  };
}

/**
 * Measure geometry vocabulary and sharing across the library and recipe paths.
 *
 * `authored` contains main scenes only. `reachable` also contains every explicit
 * mute fallback and repeatable variant after merging it with its parent scene,
 * exactly as the runtime does. Recipe sharing is de-duplicated per geometry key;
 * occurrence lists deliberately retain every path.
 *
 * @param {object[]} recipes
 * @param {object} library
 * @returns {object}
 */
export function geometryStats(recipes, library) {
  if (!Array.isArray(recipes)) throw new TypeError("recipes must be an array");
  if (!library || typeof library !== "object") throw new TypeError("library must be an object");
  const canvas = library.meta?.canvas;
  positiveNumber(canvas?.width, "library.meta.canvas.width");
  positiveNumber(canvas?.height, "library.meta.canvas.height");

  const libraryOccurrences = (library.layouts || []).map((layout) => ({
    key: geometryKey(layout, canvas),
    recipeId: null,
    sceneId: layout.id,
    source: "library",
    location: `library:${layout.id}`,
    look: null,
    layout: layout.id,
  }));
  const authoredOccurrences = [];
  const reachableOccurrences = [];
  const perRecipe = {};

  for (const template of recipes) {
    const recipeId = template.id;
    const authoredForRecipe = [];
    const reachableForRecipe = [];
    const meaningfulScenes = [];

    const resolveOrThrow = (scene) => {
      const resolved = resolveScene(scene, { template, library });
      if (resolved.errors.length) {
        throw new Error(`${recipeId}/${scene.id}: ${resolved.errors.map((item) => item.detail).join("; ")}`);
      }
      return resolved.scene;
    };

    // Takes the already-resolved scene rather than resolving again: the meaningful-geometry
    // gate below needs the same object, and resolveScene() is the expensive call here.
    const occurrenceOf = (scene, resolved, source, variantIndex) => {
      if (resolved?.effect !== "layer_scene" || !resolved.resolvedLayout) return null;
      const suffix = source === "main"
        ? ""
        : source === "muteFallback"
          ? ".muteFallback"
          : `.repeatable.variants[${variantIndex}]`;
      return {
        key: geometryKey(resolved.resolvedLayout, canvas),
        recipeId,
        sceneId: scene.id,
        source,
        ...(variantIndex == null ? {} : { variantIndex }),
        location: `${recipeId}/${scene.id}${suffix}`,
        look: resolved.look ?? null,
        layout: resolved.layout ?? null,
      };
    };

    for (const scene of template.scenes || []) {
      const resolvedMain = resolveOrThrow(scene);
      const main = occurrenceOf(scene, resolvedMain, "main");
      if (main) {
        authoredOccurrences.push(main);
        reachableOccurrences.push(main);
        authoredForRecipe.push(main);
        reachableForRecipe.push(main);

        const baseLayout = (library.layouts || []).find((layout) => layout.id === resolvedMain.layout);
        if (baseLayout && meaningfullyDiffers(resolvedMain, baseLayout, template, library, canvas)) {
          meaningfulScenes.push(scene.id);
        }
      }

      if (scene.muteFallback) {
        const fallback = { ...scene, ...scene.muteFallback };
        delete fallback.muteFallback;
        if (scene.muteFallback.look) delete fallback.layout;
        else if (scene.muteFallback.layout) delete fallback.look;
        const occurrence = occurrenceOf(fallback, resolveOrThrow(fallback), "muteFallback");
        if (occurrence) {
          reachableOccurrences.push(occurrence);
          reachableForRecipe.push(occurrence);
        }
      }

      for (const [index, variant] of (scene.repeatable?.variants || []).entries()) {
        const repeated = { ...scene, ...variant, repeatable: undefined };
        if (variant.look) delete repeated.layout;
        else if (variant.layout) delete repeated.look;
        const occurrence = occurrenceOf(repeated, resolveOrThrow(repeated), "repeatableVariant", index);
        if (occurrence) {
          reachableOccurrences.push(occurrence);
          reachableForRecipe.push(occurrence);
        }
      }
    }

    perRecipe[recipeId] = {
      authored: summarizeOccurrences(authoredForRecipe),
      reachable: summarizeOccurrences(reachableForRecipe),
      meaningful: meaningfulScenes.length,
      meaningfulScenes,
    };
  }

  return {
    catalog: summarizeOccurrences([...libraryOccurrences, ...authoredOccurrences]),
    authored: summarizeOccurrences(authoredOccurrences),
    reachable: summarizeOccurrences(reachableOccurrences),
    perRecipe,
  };
}
