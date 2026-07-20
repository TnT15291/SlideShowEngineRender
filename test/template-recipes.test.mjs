import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
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

test("every template owns at least one advanced signature scene", () => {
  const advanced = new Set(["mask_reveal", "double_exposure", "video_background", "portrait_reflection", "floating_card_gallery", "moving_background_echo", "panel_flip"]);
  for (const recipe of recipes) {
    const signatures = recipe.scenes.filter((scene) => scene.signature);
    assert.ok(signatures.length, `${recipe.id} has no signature scene`);
    assert.ok(signatures.some((scene) => advanced.has(scene.effect) || scene.renderer === "remotion" || scene.renderer === "blender"), `${recipe.id} signature is not an advanced effect`);
  }
});

