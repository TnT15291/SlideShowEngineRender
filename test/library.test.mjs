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
import { rotatedSlotBounds } from "../scripts/lib/lookResolver.mjs";

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
const CANVAS_W = 1920;
const CANVAS_H = 1080;

const layoutCanvasOffenders = (layouts) => {
  const offenders = [];
  for (const layout of layouts ?? []) {
    for (const slot of layout.photoSlots ?? []) {
      if (slot.x == null || slot.y == null) continue;
      const bounds = rotatedSlotBounds(slot);
      if (bounds.x < 0 || bounds.y < 0 || bounds.right > CANVAS_W || bounds.bottom > CANVAS_H) {
        offenders.push(
          `${layout.id}.${slot.id} at ${slot.x},${slot.y} ${slot.width}x${slot.height} ` +
            `rotated ${slot.rotation ?? 0}° renders as ${bounds.width.toFixed(1)}x${bounds.height.toFixed(1)} — ` +
            `preflight will reject this and the render will fail`
        );
      }
    }
    for (const slot of layout.textSlots ?? []) {
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
  return offenders;
};

test("every layout in the library fits inside the canvas the engine renders", () => {
  const offenders = layoutCanvasOffenders(library.layouts);
  assert.deepEqual(offenders, [], `layouts that cannot render:\n  ${offenders.join("\n  ")}`);
});

test("the library canvas gate checks a primitive's rendered bounds after rotation", () => {
  const slot = { id: "tilted", x: 1600, y: 200, width: 300, height: 300, rotation: -30 };
  assert.ok(slot.x + slot.width <= CANVAS_W, "fixture raw rectangle must fit");
  assert.equal(layoutCanvasOffenders([{ id: "rotated_fixture", photoSlots: [slot] }]).length, 1);
});

test("coordinate metadata documents the same hard canvas boundary as validation", () => {
  const note = library.meta?.coordinateNote ?? "";
  assert.match(note, /x\/y must be non-negative/);
  assert.match(note, /bounding box after rotation.*stay inside the canvas/);
  assert.doesNotMatch(note, /negative x\/y intentionally/i);
});

test("circleMedallion is a true circle frame for a 520x520 slot", () => {
  assert.deepEqual(library.designTokens?.framePreset?.circleMedallion, {
    radius: 260,
    border: 10,
    borderColor: "#FFFFFF",
    shadow: true,
  });
});

test("seven active primitives are appended without reordering the original layouts", () => {
  const originalIds = [
    "hero_title_card",
    "text_left_photo_right",
    "photo_left_text_right",
    "three_photo_row",
    "two_photo_story",
    "collage_cluster_text",
    "full_bleed_quote",
    "polaroid_scatter",
    "closing_names",
    "paper_collage",
    "magazine_page_turn",
    "masonry_grid_wall",
    "duo_tinted_spread",
    "welcome_title_page",
    "invitation_row",
    "journey_duo",
    "polaroid_feature",
    "quad_grid_caption",
    "arch_trio",
    "feature_plus_duo",
    "save_date_card",
    "photo_grid_6",
    "photo_network_hero",
    "gallery_matte_hero",
    "photo_duo",
  ];
  const activeIds = [
    "overlap_stack_duo",
    "inset_card_hero",
    "circle_trio_stagger",
    "diagonal_staircase_trio",
    "golden_column_pair",
    "stacked_horizon_trio",
    "offset_portrait_hero",
  ];
  // 2026-08-01. Added where a recipe previously had no choice at all: photo counts 6 and 9
  // each had exactly ONE primitive, and a look cannot vary the count (lookResolver I1 pins
  // photoSlots.length because the photo budget is sized from it), so every recipe wanting a
  // six-up or nine-up beat landed on the same arrangement. Both keep an existing photo count
  // on purpose — a NEW count shifts the solver's budget, which is why offset_quad_pinwheel
  // and filmstrip_band sit in forbiddenPrimitives.
  const highCountAlternativeIds = [
    "stepped_gallery_six",
    "mosaic_nine_quilt",
  ];
  assert.deepEqual(
    library.layouts.map((layout) => layout.id),
    [...originalIds, ...activeIds, ...highCountAlternativeIds],
  );
  assert.equal(library.layouts.length, 34);
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
