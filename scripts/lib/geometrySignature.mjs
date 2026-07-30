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
  if (!resolvedScene || typeof resolvedScene !== "object") {
    throw new TypeError("resolvedScene must be an object");
  }
  const layout = resolvedScene.resolvedLayout
    || (library?.layouts || []).find((candidate) => candidate.id === resolvedScene.layout);
  if (!layout) {
    throw new TypeError("resolvedScene must reference a known layout");
  }

  const resolveFrame = createTemplateTheme({ library, template, direction: undefined }).resolveFrame;
  const sceneSlot = (id) =>
    (resolvedScene.photoSlots || []).find((candidate) => candidate.slot === id) || {};
  const background = resolvedScene.durationRole === "closing"
    ? { type: "photo_full_bleed", slot: "__bookend" }
    : layout.background;
  const backgroundSlotId = background?.type === "photo_full_bleed"
    ? background.slot
    : null;

  const shapes = (layout.photoSlots || []).map((slot) => {
    if (slot.id === backgroundSlotId) return "rect";

    const definition = sceneSlot(slot.id);
    const frame = resolveFrame(definition.frame || resolvedScene.resolvedFrame || slot.frame);
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

    const occurrenceOf = (scene, source, variantIndex) => {
      const resolved = resolveScene(scene, { template, library });
      if (resolved.errors.length) {
        throw new Error(`${recipeId}/${scene.id}: ${resolved.errors.map((item) => item.detail).join("; ")}`);
      }
      if (resolved.scene?.effect !== "layer_scene" || !resolved.scene.resolvedLayout) return null;
      const suffix = source === "main"
        ? ""
        : source === "muteFallback"
          ? ".muteFallback"
          : `.repeatable.variants[${variantIndex}]`;
      return {
        key: geometryKey(resolved.scene.resolvedLayout, canvas),
        recipeId,
        sceneId: scene.id,
        source,
        ...(variantIndex == null ? {} : { variantIndex }),
        location: `${recipeId}/${scene.id}${suffix}`,
        look: resolved.scene.look ?? null,
        layout: resolved.scene.layout ?? null,
      };
    };

    for (const scene of template.scenes || []) {
      const main = occurrenceOf(scene, "main");
      if (main) {
        authoredOccurrences.push(main);
        reachableOccurrences.push(main);
        authoredForRecipe.push(main);
        reachableForRecipe.push(main);

        const resolved = resolveScene(scene, { template, library }).scene;
        const baseLayout = (library.layouts || []).find((layout) => layout.id === resolved.layout);
        if (baseLayout && meaningfullyDiffers(resolved, baseLayout, template, library, canvas)) {
          meaningfulScenes.push(scene.id);
        }
      }

      if (scene.muteFallback) {
        const fallback = { ...scene, ...scene.muteFallback };
        delete fallback.muteFallback;
        if (scene.muteFallback.look) delete fallback.layout;
        else if (scene.muteFallback.layout) delete fallback.look;
        const occurrence = occurrenceOf(fallback, "muteFallback");
        if (occurrence) {
          reachableOccurrences.push(occurrence);
          reachableForRecipe.push(occurrence);
        }
      }

      for (const [index, variant] of (scene.repeatable?.variants || []).entries()) {
        const repeated = { ...scene, ...variant, repeatable: undefined };
        if (variant.look) delete repeated.layout;
        else if (variant.layout) delete repeated.look;
        const occurrence = occurrenceOf(repeated, "repeatableVariant", index);
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
