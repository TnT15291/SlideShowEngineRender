// The look resolver is the single place a recipe's visual identity is merged onto the
// library's geometry (scripts/lib/lookResolver.mjs). Two things must hold forever:
// a recipe that declares no looks must resolve to exactly what it rendered before, and
// an override must never be able to change how many photos a scene costs.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  resolveScene, resolveTemplate, validateLook, visualSignature,
} from "../scripts/lib/lookResolver.mjs";
import { solveRecipeShotList } from "../scripts/lib/recipeShotList.mjs";
import { scenePhotoCount } from "../scripts/lib/scenePhotoCount.mjs";

const root = process.cwd();
const libraryPath = path.join(root, "layouts", "library.json");
const readLibrary = () => JSON.parse(fs.readFileSync(libraryPath, "utf8"));
const library = readLibrary();
const layoutById = (id) => library.layouts.find((l) => l.id === id);

const recipeFiles = fs.readdirSync(path.join(root, "story-templates")).filter((f) => f.endsWith(".json"));
const recipes = recipeFiles.map((f) => JSON.parse(fs.readFileSync(path.join(root, "story-templates", f), "utf8")));

const strip = (scene) => {
  const { resolvedLayout, resolvedFrame, resolvedTreatment, resolvedMotion, resolvedSignature, ...rest } = scene;
  return rest;
};

test("a recipe with no looks resolves to the library layout, unchanged", () => {
  for (const recipe of recipes) {
    const report = resolveTemplate(recipe, { library });
    assert.deepEqual(report.errors, [], `${recipe.id} produced resolver errors`);
    report.scenes.forEach((resolved, i) => {
      const authored = recipe.scenes[i];
      assert.deepEqual(strip(resolved), authored,
        `${recipe.id}/${authored.id}: resolving changed an authored field`);
      if (authored.effect !== "layer_scene") {
        assert.equal(resolved.resolvedLayout, undefined);
        return;
      }
      assert.deepEqual(resolved.resolvedLayout, layoutById(authored.layout),
        `${recipe.id}/${authored.id}: geometry drifted from the library layout`);
      assert.equal(resolved.resolvedSignature, `layer:${authored.layout}`);
    });
  }
});

test("resolving is idempotent", () => {
  for (const recipe of recipes) {
    for (const scene of recipe.scenes) {
      const once = resolveScene(scene, { template: recipe, library }).scene;
      const twice = resolveScene(once, { template: recipe, library }).scene;
      assert.deepEqual(twice, once, `${recipe.id}/${scene.id}`);
    }
  }
});

test("resolving never mutates the shared library", () => {
  for (const recipe of recipes) resolveTemplate(recipe, { library });
  assert.deepEqual(library, readLibrary(), "layouts/library.json was mutated in memory");
});

test("visualSignature matches the pre-looks definition for unresolved scenes", () => {
  assert.equal(visualSignature({ effect: "layer_scene", layout: "arch_trio" }), "layer:arch_trio");
  assert.equal(visualSignature({ renderer: "remotion", template: "confetti-bloom" }), "remotion:confetti-bloom");
  assert.equal(visualSignature({ effect: "dark_feather" }), "dark_feather");
});

test("the API's cheap composition count agrees with the resolver's real one", () => {
  // server/services/recipes.ts cannot import this module (it compiles with rootDir:server),
  // so it counts distinct `look ?? layout` instead of resolving geometry. That shortcut is
  // only sound because V7 refuses to lint a recipe whose two looks render alike. Pin the
  // agreement here, on every shipped recipe, so the two definitions cannot drift apart.
  for (const recipe of recipes) {
    const declared = new Set((recipe.scenes ?? [])
      .flatMap((scene) => (scene.look ?? scene.layout) ? [scene.look ?? scene.layout] : [])).size;
    const resolved = new Set(resolveTemplate(recipe, { library }).scenes
      .filter((scene) => scene.effect === "layer_scene")
      .map(visualSignature)).size;
    assert.equal(declared, resolved, `${recipe.id}: API would report ${declared} looks, the resolver sees ${resolved}`);
  }
});

// -- looks, on fixtures (the real recipes are migrated one at a time, later) ----------

