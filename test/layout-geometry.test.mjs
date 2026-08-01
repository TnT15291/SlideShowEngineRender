import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  geometryKey,
  geometryStats,
  meaningfullyDiffers,
  perceptualSignature,
  photoArrangementKey,
  slotShapeKey,
} from "../scripts/lib/geometrySignature.mjs";
import { resolveScene, rotatedSlotBounds } from "../scripts/lib/lookResolver.mjs";

const root = process.cwd();
const library = JSON.parse(fs.readFileSync(path.join(root, "layouts", "library.json"), "utf8"));
const recipes = fs.readdirSync(path.join(root, "story-templates"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(root, "story-templates", file), "utf8")));
const stats = geometryStats(recipes, library);

// Ratcheted to what the tree actually measures, never to a target. A recipe is locked at the
// count it has; the rest tighten as authoring lands.
//
// 2026-08-01: re-locked to measured values. Every one of these had been pinned at a flat 3
// while most recipes had since reached 4-6, so a recipe could shed geometry back to 3 and stay
// green — the ratchet was not ratcheting. Worse, 3 was ALSO the shared floor in
// newPrimitiveAdoptionMap.json and 21 of 25 recipes sat at exactly 3: the floor had become the
// target, and it was the direct cause of recipes sharing photo positions.
//
// Same day, after authoring per-recipe photo geometry across all 22 crowded layouts: every
// non-exempt recipe now reaches at least 5, so the map's shared floor moved 3 -> 5. That order
// matters — raising the shared floor first would only have blocked the adoption tool, since a
// floor is a gate on existing work, not a way to produce more of it.
const meaningfulBaseline = {
  "afterparty-pulse-01": 7,
  "cinematic-film-01": 8,
  "cinematic-vows-01": 6,
  "city-to-ceremony-01": 6,
  "classic-luxury-01": 6,
  "classic-multisong-album-01": 10,
  "editorial-bold-01": 7,
  "family-roots-01": 7,
  "four-seasons-love-01": 6,
  "garden-botanical-01": 5,
  "garden-diary-01": 7,
  "heritage-ceremony-01": 7,
  "jmii-silk-botanical-01": 12,
  "korean-soft-01": 6,
  "letters-to-forever-01": 7,
  "long-distance-love-01": 7,
  "lucky-best-friends-01": 9,
  "luminous-editorial-motion-01": 8,
  "modern-teal-01": 7,
  "playful-scrapbook-01": 8,
  "studio-white-prewedding-01": 5,
  "three-chapters-biography-01": 9,
  "warm-film-01": 7,
  "white-weddings-editorial-01": 9,
  // faithful to its source, exempt from the primitive rollout; still locked at what it has
  "white-weddings-full-01": 2,
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

// A recipe absent from the baseline falls through `?? 0` and is held to nothing. That is not
// hypothetical: lucky-best-friends-01 landed with no entry, so the one guard meant to keep a
// new recipe from leaning on shared geometry was, for that recipe, switched off.
test("every recipe has a measured meaningful floor", () => {
  const unmeasured = recipes
    .map((recipe) => recipe.id)
    .filter((id) => !Object.hasOwn(meaningfulBaseline, id));
  assert.deepEqual(
    unmeasured, [],
    `these recipes have no meaningfulBaseline entry, so their floor is 0 — measure and add them: ${unmeasured.join(", ")}`,
  );
});

test("catalog, authored, and reachable geometry ratchets do not regress", () => {
  assert.ok(stats.catalog.distinct >= 233, `catalog distinct fell to ${stats.catalog.distinct}`);
  assert.ok(stats.authored.distinct >= 222, `authored distinct fell to ${stats.authored.distinct}`);
  assert.ok(stats.reachable.maxShare <= 9, `reachable maxShare rose to ${stats.reachable.maxShare}`);
  assert.ok(
    stats.reachable.over12Count === 0,
    `reachable over12Count rose to ${stats.reachable.over12Count}`,
  );
  // B4 pushed this to 31 before it was caught: two recipes had byte-identical layoutOverrides,
  // so they drew the same rectangles and differed only in frame. compositionUniquenessAudit
  // counts frame as distinguishing and passed them, which is why the number needs its own bar.
  assert.ok(stats.authored.shared <= 7, `authored shared rose to ${stats.authored.shared}`);
});

test("three_photo_row looks never fall back to one shared composition", () => {
  const base = library.layouts.find((layout) => layout.id === "three_photo_row");
  const fallback = geometryKey(base, library.meta.canvas);
  const owners = new Map();
  let lookCount = 0;

  for (const recipe of recipes) {
    for (const [lookId, look] of Object.entries(recipe.looks || {})) {
      if (look.layout !== "three_photo_row") continue;
      lookCount += 1;
      const { scene, errors } = resolveScene(
        { id: "__three_photo_row_probe", effect: "layer_scene", look: lookId },
        { template: recipe, library },
      );
      assert.deepEqual(errors, [], `${recipe.id}/${lookId} must resolve cleanly`);
      const fingerprint = geometryKey(scene.resolvedLayout, library.meta.canvas);
      assert.notEqual(
        fingerprint,
        fallback,
        `${recipe.id}/${lookId} has no authored photo geometry and falls back to 6,25 / 37,10 / 66,36`,
      );
      assert.equal(
        owners.has(fingerprint),
        false,
        `${recipe.id}/${lookId} duplicates ${owners.get(fingerprint)}`,
      );
      owners.set(fingerprint, `${recipe.id}/${lookId}`);
    }
  }

  assert.ok(lookCount >= 14, `three_photo_row coverage fell to ${lookCount} looks`);
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

// Where the photographs sit is the one axis a viewer reads before any dressing, and until
// this key existed nothing measured it on its own: geometryKey() separates two identical
// arrangements that carry different copy, and perceptualSignature() separates them by frame
// and type scale. Both read green while 64% of photo-bearing scenes shared an arrangement
// with another recipe — the complaint that "the templates still look alike" was correct and
// unmeasured. Ratcheted to what the tree measures today, never to a target.
const arrangements = () => {
  const seen = [];
  for (const recipe of recipes) {
    for (const scene of recipe.scenes || []) {
      if (scene.effect !== "layer_scene") continue;
      const { scene: only } = resolveScene(scene, { template: recipe, library });
      if (!only?.resolvedLayout) continue;
      const key = photoArrangementKey(only, library, library.meta.canvas);
      if (key === "[]") continue;   // a closing card arranges no photographs
      seen.push({ recipe: recipe.id, scene: scene.id, key });
    }
  }
  const byKey = new Map();
  for (const item of seen) {
    if (!byKey.has(item.key)) byKey.set(item.key, new Set());
    byKey.get(item.key).add(item.recipe);
  }
  return {
    scenes: seen,
    distinct: byKey.size,
    maxShare: Math.max(...[...byKey.values()].map((set) => set.size)),
    onShared: seen.filter((item) => byKey.get(item.key).size > 1).length,
  };
};

test("photo arrangements do not lose variety or spread further", () => {
  const stat = arrangements();
  // Every photo-bearing scene now draws an arrangement no other recipe uses. The bar was
  // 114/12/109 when this metric was first taken; authoring per-recipe photo geometry across
  // all 22 crowded layouts took it to one-per-scene, so the ratchet closes to exact.
  assert.equal(stat.maxShare, 1, `an arrangement is shared by ${stat.maxShare} recipes`);
  assert.equal(stat.onShared, 0, `${stat.onShared} scenes sit on an arrangement another recipe also uses`);
  assert.ok(
    stat.distinct === stat.scenes.length,
    `${stat.distinct} distinct arrangements across ${stat.scenes.length} photo-bearing scenes`,
  );
  assert.ok(stat.distinct >= 201, `distinct photo arrangements fell to ${stat.distinct}`);
});

test("photoArrangementKey reads position and nothing else", () => {
  const canvas = { width: 1920, height: 1080 };
  const slots = (x) => [
    { id: "left", x, y: 200, width: 700, height: 600 },
    { id: "right", x: 900, y: 200, width: 700, height: 600 },
  ];
  const bleed = {
    id: "bleed",
    kind: "layer_scene",
    background: { type: "photo_full_bleed", slot: "back" },
    photoSlots: [{ id: "back", x: 0, y: 0, width: 1920, height: 1080 }],
  };
  const fixture = {
    meta: { canvas },
    layouts: [
      { id: "here", kind: "layer_scene", background: { type: "cream" }, photoSlots: slots(100) },
      { id: "moved", kind: "layer_scene", background: { type: "cream" }, photoSlots: slots(300) },
      { id: "turned", kind: "layer_scene", background: { type: "cream" }, photoSlots: [{ ...slots(100)[0], rotation: 8 }, slots(100)[1]] },
      { id: "wordy", kind: "layer_scene", background: { type: "cream" }, photoSlots: slots(100), textSlots: [{ id: "t", x: 200, y: 900, width: 1400, height: 100, sizePx: 60 }] },
      bleed,
    ],
  };
  const keyOf = (layout, look = {}) => {
    const template = { id: "fx", layoutPresets: {}, looks: { only: { layout, ...look } } };
    const { scene } = resolveScene(
      { id: "probe", effect: "layer_scene", look: "only" },
      { template, library: fixture },
    );
    return photoArrangementKey(scene, fixture, canvas);
  };

  // Moving or turning a photograph is the whole point of the key.
  assert.notEqual(keyOf("here"), keyOf("moved"));
  assert.notEqual(keyOf("here"), keyOf("turned"));
  // Dressing does not move a photograph, so it must not register.
  assert.equal(
    keyOf("here"),
    keyOf("here", { frame: { radius: 40, border: 30, borderColor: "#000000", shadow: true }, photoTreatment: { saturation: 0.3 } }),
  );
  // Neither does copy: this is exactly what geometryKey() cannot tell you.
  assert.equal(keyOf("here"), keyOf("wordy"));
  assert.notEqual(geometryKey(fixture.layouts[0], canvas), geometryKey(fixture.layouts[3], canvas));
  // A full-bleed backdrop is not an arrangement anyone can vary.
  assert.equal(keyOf("bleed"), "[]");
});

// perceptualSignature exists to answer "do these two look like the same picture", which is a
// different question from visualSignature's "are these byte-identical". These fixtures pin the
// boundary: dressing a viewer cannot resolve must collapse, dressing they can must not.
const perceptionCanvas = { width: 1920, height: 1080 };
const perceptionLibrary = {
  meta: { canvas: perceptionCanvas },
  layouts: [
    {
      id: "pair",
      kind: "layer_scene",
      background: { type: "cream" },
      photoSlots: [
        { id: "left", x: 100, y: 200, width: 700, height: 600 },
        { id: "right", x: 900, y: 200, width: 700, height: 600 },
      ],
    },
    {
      id: "pair_shifted",
      kind: "layer_scene",
      background: { type: "cream" },
      photoSlots: [
        { id: "left", x: 100, y: 200, width: 700, height: 600 },
        { id: "right", x: 1100, y: 200, width: 700, height: 600 },
      ],
    },
    {
      id: "bleed",
      kind: "layer_scene",
      background: { type: "photo_full_bleed", slot: "back" },
      photoSlots: [{ id: "back", x: 0, y: 0, width: 1920, height: 1080 }],
    },
  ],
};

const perceptionOf = (look, layout = "pair") => {
  const template = { id: "fixture", layoutPresets: {}, looks: { only: { layout, ...look } } };
  const { scene } = resolveScene(
    { id: "probe", effect: "layer_scene", look: "only" },
    { template, library: perceptionLibrary },
  );
  return perceptualSignature(scene, template, perceptionLibrary, perceptionCanvas);
};

test("perceptualSignature collapses frame differences no viewer could resolve", () => {
  // Both are borderless tiles with a barely-rounded corner: 16px and 24px on a 600px-tall
  // slot are the same picture. This is the modern-teal-01 / white-weddings-full-01 pair.
  assert.equal(
    perceptionOf({ frame: { radius: 16, border: 0, shadow: false } }),
    perceptionOf({ frame: { radius: 24, border: 0, shadow: false } }),
  );
  // Border colour is not a difference when there is no border to colour.
  assert.equal(
    perceptionOf({ frame: { radius: 16, border: 0, borderColor: "#000000", shadow: false } }),
    perceptionOf({ frame: { radius: 16, border: 0, borderColor: "#FFFFFF", shadow: false } }),
  );
  // A 2% saturation nudge is not a different grade.
  assert.equal(
    perceptionOf({ photoTreatment: { saturation: 1.0 } }),
    perceptionOf({ photoTreatment: { saturation: 1.02 } }),
  );
});

test("perceptualSignature keeps frame differences a viewer can name", () => {
  const hairline = { frame: { radius: 0, border: 2, borderColor: "#DAD3C9", shadow: false } };
  const mount = { frame: { radius: 0, border: 34, borderColor: "#FFFDFC", shadow: true } };
  assert.notEqual(perceptionOf(hairline), perceptionOf(mount));

  // Same thickness, opposite tone: a dark rule and a cream mat do not read alike.
  assert.notEqual(
    perceptionOf({ frame: { radius: 0, border: 14, borderColor: "#17171B", shadow: false } }),
    perceptionOf({ frame: { radius: 0, border: 14, borderColor: "#FFFDFC", shadow: false } }),
  );
  // A softly rounded card and a full medallion are different silhouettes.
  assert.notEqual(
    perceptionOf({ frame: { radius: 20, border: 0, shadow: false } }),
    perceptionOf({ frame: { radius: 300, border: 0, shadow: false } }),
  );
  // Shadow is the difference between a card lifted off the page and one printed on it.
  assert.notEqual(
    perceptionOf({ frame: { radius: 12, border: 6, borderColor: "#FFFFFF", shadow: true } }),
    perceptionOf({ frame: { radius: 12, border: 6, borderColor: "#FFFFFF", shadow: false } }),
  );
  // A heavy desaturation is a different picture, not a different byte.
  assert.notEqual(
    perceptionOf({ photoTreatment: { saturation: 1.0 } }),
    perceptionOf({ photoTreatment: { saturation: 0.2 } }),
  );
});

test("perceptualSignature reads type scale, which geometryKey does not", () => {
  // The closing card is the case that forced this: it has no photo slots at all, so frame
  // and grade are both no-ops and type scale is the ONLY axis it can be differentiated on.
  const card = {
    id: "card",
    kind: "layer_scene",
    background: { type: "cream" },
    textSlots: [
      { id: "names", x: 260, y: 380, width: 1400, height: 220, align: "center", fontRole: "script_accent", sizePx: 140 },
    ],
  };
  const cardLibrary = { meta: { canvas: perceptionCanvas }, layouts: [card] };
  const setIn = (patch) => {
    const template = { id: "fixture", layoutPresets: {}, looks: { only: { layout: "card", layoutOverrides: { textSlots: { names: patch } } } } };
    const { scene } = resolveScene(
      { id: "probe", effect: "layer_scene", look: "only" },
      { template, library: cardLibrary },
    );
    return perceptualSignature(scene, template, cardLibrary, perceptionCanvas);
  };

  // 112px and 160px names are the corpus's real spread; they are not one picture.
  assert.notEqual(setIn({ sizePx: 112 }), setIn({ sizePx: 160 }));
  // Centred and left-ranged names read differently even at one size.
  assert.notEqual(setIn({ sizePx: 140, align: "center" }), setIn({ sizePx: 140, align: "left" }));
  // A script and a sans are not the same card.
  assert.notEqual(setIn({ fontRole: "script_accent" }), setIn({ fontRole: "body" }));
  // But a 2px nudge is still nobody's idea of a different design.
  assert.equal(setIn({ sizePx: 140 }), setIn({ sizePx: 142 }));
});

test("perceptualSignature always separates different compositions", () => {
  const dressing = { frame: { radius: 0, border: 10, borderColor: "#C9A86A", shadow: true } };
  assert.notEqual(
    perceptionOf(dressing, "pair"),
    perceptionOf(dressing, "pair_shifted"),
  );
});

test("perceptualSignature ignores frames on a full-bleed backdrop, as the renderer does", () => {
  // layerSceneBuilder paints the background slot without a frame, so naming one must not
  // invent a difference that never reaches the screen.
  assert.equal(
    perceptionOf({ frame: { radius: 40, border: 20, borderColor: "#000000", shadow: true } }, "bleed"),
    perceptionOf({}, "bleed"),
  );
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
