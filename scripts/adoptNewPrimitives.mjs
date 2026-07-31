import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { photoDemand } from "./lib/engineCapabilities.mjs";
import { geometryStats } from "./lib/geometrySignature.mjs";
import { resolveScene, resolveTemplate, visualSignature } from "./lib/lookResolver.mjs";
import { evaluateStoryTemplate } from "./lib/rules/templateRules.mjs";

const PRESERVABLE_LOOK_FIELDS = new Set(["frame", "photoTreatment", "motion"]);
const STRUCTURAL_LOOK_FIELDS = new Set(["intent", "layout", "layoutOverrides"]);
const FRAME_OWNING_PRIMITIVES = new Set([
  "circle_trio_stagger",
  "inset_card_hero",
  "overlap_stack_duo",
]);
// The only drift an adoption may sign off on. Everything else is either preserved or a bug.
const DECLARABLE_DRIFT = new Set(["orientation"]);
// A slot this close to square crops a portrait and a landscape photo about equally, so it
// is not evidence either way when comparing what a request asked for to what it landed on.
const SQUARE_TOLERANCE = 1.1;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function same(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function slotClass(slot) {
  if (slot.height > slot.width * SQUARE_TOLERANCE) return "portrait";
  if (slot.width > slot.height * SQUARE_TOLERANCE) return "landscape";
  return "square";
}

function usedLookIds(recipe) {
  const used = new Set();
  const collect = (source) => {
    if (source?.look) used.add(source.look);
  };
  for (const scene of recipe.scenes || []) {
    collect(scene);
    collect(scene.muteFallback);
    for (const variant of scene.repeatable?.variants || []) collect(variant);
  }
  return used;
}

function mergeAlternative(scene, alternative) {
  const merged = { ...scene, ...(alternative || {}) };
  delete merged.muteFallback;
  delete merged.repeatable;
  if (alternative?.look) delete merged.layout;
  else if (alternative?.layout) delete merged.look;
  return merged;
}

function executionPaths(scene) {
  const paths = [{ label: "main", scene: mergeAlternative(scene) }];
  if (scene?.muteFallback) {
    paths.push({
      label: "muteFallback",
      scene: mergeAlternative(scene, scene.muteFallback),
    });
  }
  for (const [index, variant] of (scene?.repeatable?.variants || []).entries()) {
    paths.push({
      label: `repeatable.variants[${index}]`,
      scene: mergeAlternative(scene, variant),
    });
  }
  return paths;
}

function textKeysOf(scene) {
  return scene?.text && typeof scene.text === "object" && !Array.isArray(scene.text)
    ? Object.keys(scene.text).sort()
    : [];
}

/**
 * Where one adoption stands against the recipe on disk.
 *
 * A batch rollout writes recipes in place, so every gate after the first batch reads a
 * catalogue that is part migrated and part not. Without this the whole-map check could
 * only ever run once — the second run would fail on the batch it had just written.
 */
export function adoptionStatus(recipe, adoption) {
  const scene = (recipe.scenes || []).find((candidate) => candidate.id === adoption.sceneId);
  if (!scene) return "missing";
  if (scene.look === adoption.source.look) return "pending";
  if (scene.look === adoption.target.look) return "applied";
  return "drifted";
}

/**
 * Prove an already-written adoption still matches the plan, without needing the source
 * look: applying deletes it once nothing else uses it, so it cannot be replayed.
 */
function verifyAppliedAdoption(recipe, adoption, layoutById, location) {
  const look = recipe.looks?.[adoption.target.look];
  invariant(look, `${location}: applied look '${adoption.target.look}' is missing`);
  invariant(look.layout === adoption.target.primitive,
    `${location}: applied look wears '${look.layout}', plan says '${adoption.target.primitive}'`);
  invariant(same(look.layoutOverrides, adoption.target.layoutOverrides),
    `${location}: applied look overrides drifted from the plan`);

  const allowed = new Set([...STRUCTURAL_LOOK_FIELDS, ...(adoption.target.preserveLookFields || [])]);
  for (const field of Object.keys(look)) {
    invariant(allowed.has(field), `${location}: applied look carries unplanned field '${field}'`);
  }

  const scene = (recipe.scenes || []).find((candidate) => candidate.id === adoption.sceneId);
  invariant(scene.layout === undefined, `${location}: applied scene still names a layout`);
  const targetSlots = (layoutById.get(adoption.target.primitive)?.photoSlots || []).map((slot) => slot.id);
  invariant(same((scene.photoSlots || []).map((slot) => slot.slot), targetSlots),
    `${location}: applied scene requests ${JSON.stringify((scene.photoSlots || []).map((slot) => slot.slot))}, `
    + `primitive owns ${JSON.stringify(targetSlots)}`);
}

/**
 * Verify that applying a recipe plan preserves the content contract of every reachable
 * path through each adopted scene, and that nothing the recipe authored is dropped on the
 * way. This is intentionally independent of the writer so --check-plan can prove the
 * migration before any recipe file changes.
 */
export function adoptionContentAudit(sourceRecipe, appliedRecipe, recipePlan, library) {
  const errors = [];
  let pathCount = 0;
  let textKeyCount = 0;
  let intrinsicBackgroundChanges = 0;

  for (const adoption of recipePlan.adoptions || []) {
    const location = `${sourceRecipe.id}/${adoption.sceneId}`;
    // Nothing to compare once a batch has been written: verifyAppliedAdoption() owns that
    // state, and the source look this audit would diff against no longer exists.
    if (adoptionStatus(sourceRecipe, adoption) !== "pending") continue;

    const sourceScene = (sourceRecipe.scenes || [])
      .find((candidate) => candidate.id === adoption.sceneId);
    const appliedScene = (appliedRecipe.scenes || [])
      .find((candidate) => candidate.id === adoption.sceneId);
    if (!sourceScene || !appliedScene) {
      errors.push(`${location}: source or applied scene is missing`);
      continue;
    }

    const sourcePaths = executionPaths(sourceScene);
    const appliedPaths = new Map(executionPaths(appliedScene)
      .map((entry) => [entry.label, entry.scene]));
    const sourceUnion = new Set();
    const appliedUnion = new Set();

    for (const sourcePath of sourcePaths) {
      const pathLocation = `${location}/${sourcePath.label}`;
      const appliedPath = appliedPaths.get(sourcePath.label);
      if (!appliedPath) {
        errors.push(`${pathLocation}: execution path disappeared`);
        continue;
      }
      pathCount += 1;

      const sourceResolution = resolveScene(
        sourcePath.scene,
        { template: sourceRecipe, library },
      );
      const appliedResolution = resolveScene(
        appliedPath,
        { template: appliedRecipe, library },
      );
      if (sourceResolution.errors.length || appliedResolution.errors.length) {
        errors.push(`${pathLocation}: cannot resolve content contract`);
        continue;
      }

      const beforeDemand = photoDemand(sourceResolution.scene, library);
      const afterDemand = photoDemand(appliedResolution.scene, library);
      if (beforeDemand !== afterDemand) {
        errors.push(`${pathLocation}: photo demand changed ${beforeDemand} -> ${afterDemand}`);
      }

      if (!same(
        sourceResolution.scene.resolvedLayout?.background,
        appliedResolution.scene.resolvedLayout?.background,
      )) intrinsicBackgroundChanges += 1;

      const sourceTextKeys = textKeysOf(sourcePath.scene);
      const appliedTextKeys = textKeysOf(appliedPath);
      sourceTextKeys.forEach((key) => sourceUnion.add(key));
      appliedTextKeys.forEach((key) => appliedUnion.add(key));

      const availableTextSlots = new Set(
        (appliedResolution.scene.resolvedLayout?.textSlots || []).map((slot) => slot.id),
      );
      for (const key of appliedTextKeys) {
        if (!availableTextSlots.has(key)) {
          errors.push(`${pathLocation}: text key '${key}' has no slot in the applied layout`);
        }
      }
    }

    for (const label of appliedPaths.keys()) {
      if (!sourcePaths.some((entry) => entry.label === label)) {
        errors.push(`${location}/${label}: unexpected execution path was added`);
      }
    }

    const beforeKeys = [...sourceUnion].sort();
    const afterKeys = [...appliedUnion].sort();
    textKeyCount += beforeKeys.length;
    if (JSON.stringify(beforeKeys) !== JSON.stringify(afterKeys)) {
      errors.push(
        `${location}: union text keys changed `
        + `${JSON.stringify(beforeKeys)} -> ${JSON.stringify(afterKeys)}`,
      );
    }

    errors.push(...droppedDressingErrors(sourceRecipe, appliedRecipe, adoption, location));
  }

  return { errors, pathCount, textKeyCount, intrinsicBackgroundChanges };
}

/**
 * A picture is more than its photo count. The whitelist that builds the target look copies
 * three fields and drops the rest, so anything else the recipe authored — a tinted matte,
 * a grade — leaves without a sound. Two drops are legitimate and named here; every other
 * one is a bug in the map.
 */
function droppedDressingErrors(sourceRecipe, appliedRecipe, adoption, location) {
  const errors = [];
  const sourceLook = sourceRecipe.looks?.[adoption.source.look];
  const targetLook = appliedRecipe.looks?.[adoption.target.look];
  if (!sourceLook || !targetLook) return [`${location}: cannot compare look dressing`];
  const preserved = new Set(adoption.target.preserveLookFields || []);

  for (const field of Object.keys(sourceLook)) {
    if (STRUCTURAL_LOOK_FIELDS.has(field)) continue;
    if (preserved.has(field)) {
      if (!same(sourceLook[field], targetLook[field])) {
        errors.push(`${location}: '${field}' was listed as preserved but did not survive`);
      }
      continue;
    }
    // A look-level frame beats the slot's own (layerSceneBuilder resolves def.frame ->
    // scene.resolvedFrame -> slot.frame), so these primitives can only wear the medallion
    // or the card border they were designed with if the adopting look drops it. P1.7R.
    if (field === "frame" && FRAME_OWNING_PRIMITIVES.has(adoption.target.primitive)) continue;
    errors.push(
      `${location}: look field '${field}' is dropped; preserve it or move it into the target`,
    );
  }

  // Slot and text overrides are written against the source layout's geometry and cannot
  // follow the scene onto a different primitive. A background override can, and is the one
  // piece of authored art direction a layout swap would otherwise erase silently.
  if (sourceLook.layoutOverrides?.background
    && !same(sourceLook.layoutOverrides.background, targetLook.layoutOverrides?.background)) {
    errors.push(
      `${location}: source look painted the background `
      + `${JSON.stringify(sourceLook.layoutOverrides.background)}; the target drops it`,
    );
  }
  return errors;
}

/**
 * Photo requests pair with the primitive's slots by index, so a swap can quietly hand a
 * portrait request a landscape hole. An explicit orient is a hard contract; an `any`
 * request changing shape is a judgement call the map has to sign for.
 */
export function orientationAudit(sourceRecipe, appliedRecipe, recipePlan, library) {
  const errors = [];
  let declaredDriftCount = 0;

  for (const adoption of recipePlan.adoptions || []) {
    const location = `${sourceRecipe.id}/${adoption.sceneId}`;
    const accepts = new Set(adoption.target.accepts || []);
    for (const name of accepts) {
      if (!DECLARABLE_DRIFT.has(name)) errors.push(`${location}: cannot declare unknown drift '${name}'`);
    }
    const pending = adoptionStatus(sourceRecipe, adoption) === "pending";
    const sourceScene = (sourceRecipe.scenes || [])
      .find((candidate) => candidate.id === adoption.sceneId);
    const appliedScene = (appliedRecipe.scenes || [])
      .find((candidate) => candidate.id === adoption.sceneId);
    if (!sourceScene || !appliedScene) {
      errors.push(`${location}: source or applied scene is missing`);
      continue;
    }

    const before = resolveScene(sourceScene, { template: sourceRecipe, library });
    const after = resolveScene(appliedScene, { template: appliedRecipe, library });
    if (before.errors.length || after.errors.length) {
      errors.push(`${location}: cannot resolve the orientation probe`);
      continue;
    }
    const sourceSlots = before.scene.resolvedLayout?.photoSlots || [];
    const targetSlots = new Map((after.scene.resolvedLayout?.photoSlots || [])
      .map((slot) => [slot.id, slot]));

    (appliedScene.photoSlots || []).forEach((request, index) => {
      const target = targetSlots.get(request.slot);
      if (!target) {
        errors.push(`${location}: request ${index} names slot '${request.slot}', which the primitive does not own`);
        return;
      }
      const landsOn = slotClass(target);
      const wanted = request.orient && request.orient !== "any" ? request.orient : null;
      if (wanted) {
        if (landsOn !== wanted && landsOn !== "square") {
          errors.push(
            `${location}: request ${index} asks for a ${wanted} photo but '${target.id}' is `
            + `${landsOn} (${target.width}x${target.height})`,
          );
        }
        return;
      }
      if (!pending) return;
      const came = sourceSlots[index] ? slotClass(sourceSlots[index]) : null;
      if (!came || came === landsOn || came === "square" || landsOn === "square") return;
      if (accepts.has("orientation")) declaredDriftCount += 1;
      else {
        errors.push(
          `${location}: request ${index} changes shape ${came} -> ${landsOn} without `
          + `declaring accepts: ["orientation"]`,
        );
      }
    });
  }

  return { errors, declaredDriftCount };
}

export function galleryTailAudit(recipes, library) {
  const errors = [];
  const signatures = new Map();
  const expectedOrder = ["s83", "s84", "s85"];

  for (const recipe of recipes) {
    const resolution = resolveTemplate(recipe, { library });
    if (resolution.errors.length) {
      errors.push(`${recipe.id}: cannot resolve gallery-tail`);
      continue;
    }
    const tail = resolution.scenes.filter((scene) => /^s8[345]_/.test(scene.id));
    const order = tail.map((scene) => scene.id.slice(0, 3));
    if (tail.length !== 3 || JSON.stringify(order) !== JSON.stringify(expectedOrder)) {
      errors.push(
        `${recipe.id}: gallery-tail order is ${order.join(" > ") || "(missing)"}, `
        + `expected ${expectedOrder.join(" > ")}`,
      );
      continue;
    }
    const signature = tail.map(visualSignature).join(" > ");
    const owners = signatures.get(signature) || [];
    owners.push(recipe.id);
    signatures.set(signature, owners);
  }

  for (const owners of signatures.values()) {
    if (owners.length > 1) {
      errors.push(`gallery-tail signature is shared by ${owners.join(", ")}`);
    }
  }

  return {
    errors,
    recipeCount: recipes.length,
    distinctCount: signatures.size,
  };
}

/**
 * Every composition in the catalogue, the way test/template-recipes.test.mjs counts them.
 */
function compositionsOf(recipe, library) {
  const seen = new Set();
  const add = (scene, alternative) => {
    const merged = { ...scene, ...(alternative || {}) };
    if (alternative?.look) delete merged.layout;
    else if (alternative?.layout) delete merged.look;
    const [only] = resolveTemplate({ ...recipe, scenes: [merged] }, { library }).scenes;
    const signature = only && visualSignature(only);
    if (signature) seen.add(signature);
  };
  for (const scene of recipe.scenes || []) {
    if (scene.effect !== "layer_scene") continue;
    add(scene, null);
    if (scene.muteFallback) add(scene, scene.muteFallback);
    for (const variant of scene.repeatable?.variants || []) add(scene, variant);
  }
  return seen;
}

/**
 * Two recipes are two products. The committed bar is a third of their compositions, but
 * the catalogue actually stands at zero sharing, and a rollout that hands the same
 * primitive the same overrides in two recipes would spend that margin without anyone
 * noticing: the tail audit compares the s83 > s84 > s85 sequence, so one shared picture
 * inside it stays invisible. Hold the line where it is.
 */
export function compositionUniquenessAudit(recipes, library) {
  const errors = [];
  const owners = new Map();

  for (const recipe of recipes) {
    for (const signature of compositionsOf(recipe, library)) {
      const list = owners.get(signature) || [];
      list.push(recipe.id);
      owners.set(signature, list);
    }
  }

  for (const [signature, list] of owners) {
    if (list.length > 1) {
      errors.push(`composition ${signature} is shared by ${list.join(", ")}`);
    }
  }

  return { errors, distinctCount: owners.size };
}

export function primitiveHostAudit(map) {
  const errors = [];
  const active = new Set(map.activePrimitives || []);
  const forbidden = new Set(map.forbiddenPrimitives || []);
  const hostRecipes = new Map([...active].map((primitive) => [primitive, new Set()]));
  let forbiddenAdoptionCount = 0;

  for (const primitive of active) {
    if (forbidden.has(primitive)) {
      errors.push(`primitive '${primitive}' cannot be both active and Phase 1b`);
    }
  }

  for (const [recipeId, plan] of Object.entries(map.recipes || {})) {
    for (const adoption of plan.adoptions || []) {
      const primitive = adoption.target?.primitive;
      const location = `${recipeId}/${adoption.sceneId}`;
      if (forbidden.has(primitive)) {
        forbiddenAdoptionCount += 1;
        errors.push(`${location}: Phase 1b primitive '${primitive}' is forbidden`);
        continue;
      }
      if (!active.has(primitive)) {
        errors.push(`${location}: primitive '${primitive ?? "(missing)"}' is not active`);
        continue;
      }
      hostRecipes.get(primitive).add(recipeId);
    }
  }

  const hosts = Object.fromEntries(
    [...active].map((primitive) => [primitive, hostRecipes.get(primitive).size]),
  );
  for (const [primitive, count] of Object.entries(hosts)) {
    if (count < 2) {
      errors.push(`${primitive} has only ${count} recipe host(s); minimum is 2`);
    }
  }

  return {
    errors,
    hosts,
    activeCount: active.size,
    forbiddenAdoptionCount,
  };
}

export function constrainedCohortAudit(map, simulatedRecipes, library) {
  const errors = [];
  const expectedScenes = ["s83", "s84", "s85"];
  const recipeById = new Map(simulatedRecipes.map((recipe) => [recipe.id, recipe]));
  const cohort = [];

  const members = map.constrainedCohort || [];
  if (!members.length) errors.push("map declares no constrainedCohort");

  for (const recipeId of members) {
    const plan = map.recipes?.[recipeId];
    const adoptedScenes = (plan?.adoptions || [])
      .map((adoption) => adoption.sceneId.slice(0, 3))
      .sort();
    if (JSON.stringify(adoptedScenes) !== JSON.stringify(expectedScenes)) {
      errors.push(
        `${recipeId}: constrained recipe must adopt exactly `
        + `${expectedScenes.join(" > ")}, found ${adoptedScenes.join(" > ") || "(none)"}`,
      );
    }
    const recipe = recipeById.get(recipeId);
    if (!recipe) {
      errors.push(`${recipeId}: simulated constrained recipe is missing`);
    } else {
      cohort.push(recipe);
    }
  }

  const tailAudit = galleryTailAudit(cohort, library);
  errors.push(...tailAudit.errors);
  return {
    errors,
    recipeCount: cohort.length,
    distinctCount: tailAudit.distinctCount,
  };
}

/**
 * The point of the whole phase, measured on the tree the rollout will actually produce.
 * Every other gate here proves the migration is faithful; this one proves it was worth
 * running. It also lints the simulated recipes, because linting the source tree says
 * nothing about the recipes the batches will write.
 */
export function simulatedTargetAudit(map, simulatedRecipes, library) {
  const errors = [];
  const targets = map.targets || {};
  const excluded = new Set(Object.keys(map.excludedRecipes || {}));
  const stats = geometryStats(simulatedRecipes, library);
  const over12Count = stats.reachable.groups.filter((group) => group.share > 12).length;

  if (stats.reachable.maxShare > targets.reachableMaxShare) {
    errors.push(`reachable.maxShare is ${stats.reachable.maxShare}, target is ${targets.reachableMaxShare}`);
  }
  if (over12Count > targets.reachableOver12Count) {
    errors.push(`reachable.over12Count is ${over12Count}, target is ${targets.reachableOver12Count}`);
  }
  for (const recipe of simulatedRecipes) {
    const floor = excluded.has(recipe.id) ? targets.excludedMeaningful : targets.meaningfulPerRecipe;
    const measured = stats.perRecipe[recipe.id]?.meaningful ?? 0;
    if (measured < floor) errors.push(`${recipe.id} has ${measured} meaningful scene(s), floor is ${floor}`);
  }

  let lintClean = 0;
  for (const recipe of simulatedRecipes) {
    const report = evaluateStoryTemplate(recipe, { library });
    if (!report.errors.length) lintClean += 1;
    else {
      for (const finding of report.errors) {
        errors.push(`${recipe.id}: lint ${finding.check} [${finding.id}] ${finding.detail}`);
      }
    }
  }

  return {
    errors,
    maxShare: stats.reachable.maxShare,
    over12Count,
    lintClean,
    recipeCount: simulatedRecipes.length,
  };
}

/**
 * Apply one recipe's declared adoption plan to a clone and return the clone. An adoption
 * already written to disk is verified against the plan rather than applied again, so the
 * whole-map gate keeps working through a batched rollout. No filesystem writes occur here.
 */
export function applyRecipePlan(recipe, recipePlan, library) {
  const next = clone(recipe);
  const layoutById = new Map((library.layouts || []).map((layout) => [layout.id, layout]));
  const sourceLooks = new Set();

  invariant(Array.isArray(recipePlan?.adoptions), `${recipe.id}: adoption plan is missing`);

  for (const adoption of recipePlan.adoptions) {
    const location = `${recipe.id}/${adoption.sceneId}`;
    const status = adoptionStatus(next, adoption);
    invariant(status !== "missing", `${location}: scene does not exist`);
    const scene = (next.scenes || []).find((candidate) => candidate.id === adoption.sceneId);
    invariant(status !== "drifted",
      `${location}: expected source look '${adoption.source.look}' or applied look `
      + `'${adoption.target.look}', found '${scene.look ?? "(none)"}'`);
    if (status === "applied") {
      verifyAppliedAdoption(next, adoption, layoutById, location);
      continue;
    }

    const sourceLook = next.looks?.[adoption.source.look];
    invariant(sourceLook, `${location}: source look '${adoption.source.look}' does not exist`);
    invariant(sourceLook.layout === adoption.source.layout,
      `${location}: expected source layout '${adoption.source.layout}', found '${sourceLook.layout}'`);
    invariant(!next.looks?.[adoption.target.look],
      `${location}: target look '${adoption.target.look}' already exists`);

    const sourceLayout = layoutById.get(adoption.source.layout);
    const targetLayout = layoutById.get(adoption.target.primitive);
    invariant(sourceLayout, `${location}: source layout '${adoption.source.layout}' is not in the library`);
    invariant(targetLayout, `${location}: primitive '${adoption.target.primitive}' is not in the library`);

    const sourceSlots = sourceLayout.photoSlots || [];
    const targetSlots = targetLayout.photoSlots || [];
    const requests = scene.photoSlots || [];
    invariant(sourceSlots.length === targetSlots.length,
      `${location}: primitive changes photo demand ${sourceSlots.length} -> ${targetSlots.length}`);
    invariant(requests.length === targetSlots.length,
      `${location}: scene has ${requests.length} photo request(s), expected ${targetSlots.length}`);

    const targetLook = {
      intent: `Phase 2 adoption of ${adoption.target.primitive} for ${adoption.sceneId}.`,
      layout: adoption.target.primitive,
    };
    for (const field of adoption.target.preserveLookFields || []) {
      invariant(PRESERVABLE_LOOK_FIELDS.has(field),
        `${location}: cannot preserve unsupported look field '${field}'`);
      if (sourceLook[field] !== undefined) targetLook[field] = clone(sourceLook[field]);
    }
    if (adoption.target.layoutOverrides) {
      targetLook.layoutOverrides = clone(adoption.target.layoutOverrides);
    }

    next.looks ||= {};
    next.looks[adoption.target.look] = targetLook;
    scene.look = adoption.target.look;
    delete scene.layout;
    scene.photoSlots = targetSlots.map((slot, index) => ({
      ...requests[index],
      slot: slot.id,
    }));
    sourceLooks.add(adoption.source.look);
  }

  const used = usedLookIds(next);
  for (const lookId of sourceLooks) {
    if (!used.has(lookId)) delete next.looks[lookId];
  }
  return next;
}

export function formatWidespreadGeometryReport(stats) {
  const groups = (stats?.reachable?.groups || []).filter((group) => group.share > 12);
  const lines = [`Widespread reachable geometry: ${groups.length} group(s)`];

  groups.forEach((group, index) => {
    lines.push(`geometry[${index + 1}] key=${group.key}`);
    lines.push(`  share=${group.share} occurrence(s)=${group.occurrences.length}`);

    const byRecipe = new Map();
    for (const occurrence of group.occurrences) {
      const entries = byRecipe.get(occurrence.recipeId) || [];
      entries.push(occurrence);
      byRecipe.set(occurrence.recipeId, entries);
    }
    for (const recipeId of [...byRecipe.keys()].sort()) {
      lines.push(`  recipe=${recipeId}`);
      const occurrences = byRecipe.get(recipeId)
        .sort((left, right) => left.location.localeCompare(right.location));
      for (const occurrence of occurrences) {
        lines.push(
          `    location=${occurrence.location} | source=${occurrence.source}`
          + ` | look=${occurrence.look ?? "-"} | layout=${occurrence.layout ?? "-"}`,
        );
      }
    }
  });
  return lines.join("\n");
}

export function reauditedPrimitiveErrors(recipe, recipePlan, library) {
  const errors = [];
  const canvas = library.meta?.canvas || { width: 1920, height: 1080 };
  const coverage = (layout) => (layout.photoSlots || [])
    .reduce((sum, slot) => sum + slot.width * slot.height, 0)
    / (canvas.width * canvas.height);

  for (const adoption of recipePlan.adoptions || []) {
    const location = `${recipe.id}/${adoption.sceneId}`;
    const scene = (recipe.scenes || []).find((candidate) => candidate.id === adoption.sceneId);
    const look = recipe.looks?.[adoption.target.look];
    if (!scene || !look) {
      errors.push(`${location}: applied scene/look is missing`);
      continue;
    }
    const resolved = resolveScene(scene, { template: recipe, library });
    if (resolved.errors.length || !resolved.scene.resolvedLayout) {
      errors.push(`${location}: cannot resolve P1.7R policy probe`);
      continue;
    }
    const layout = resolved.scene.resolvedLayout;
    const primitive = adoption.target.primitive;

    if (FRAME_OWNING_PRIMITIVES.has(primitive)) {
      if (look.frame !== undefined) {
        errors.push(`${location}: global look frame overrides ${primitive}'s intrinsic slot frame`);
      }
      if ((scene.photoSlots || []).some((slot) => slot.frame !== undefined)) {
        errors.push(`${location}: scene slot frame overrides ${primitive}'s intrinsic slot frame`);
      }
    }

    if (primitive === "stacked_horizon_trio") {
      if ((scene.photoSlots || []).some((slot) => slot.orient !== "landscape")) {
        errors.push(`${location}: stacked_horizon_trio is restricted to all-landscape requests`);
      }
      if ((layout.photoSlots || []).some((slot) => slot.width / slot.height > 4)) {
        errors.push(`${location}: stacked_horizon_trio recreates a strip wider than 4:1`);
      }
      const [band1, band2, band3] = layout.photoSlots || [];
      if (!band1 || !band2 || !band3
        || band2.x - band1.x < 300 || Math.abs(band3.x - band1.x) > 100) {
        errors.push(`${location}: stacked_horizon_trio loses the P1.7R stagger`);
      }
      if (coverage(layout) < 0.5) {
        errors.push(`${location}: stacked_horizon_trio coverage fell below 50%`);
      }
    }

    if (primitive === "offset_portrait_hero") {
      const hero = (layout.photoSlots || []).find((slot) => slot.id === "hero");
      if (!hero || hero.width < 1240 || hero.height < 900 || coverage(layout) < 0.53) {
        errors.push(`${location}: offset_portrait_hero regresses the P1.7R hero size/coverage`);
      }
    }

    if (primitive === "diagonal_staircase_trio") {
      if ((layout.photoSlots || []).some((slot) => slot.width < 620 || slot.height < 500)
        || coverage(layout) < 0.44) {
        errors.push(`${location}: diagonal_staircase_trio regresses the P1.7R slot size/coverage`);
      }
    }
  }
  return errors;
}

function usage() {
  return [
    "Usage:",
    "  node scripts/adoptNewPrimitives.mjs --check-plan",
    "  node scripts/adoptNewPrimitives.mjs --write --batch <pilot|B1|B2|B3|B4|B5>",
  ].join("\n");
}

function argumentValue(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

/**
 * Both modes run the same gates over the same simulated catalogue. --write differs only in
 * what it does afterwards: it saves one batch. A writer that checked less than the checker
 * would let a batch land something --check-plan would have refused.
 */
function auditWholeMap(map, library, sourceRecipes) {
  const active = new Set(map.activePrimitives || []);
  const forbidden = new Set(map.forbiddenPrimitives || []);
  const hostAudit = primitiveHostAudit(map);
  invariant(hostAudit.errors.length === 0,
    `primitive host contract failed: ${hostAudit.errors.join("; ")}`);

  const sourceById = new Map(sourceRecipes.map((recipe) => [recipe.id, recipe]));
  const prepared = [];
  for (const [recipeId, plan] of Object.entries(map.recipes)) {
    for (const adoption of plan.adoptions || []) {
      invariant(active.has(adoption.target.primitive),
        `${recipeId}/${adoption.sceneId}: '${adoption.target.primitive}' is not an active primitive`);
      invariant(!forbidden.has(adoption.target.primitive),
        `${recipeId}/${adoption.sceneId}: '${adoption.target.primitive}' is forbidden`);
    }
    const recipe = sourceById.get(recipeId);
    invariant(recipe, `story-templates/${recipeId}.json: recipe is missing`);

    const applied = applyRecipePlan(recipe, plan, library);
    const resolved = resolveTemplate(applied, { library });
    invariant(resolved.errors.length === 0,
      `${recipeId}: resolved plan has errors: ${resolved.errors.map((item) => item.detail).join("; ")}`);
    const reauditErrors = reauditedPrimitiveErrors(applied, plan, library);
    invariant(reauditErrors.length === 0,
      `${recipeId}: P1.7R policy failed: ${reauditErrors.join("; ")}`);
    const contentAudit = adoptionContentAudit(recipe, applied, plan, library);
    invariant(contentAudit.errors.length === 0,
      `${recipeId}: content contract failed: ${contentAudit.errors.join("; ")}`);
    const orientation = orientationAudit(recipe, applied, plan, library);
    invariant(orientation.errors.length === 0,
      `${recipeId}: orientation contract failed: ${orientation.errors.join("; ")}`);

    prepared.push({
      filePath: null,
      recipeId,
      batch: plan.batch,
      recipe: applied,
      adoptionCount: plan.adoptions.length,
      pendingCount: plan.adoptions
        .filter((adoption) => adoptionStatus(recipe, adoption) === "pending").length,
      contentPathCount: contentAudit.pathCount,
      textKeyCount: contentAudit.textKeyCount,
      backgroundChanges: contentAudit.intrinsicBackgroundChanges,
      declaredDriftCount: orientation.declaredDriftCount,
    });
  }

  const preparedById = new Map(prepared.map((item) => [item.recipeId, item.recipe]));
  const simulatedRecipes = sourceRecipes.map((recipe) => preparedById.get(recipe.id) || recipe);

  const tailAudit = galleryTailAudit(simulatedRecipes, library);
  invariant(tailAudit.errors.length === 0,
    `gallery-tail contract failed: ${tailAudit.errors.join("; ")}`);
  const cohortAudit = constrainedCohortAudit(map, simulatedRecipes, library);
  invariant(cohortAudit.errors.length === 0,
    `constrained cohort contract failed: ${cohortAudit.errors.join("; ")}`);
  const uniqueness = compositionUniquenessAudit(simulatedRecipes, library);
  invariant(uniqueness.errors.length === 0,
    `composition uniqueness failed: ${uniqueness.errors.join("; ")}`);
  const targetAudit = simulatedTargetAudit(map, simulatedRecipes, library);
  invariant(targetAudit.errors.length === 0,
    `phase 2 targets failed: ${targetAudit.errors.join("; ")}`);

  return { prepared, hostAudit, tailAudit, cohortAudit, uniqueness, targetAudit };
}

function run() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(usage());
    return;
  }

  const batch = argumentValue(args, "--batch");
  const checkPlan = args.includes("--check-plan");
  const write = args.includes("--write");
  invariant(!(checkPlan && write), "--check-plan and --write are mutually exclusive");
  if (checkPlan) {
    invariant(!batch, "--check-plan always checks the complete map; omit --batch");
  } else {
    invariant(write, `Refusing to change recipes without --write.\n\n${usage()}`);
    invariant(batch && !batch.startsWith("--"), `A batch is required.\n\n${usage()}`);
  }

  const root = process.cwd();
  const map = JSON.parse(fs.readFileSync(
    path.join(root, "scripts", "newPrimitiveAdoptionMap.json"),
    "utf8",
  ));
  const library = JSON.parse(fs.readFileSync(path.join(root, "layouts", "library.json"), "utf8"));
  const templateDir = path.join(root, "story-templates");
  const sourceRecipes = fs.readdirSync(templateDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => {
      const recipe = JSON.parse(fs.readFileSync(path.join(templateDir, file), "utf8"));
      invariant(recipe.id === path.basename(file, ".json"),
        `${file}: recipe id is '${recipe.id}'`);
      return recipe;
    });

  const audit = auditWholeMap(map, library, sourceRecipes);
  const { prepared, hostAudit, tailAudit, cohortAudit, uniqueness, targetAudit } = audit;
  const adoptionCount = prepared.reduce((sum, item) => sum + item.adoptionCount, 0);
  const pendingCount = prepared.reduce((sum, item) => sum + item.pendingCount, 0);

  if (checkPlan) {
    const sum = (field) => prepared.reduce((total, item) => total + item[field], 0);
    console.log(formatWidespreadGeometryReport(geometryStats(sourceRecipes, library)));
    console.log(
      `Content contract: ${sum("contentPathCount")} execution path(s), `
      + `${sum("textKeyCount")} union text key(s); photo demand and copy preserved.`,
    );
    console.log(
      `Orientation contract: 0 request(s) land on the wrong shape; `
      + `${sum("declaredDriftCount")} declared shape change(s).`,
    );
    console.log(
      `Gallery-tail contract: ${tailAudit.distinctCount}/${tailAudit.recipeCount} unique `
      + `s83 > s84 > s85 signature(s).`,
    );
    console.log(
      `Composition contract: ${uniqueness.distinctCount} composition(s), 0 shared between recipes.`,
    );
    const hostSummary = (map.activePrimitives || [])
      .map((primitive) => `${primitive}=${hostAudit.hosts[primitive]}`)
      .join(", ");
    console.log(
      `Primitive host contract: ${hostAudit.activeCount} active; ${hostSummary}; `
      + `${hostAudit.forbiddenAdoptionCount} Phase 1b adoption(s).`,
    );
    console.log(
      `Constrained cohort contract: ${cohortAudit.distinctCount}/${cohortAudit.recipeCount} `
      + `unique gallery-tail signature(s); each adopts s83 > s84 > s85.`,
    );
    console.log(
      `Phase 2 targets on the simulated tree: reachable.maxShare=${targetAudit.maxShare}, `
      + `over12=${targetAudit.over12Count}, lint ${targetAudit.lintClean}/${targetAudit.recipeCount} clean.`,
    );
    console.log(
      `Checked ${adoptionCount} adoption(s) across ${prepared.length} recipe(s) `
      + `(${pendingCount} pending, ${adoptionCount - pendingCount} already applied); no files written.`,
    );
    return;
  }

  const batched = prepared.filter((item) => item.batch === batch);
  invariant(batched.length > 0, `Unknown or empty batch '${batch}'`);
  for (const item of batched) {
    fs.writeFileSync(
      path.join(templateDir, `${item.recipeId}.json`),
      `${JSON.stringify(item.recipe, null, 2)}\n`,
    );
  }
  const batchAdoptions = batched.reduce((sum, item) => sum + item.adoptionCount, 0);
  console.log(`Applied ${batchAdoptions} adoption(s) to ${batched.length} recipe(s) in batch ${batch}.`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    run();
  } catch (error) {
    console.error(`[adoptNewPrimitives] ${error.message}`);
    process.exitCode = 1;
  }
}
