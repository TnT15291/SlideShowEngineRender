import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  geometryKey,
  geometryStats,
  meaningfullyDiffers,
  slotShapeKey,
} from "../scripts/lib/geometrySignature.mjs";
import { rotatedSlotBounds } from "../scripts/lib/lookResolver.mjs";

const root = process.cwd();
const library = JSON.parse(fs.readFileSync(path.join(root, "layouts", "library.json"), "utf8"));
const recipes = fs.readdirSync(path.join(root, "story-templates"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(root, "story-templates", file), "utf8")));
const stats = geometryStats(recipes, library);

// Ratcheted to what the tree actually measures, never to a target. A recipe is locked at the
// count it reached the batch it migrated in; the rest tighten batch by batch.
const meaningfulBaseline = {
  // Phase 2B pilot
  "cinematic-film-01": 3,
  "editorial-bold-01": 3,
  "jmii-silk-botanical-01": 6,
  // Phase 2C batch B1
  "afterparty-pulse-01": 3,
  "cinematic-vows-01": 3,
  "city-to-ceremony-01": 3,
  "classic-luxury-01": 3,
  // faithful to its source, exempt from the rollout
  "white-weddings-full-01": 1,
};

test("layout geometry metric suite is wired into the Node test runner", () => {
  assert.equal(typeof geometryKey, "function");
  assert.equal(typeof slotShapeKey, "function");
  assert.equal(typeof meaningfullyDiffers, "function");
  assert.equal(typeof geometryStats, "function");
});

test("meaningful custom geometry does not regress per recipe", () => {
  for (const recipe of recipes) {
    const minimum = meaningfulBaseline[recipe.id] ?? 0;
    assert.ok(
      stats.perRecipe[recipe.id].meaningful >= minimum,
      `${recipe.id}: expected at least ${minimum} meaningful scene(s), got ${stats.perRecipe[recipe.id].meaningful}`,
    );
  }
});

test("catalog, authored, and reachable geometry ratchets do not regress", () => {
  assert.ok(stats.catalog.distinct >= 76, `catalog distinct fell to ${stats.catalog.distinct}`);
  assert.ok(stats.authored.distinct >= 68, `authored distinct fell to ${stats.authored.distinct}`);
  assert.ok(stats.reachable.maxShare <= 18, `reachable maxShare rose to ${stats.reachable.maxShare}`);
  assert.ok(
    stats.reachable.over12Count <= 4,
    `reachable over12Count rose to ${stats.reachable.over12Count}`,
  );
});

test("closing_names keeps its V2 geometry diversity", () => {
  const recipesByKey = new Map();
  for (const group of stats.authored.groups) {
    for (const occurrence of group.occurrences) {
      if (occurrence.layout !== "closing_names") continue;
      if (!recipesByKey.has(group.key)) recipesByKey.set(group.key, new Set());
      recipesByKey.get(group.key).add(occurrence.recipeId);
    }
  }

  assert.equal(recipesByKey.size, 11, "closing_names must retain 11 distinct V2 keys");
  const maxGroup = Math.max(...[...recipesByKey.values()].map((recipeIds) => recipeIds.size));
  assert.ok(maxGroup <= 9, `closing_names largest group grew to ${maxGroup} recipes`);
});

test("reachable includes geometry found only in mute fallback and repeat variants", () => {
  const canvas = { width: 1000, height: 1000 };
  const layout = (id, x) => ({
    id,
    kind: "layer_scene",
    background: { type: "cream" },
    photoSlots: [{ id: "photo", x, y: 100, width: 200, height: 200 }],
  });
  const base = layout("base", 100);
  const fallback = layout("fallback", 400);
  const variant = layout("variant", 700);
  const fixtureLibrary = { meta: { canvas }, layouts: [base, fallback, variant] };
  const fixtureRecipe = {
    id: "reachable-fixture",
    scenes: [{
      id: "scene",
      effect: "layer_scene",
      layout: "base",
      muteFallback: { layout: "fallback" },
      repeatable: { variants: [{ layout: "variant" }] },
    }],
  };

  const fixtureStats = geometryStats([fixtureRecipe], fixtureLibrary);
  const authoredKeys = new Set(fixtureStats.authored.groups.map((group) => group.key));
  const reachableGroups = new Map(fixtureStats.reachable.groups.map((group) => [group.key, group]));
  const fallbackKey = geometryKey(fallback, canvas);
  const variantKey = geometryKey(variant, canvas);

  assert.equal(authoredKeys.has(fallbackKey), false);
  assert.equal(authoredKeys.has(variantKey), false);
  assert.ok(reachableGroups.get(fallbackKey)?.occurrences.some(
    (occurrence) => occurrence.source === "muteFallback",
  ));
  assert.ok(reachableGroups.get(variantKey)?.occurrences.some(
    (occurrence) => occurrence.source === "repeatableVariant",
  ));
});

test("negative rotation uses absolute sine and cosine for its bounding box", () => {
  const negative = rotatedSlotBounds({
    x: 820,
    y: 700,
    width: 100,
    height: 200,
    rotation: -30,
  });
  const positive = rotatedSlotBounds({
    x: 820,
    y: 700,
    width: 100,
    height: 200,
    rotation: 30,
  });

  assert.ok(Math.abs(negative.width - positive.width) < 1e-9);
  assert.ok(Math.abs(negative.height - positive.height) < 1e-9);
  assert.ok(Math.abs(negative.width - 186.60254037844385) < 1e-9);
  assert.ok(Math.abs(negative.height - 223.20508075688775) < 1e-9);
  assert.ok(negative.right > 1000, "rotated width must expose the right-edge overflow");
  assert.ok(negative.bottom > 900, "rotated height must expose the bottom edge");
});
