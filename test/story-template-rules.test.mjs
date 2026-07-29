// Every story template must satisfy the authoring rules — the same gate
// scripts/lintStoryTemplates.mjs runs by hand. A template that fails here fails on
// every job it will ever run, so the failure belongs in CI, not in a customer render.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { evaluateStoryTemplate } from "../scripts/lib/rules/templateRules.mjs";

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
const dir = "story-templates";

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
  test(`story template ${file} passes the authoring rules`, () => {
    const template = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const report = evaluateStoryTemplate(template, { library });
    const detail = report.errors.map((e) => `${e.check} [${e.id}] ${e.detail}`).join("\n  ");
    assert.equal(report.errors.length, 0, `authoring rule violations:\n  ${detail}`);
  });
}

// -- the rules must judge RESOLVED geometry, not the authored layout id ---------------

const checksFor = (template, id) =>
  evaluateStoryTemplate(template, { library }).errors.filter((e) => e.id === id).map((e) => e.check);

test("a look that shrinks a slot is measured, even on a layout already seen", () => {
  // The geometry rules are memoised. Keyed on the layout id, this second scene would be
  // waved through on the FIRST scene's coordinates -- 551x551 slots that pass the area
  // floor -- while rendering 100x100 ones that do not. Keyed on the resolved signature,
  // it is measured.
  const template = {
    id: "fixture-coverage",
    looks: {
      tiny: {
        layout: "three_photo_row",
        layoutOverrides: { photoSlots: { left: { width: 100, height: 100 } } },
      },
    },
    scenes: [
      { id: "plain", effect: "layer_scene", layout: "three_photo_row" },
      { id: "shrunk", effect: "layer_scene", look: "tiny" },
    ],
  };
  assert.equal(checksFor(template, "plain").includes("photo_coverage"), false);
  assert.equal(checksFor(template, "shrunk").includes("photo_coverage"), true,
    "an overridden slot escaped the coverage floor");
});

test("a stand-in must name a look or a layout, not both, and the look must exist", () => {
  const base = {
    id: "fixture-fallback",
    looks: { plain: { layout: "photo_duo" } },
    scenes: [{
      id: "body", effect: "layer_scene", layout: "photo_left_text_right", text: { heading: "x" },
      muteFallback: { look: "plain", layout: "photo_duo" },
    }],
  };
  assert.equal(checksFor(base, "body").includes("look_fallback_shape"), true);

  const unknown = structuredClone(base);
  unknown.scenes[0].muteFallback = { look: "no_such_look" };
  assert.equal(checksFor(unknown, "body").includes("look_reachable"), true);
});

test("a muteFallback named as a look is accepted, and costed through the resolver", () => {
  const template = {
    id: "fixture-fallback-ok",
    looks: { quiet: { layout: "full_bleed_quote" } },
    scenes: [{
      id: "body", effect: "layer_scene", layout: "photo_left_text_right", text: { heading: "x" },
      muteFallback: { look: "quiet", photoSlots: [{ slot: "bg", orient: "any", fit: "cover" }] },
    }],
  };
  assert.deepEqual(checksFor(template, "body"), [],
    "a look-shaped muteFallback was rejected where a layout-shaped one is accepted");
});