const fixture = (looks, scenes) => ({
  id: "fixture-01",
  looks,
  scenes: scenes ?? [{ id: "s01", effect: "layer_scene", look: Object.keys(looks)[0] }],
});

test("a look overrides only the slots it names, and keeps the rest of the layout", () => {
  const base = layoutById("three_photo_row");
  const template = fixture({
    triptych: {
      layout: "three_photo_row",
      layoutOverrides: { photoSlots: { [base.photoSlots[1].id]: { y: 120, height: 840 } } },
      frame: { border: 3, borderColor: "#C5A363" },
    },
  });
  const { scenes, errors } = resolveTemplate(template, { library });
  assert.deepEqual(errors, []);
  const [scene] = scenes;
  assert.equal(scene.resolvedLayout.photoSlots[1].y, 120);
  assert.equal(scene.resolvedLayout.photoSlots[1].height, 840);
  assert.equal(scene.resolvedLayout.photoSlots[1].x, base.photoSlots[1].x, "untouched field changed");
  assert.deepEqual(scene.resolvedLayout.photoSlots[0], base.photoSlots[0], "unnamed slot changed");
  assert.deepEqual(scene.resolvedFrame, { border: 3, borderColor: "#C5A363" });
  assert.equal(scene.layout, "three_photo_row", "the layout id must survive for photoDemand");
  assert.match(scene.resolvedSignature, /^layer:three_photo_row#[0-9a-f]{8}$/);
});

test("V1: a look on an unknown layout is an error", () => {
  const { errors } = resolveTemplate(fixture({ ghost: { layout: "no_such_layout" } }), { library });
  assert.equal(errors.length >= 1, true);
  assert.match(errors[0].detail, /unknown layout/);
});

test("V2: a look may dress slots, not invent them", () => {
  const findings = validateLook("bad", {
    layout: "three_photo_row",
    layoutOverrides: { photoSlots: { fourth: { x: 0 } } },
  }, { template: {}, library });
  assert.equal(findings.some((f) => /does not have/.test(f.detail)), true);
});

test("V2: renaming a slot is refused (the photo budget reads slot ids)", () => {
  const base = layoutById("three_photo_row");
  const findings = validateLook("bad", {
    layout: "three_photo_row",
    layoutOverrides: { photoSlots: { [base.photoSlots[0].id]: { id: "renamed" } } },
  }, { template: {}, library });
  assert.equal(findings.some((f) => /not overridable/.test(f.detail)), true);
});

test("V3: an override can never change how many photos a scene costs", () => {
  const base = layoutById("three_photo_row");
  const template = fixture({
    triptych: {
      layout: "three_photo_row",
      layoutOverrides: { photoSlots: { [base.photoSlots[0].id]: { width: 400 } } },
    },
  });
  const { scenes } = resolveTemplate(template, { library });
  assert.equal(scenes[0].resolvedLayout.photoSlots.length, base.photoSlots.length);
});

test("V4: an override that leaves the canvas is an error", () => {
  const base = layoutById("three_photo_row");
  const findings = validateLook("bleed", {
    layout: "three_photo_row",
    layoutOverrides: { photoSlots: { [base.photoSlots[2].id]: { x: 1700, width: 600 } } },
  }, { template: {}, library });
  assert.equal(findings.some((f) => /off the 1920x1080 canvas/.test(f.detail)), true);
});

test("V5: an override that buries a text slot is an error", () => {
  const layout = library.layouts.find((l) => (l.textSlots || []).length && (l.photoSlots || []).length
    && l.background?.type !== "photo_full_bleed");
  const text = layout.textSlots[0];
  const findings = validateLook("smother", {
    layout: layout.id,
    layoutOverrides: {
      photoSlots: { [layout.photoSlots[0].id]: { x: text.x, y: text.y, width: text.width, height: text.height } },
    },
  }, { template: {}, library });
  assert.equal(findings.some((f) => /of text slot/.test(f.detail)), true, JSON.stringify(findings));
});

test("V6: a declared but unused look is a warning", () => {
  const template = fixture(
    { used: { layout: "three_photo_row" }, spare: { layout: "arch_trio" } },
    [{ id: "s01", effect: "layer_scene", look: "used" }],
  );
  const { warnings } = resolveTemplate(template, { library });
  assert.equal(warnings.some((w) => w.id === "spare" && /no scene uses it/.test(w.detail)), true);
});

test("V7: two looks that render identically are a warning, and share one signature", () => {
  const template = fixture(
    { a: { layout: "three_photo_row" }, b: { layout: "three_photo_row" } },
    [{ id: "s01", effect: "layer_scene", look: "a" }, { id: "s02", effect: "layer_scene", look: "b" }],
  );
  const { scenes, warnings } = resolveTemplate(template, { library });
  assert.equal(scenes[0].resolvedSignature, scenes[1].resolvedSignature);
  assert.equal(warnings.some((w) => /renders identically/.test(w.detail)), true);
});

test("an undressed look signs as the bare layout — it cannot inflate a look count", () => {
  const { scenes } = resolveTemplate(fixture({ plain: { layout: "arch_trio" } }), { library });
  assert.equal(scenes[0].resolvedSignature, "layer:arch_trio");
});

test("a scene naming an unknown look, or a look on a non-layout scene, is an error", () => {
  const missing = resolveScene({ id: "s01", effect: "layer_scene", look: "nope" },
    { template: { looks: {} }, library });
  assert.match(missing.errors[0].detail, /unknown look/);

  const wrongEffect = resolveScene({ id: "s02", effect: "dark_feather", look: "triptych" },
    { template: { looks: { triptych: { layout: "three_photo_row" } } }, library });
  assert.match(wrongEffect.errors[0].detail, /layer_scene geometry only/);
});

// -- the solver must carry a look across a swap, not just a layout id -----------------

test("a wordless recurrence adopts its muteFallback's LOOK, not bare library geometry", () => {
  // A one-photo layout on purpose: the point under test is the composition swap, and a
  // three-slot beat is simply unaffordable at this budget, so the solver would drop it.
  const base = layoutById("photo_left_text_right");
  const recipe = {
    id: "looks-fixture-01",
    looks: {
      tall: {
        layout: "photo_left_text_right",
        layoutOverrides: { photoSlots: { [base.photoSlots[0].id]: { width: 860, height: 900 } } },
      },
      matted: { layout: "photo_left_text_right", frame: { border: 8, borderColor: "#C5A363" } },
    },
    scenes: [
      { id: "open", effect: "still", photoSlots: [{ slot: "hero" }] },
      { id: "body", effect: "layer_scene", look: "tall", muteFallback: { look: "matted" }, text: { heading: "x" } },
      { id: "close", effect: "layer_scene", layout: "closing_names", durationRole: "closing" },
    ],
  };
  const resolved = resolveTemplate(recipe, { library });
  assert.deepEqual(resolved.errors, []);
  recipe.scenes = resolved.scenes;

  const { scenes } = solveRecipeShotList({
    recipe,
    photoCount: 24,
    musicDuration: 90,
    durationOf: () => 5,
    photoDemandOf: (scene) => scenePhotoCount(scene, { library }),
    resolveOf: (scene) => resolveScene(scene, { template: recipe, library }).scene,
    bodyPhotoBudget: 20,
  });

  const body = scenes.filter((scene) => scene.id.startsWith("body"));
  assert.ok(body.length >= 2, `expected the body beat to recur, got ${body.length}`);
  const [first, ...repeats] = body;
  assert.equal(first.look, "tall");
  assert.equal(first.resolvedLayout.photoSlots[0].height, 900);

  for (const repeat of repeats) {
    assert.equal(repeat.look, "matted", `${repeat.id} lost the recipe's look on a wordless repeat`);
    assert.deepEqual(repeat.resolvedFrame, { border: 8, borderColor: "#C5A363" });
    assert.notEqual(repeat.resolvedSignature, "layer:photo_left_text_right",
      `${repeat.id} fell back to bare library geometry`);
    assert.equal(scenePhotoCount(repeat, { library }), scenePhotoCount(first, { library }),
      "a look swap must never change what the beat costs");
  }
});

test("a scene that sets both a look and a conflicting layout is an error", () => {
  const template = { looks: { triptych: { layout: "three_photo_row" } } };
  const { errors } = resolveScene({ id: "s01", effect: "layer_scene", look: "triptych", layout: "arch_trio" },
    { template, library });
  assert.match(errors[0].detail, /drop one/);
});
