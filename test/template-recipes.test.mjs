import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
  const advanced = new Set(["mask_reveal", "double_exposure", "video_background"]);
  for (const recipe of recipes) {
    const signatures = recipe.scenes.filter((scene) => scene.signature);
    assert.ok(signatures.length, `${recipe.id} has no signature scene`);
    assert.ok(signatures.some((scene) => advanced.has(scene.effect)), `${recipe.id} signature is not an advanced effect`);
  }
});

test("every recipe and pacing variant can budget the regression album", () => {
  const gallery = path.join(root, "analysis", "regression-gallery");
  const photos = path.join(root, "analysis", "photos.json");
  const music = path.join(root, "music", "a thousand years.mp3");
  if (!fs.existsSync(photos) || !fs.existsSync(music)) return;

  const result = spawnSync(process.execPath, [
    "scripts/generateRegressionGallery.mjs", "--dry-run",
    "--out-dir", gallery,
  ], { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(path.join(gallery, "gallery.json"), "utf8"));
  for (const entry of report.entries) {
    const timelinePath = path.isAbsolute(entry.timeline) ? entry.timeline : path.join(root, entry.timeline);
    const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
    assert.ok(timeline.slides.some((slide) => slide.signature), `${entry.id} preview lost its signature scene`);
  }
});
