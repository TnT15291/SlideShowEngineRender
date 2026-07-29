import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildPhotoAssignmentRequests } from "../scripts/lib/templatePhotoRequests.mjs";
import { resolveTemplate, visualSignature } from "../scripts/lib/lookResolver.mjs";

const root = process.cwd();
const library = JSON.parse(fs.readFileSync(path.join(root, "layouts", "library.json"), "utf8"));
const recipes = fs.readdirSync(path.join(root, "story-templates"))
  .filter((file) => file.endsWith(".json"))
  .map((file) => JSON.parse(fs.readFileSync(path.join(root, "story-templates", file), "utf8")));

test("default template overlays leave the photographs in control", () => {
  for (const recipe of recipes) {
    const overlays = recipe.defaults?.overlays || [];
    const totalOpacity = overlays.reduce((sum, overlay) => sum + (overlay.opacity ?? 1), 0);
    assert.ok(
      totalOpacity <= 0.3,
      `${recipe.id} stacks ${totalOpacity.toFixed(2)} opacity across its full-film overlays`,
    );
  }
});
test("authored special transitions stay inside their own grammar limits", () => {
  for (const recipe of recipes) {
    const limits = recipe.transitionGrammar?.limits || {};
    for (const [role, limit] of Object.entries(limits)) {
      const count = recipe.scenes.filter((scene) => scene.transitionRole === role).length;
      assert.ok(count <= limit, `${recipe.id} authors ${count} ${role} beats but caps them at ${limit}`);
    }
  }
});

test("six-frame montage recipes author all six supported photo slots", () => {
  const sixFrameEffects = new Set(["collage_grid", "memory_wall"]);
  for (const recipe of recipes) {
    for (const scene of recipe.scenes.filter((item) => sixFrameEffects.has(item.effect))) {
      const slot = scene.photoSlots?.[0];
      assert.equal(
        slot?.count,
        6,
        `${recipe.id}/${scene.id} authors ${slot?.count ?? 0} photos for ${scene.effect}; expected 6`,
      );
    }
  }
});

test("fixed montage grids keep their authored photo count under gentle pacing", () => {
  const scene = {
    id: "six-grid",
    effect: "collage_grid",
    photoSlots: [{ slot: "grid", count: 6, fixedCount: true }],
  };
  const [request] = buildPhotoAssignmentRequests({
    scenes: [scene],
    library: { layouts: [] },
    direction: { pacing: { controls: { montagePhotoMultiplier: 0.8 } } },
  });
  assert.equal(request.count, 6);
});

// Both of these ask "how many different PICTURES", so both resolve the recipe first: a
// scene may name its composition through a look rather than a layout, and two recipes on
// one layout are two different pictures once their own looks dress it.
const resolved = new Map(recipes.map((recipe) =>
  [recipe.id, resolveTemplate(recipe, { library }).scenes]));

test("every recipe offers at least seven distinct authored layout looks", () => {
  for (const recipe of recipes) {
    const looks = new Set(
      resolved.get(recipe.id)
        .filter((scene) => scene.effect === "layer_scene")
        .map(visualSignature),
    );
    assert.ok(
      looks.size >= 7,
      `${recipe.id} has ${looks.size} authored layout looks; expected at least 7`,
    );
  }
});

test("scalable gallery tails do not collapse back to one shared look sequence", () => {
  const signatures = recipes.map((recipe) => {
    const tail = resolved.get(recipe.id)
      .filter((scene) => /^s8[345]_/.test(scene.id))
      .map(visualSignature);
    assert.equal(tail.length, 3, `${recipe.id} must author three scalable tail looks`);
    return tail.join(" > ");
  });
  const clashes = signatures.filter((s, i) => signatures.indexOf(s) !== i);
  assert.deepEqual(
    clashes, [],
    `every recipe must own a distinct scalable gallery look sequence; shared: ${[...new Set(clashes)].join(" | ")}`,
  );
});

test("every template owns two or three advanced signature scenes", () => {
  const advanced = new Set(["mask_reveal", "double_exposure", "video_background", "portrait_reflection", "floating_card_gallery", "moving_background_echo", "panel_flip"]);
  for (const recipe of recipes) {
    const signatures = recipe.scenes.filter((scene) => scene.signature);
    const hybrids = recipe.scenes.filter((scene) => scene.renderer && scene.template);
    assert.ok(hybrids.length >= 2 && hybrids.length <= 3, `${recipe.id} has ${hybrids.length} hybrid signature scenes; expected 2-3`);
    assert.ok(signatures.some((scene) => advanced.has(scene.effect) || scene.renderer === "remotion" || scene.renderer === "blender"), `${recipe.id} signature is not an advanced effect`);
  }
});

test("recipe copy includes captionPattern in the language rewrite contract", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recipe-copy-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const recipePath = path.join(dir, "recipe.json");
  const outPath = path.join(dir, "copy.json");
  fs.writeFileSync(recipePath, JSON.stringify({
    id: "caption-contract",
    name: "Caption Contract",
    scenes: [{
      id: "s01",
      captionPattern: ["Canned caption A", "Canned caption B"],
      text: { heading: ["Canned heading A", "Canned heading B"], names: "{{bride}} & {{groom}}" },
    }],
  }));
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  const run = spawnSync(process.execPath, [
    "scripts/writeRecipeCopy.mjs",
    "--recipe", recipePath,
    "--out", outPath,
    "--language", "vi",
  ], { cwd: root, env, encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const copy = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(copy.totalSlots, 2);
  assert.equal(copy.factSlotsWithheld, 1);
  assert.equal(copy.scenes.s01.captionPattern, "Canned caption A");
});

