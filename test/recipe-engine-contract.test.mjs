// A recipe may not point at things the engine does not have.
//
// SCOPE, AND WHY IT IS THIS NARROW. An earlier version of this file also asserted that a
// recipe's montage `count` and `slot` matched the engine's caps — ten recipes violate that
// and it looked like a systemic bug. It is not one. recipeShotList does:
//
//     scene.photoSlots = [{ slot: VARIABLE_SLOT[scene.effect], count }]
//
// for every montage it emits, replacing the author's slot name AND their count with a
// budget-derived pair, on purpose ("as many photos as this beat can afford, never the 8 its
// author happened to type"). No recipe carries origin:"composed" to skip that path. So an
// authored montage count is inert, and a test policing it polices nothing — it would only
// have taught whoever tripped it to change a number that never mattered.
//
// What survives here is what the engine does NOT override, and therefore what it can still
// die on:
//   - a layout id, which buildLayerSceneFromLayout reads every coordinate from
//   - an effect, which nothing downstream can substitute for
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { MONTAGE_EFFECTS, SINGLE_PHOTO_EFFECTS } from "../scripts/lib/engineCapabilities.mjs";

const DIR = "story-templates";
const recipes = fs.readdirSync(DIR)
  .filter((f) => f.endsWith(".json"))
  .map((f) => ({ file: f, doc: JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")) }));

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
const layoutIds = new Set((library.layouts || []).map((l) => l.id));

test("every layer_scene names a layout the library actually has", () => {
  const missing = recipes.flatMap(({ file, doc }) =>
    (doc.scenes || [])
      .filter((s) => s.effect === "layer_scene" && !layoutIds.has(s.layout))
      .map((s) => `${file} ${s.id}: layout "${s.layout}" is not in layouts/library.json`)
  );

  // buildLayerSceneFromLayout reads every coordinate from the library, so an unknown layout
  // id is a scene with no geometry. It does not degrade to a default — it throws mid-build,
  // after the customer's job has already paid for analysis.
  assert.deepEqual(missing, [], `a recipe points at a layout that does not exist:\n  ${missing.join("\n  ")}`);
});

test("every scene uses an effect the engine can render", () => {
  const known = (e) =>
    MONTAGE_EFFECTS.has(e) || SINGLE_PHOTO_EFFECTS.has(e) ||
    ["layer_scene", "video_background", "mask_reveal"].includes(e);

  const unknown = recipes.flatMap(({ file, doc }) =>
    (doc.scenes || [])
      .filter((s) => !known(s.effect))
      .map((s) => `${file} ${s.id}: unknown effect "${s.effect}"`)
  );

  // The vocabulary is loaded from engineCapabilities, which derives it from the engine, so
  // this cannot drift from what the renderer will actually accept.
  assert.deepEqual(unknown, [], `a recipe names an effect the engine does not classify:\n  ${unknown.join("\n  ")}`);
});
