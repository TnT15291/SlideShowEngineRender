import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { selectRepresentativeSlide } from "../scripts/generateRecipeThumbnails.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const image = () => ({ type: "image", path: "demo.jpg" });
const text = () => ({ type: "text", text: "Demo" });

test("recipe thumbnail selection prefers a rich authored composition", () => {
  const selected = selectRepresentativeSlide({ slides: [
    { id: "s01_plain", effect: "layer_scene", editorialBeat: "opening", layers: [image()] },
    { id: "s02_story", effect: "layer_scene", editorialBeat: "story", layers: [image(), image(), image(), text()] },
    { id: "s83_gallery_matte", effect: "layer_scene", editorialBeat: "story", layers: [image(), image(), image(), image(), text(), text()] },
    { id: "s02_story_r1", effect: "layer_scene", editorialBeat: "story", layers: [image(), image(), image(), image(), text(), text()] },
    { id: "closing", effect: "layer_scene", editorialBeat: "closing", layers: [image(), text(), text()] },
  ] });
  assert.equal(selected.id, "s02_story");
});

test("recipe thumbnail selection falls back to any image slide", () => {
  const selected = selectRepresentativeSlide({ slides: [
    { id: "effect", effect: "still", layers: [image()] },
  ] });
  assert.equal(selected.id, "effect");
});

test("a recipe can art-direct its representative scene", () => {
  const selected = selectRepresentativeSlide({ slides: [
    { id: "automatic", effect: "layer_scene", layers: [image(), image(), image(), text()] },
    { id: "preferred", effect: "layer_scene", layers: [image()] },
  ] }, "preferred");
  assert.equal(selected.id, "preferred");
});

test("every recipe ships a non-empty JPEG preview", () => {
  const recipeIds = fs.readdirSync(path.join(root, "story-templates"))
    .filter((file) => file.endsWith(".json"))
    .map((file) => path.basename(file, ".json"))
    .sort();
  const previewDir = path.join(root, "apps", "web", "public", "recipe-previews");
  const previewIds = fs.readdirSync(previewDir)
    .filter((file) => file.endsWith(".jpg"))
    .map((file) => path.basename(file, ".jpg"))
    .sort();

  assert.deepEqual(previewIds, recipeIds);
  for (const id of recipeIds) {
    const preview = fs.readFileSync(path.join(previewDir, `${id}.jpg`));
    assert.ok(preview.length > 10_000, `${id} preview is unexpectedly small`);
    assert.deepEqual([...preview.subarray(0, 2)], [0xff, 0xd8], `${id} preview is not JPEG`);
  }
});
