// The layout library is a menu the AI orders from. An entry that cannot render is
// worse than a missing one: it sits there looking available until something picks
// it, and then the whole job fails at the very last step — the render.
//
// Two entries were exactly that. text_left_photo_right and photo_left_text_right
// placed their photo at y=-66 with a height of 1175 on a 1080-tall canvas, which
// the engine's preflight refuses (off-canvas bleed, a rule added after a real
// bug). No hand-written recipe had ever used them, so nothing had ever tried.
// composeStoryboard picks layouts by photo count rather than by taste, reached for
// them immediately, and the render died.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
const CANVAS_W = 1920;
const CANVAS_H = 1080;

test("every layout in the library fits inside the canvas the engine renders", () => {
  const offenders = [];
  for (const layout of library.layouts ?? []) {
    for (const slot of [...(layout.photoSlots ?? []), ...(layout.textSlots ?? [])]) {
      if (slot.x == null || slot.y == null) continue; // slots without geometry inherit it
      const right = slot.x + (slot.width ?? 0);
      const bottom = slot.y + (slot.height ?? 0);
      if (slot.x < 0 || slot.y < 0 || right > CANVAS_W || bottom > CANVAS_H) {
        offenders.push(
          `${layout.id}.${slot.id} at ${slot.x},${slot.y} ${slot.width}x${slot.height} — ` +
            `preflight will reject this and the render will fail`
        );
      }
    }
  }
  assert.deepEqual(offenders, [], `layouts that cannot render:\n  ${offenders.join("\n  ")}`);
});

test("every layout declares the slot ids a recipe is allowed to fill", () => {
  for (const layout of library.layouts ?? []) {
    for (const slot of layout.textSlots ?? []) {
      assert.ok(slot.id, `${layout.id} has a text slot with no id — a recipe could never address it`);
    }
    for (const slot of layout.photoSlots ?? []) {
      assert.ok(slot.id, `${layout.id} has a photo slot with no id`);
    }
  }
});

test("the library can serve every photo count the composer asks for", () => {
  // composeStoryboard buckets layouts by photo count and needs a 0 (the closing
  // card) and at least one single-photo layout, or a photo-poor job has nothing
  // to fall back to and would be forced into reusing photos.
  const counts = new Set((library.layouts ?? []).map((l) => (l.photoSlots ?? []).length));
  assert.ok(counts.has(0), "no zero-photo layout — the film has no closing card");
  assert.ok(counts.has(1), "no single-photo layout — a photo-poor job cannot avoid reuse");
});
