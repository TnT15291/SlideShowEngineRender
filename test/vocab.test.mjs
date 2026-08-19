// The tag vocabulary is a whitelist enforced at two nodes and declared in two
// schemas. Code can import one definition (lib/vocab.mjs reads the schema), but a
// JSON Schema cannot import another — so story-plan.schema.json restates the list,
// and nothing but this test stops it drifting.
//
// Drift here is silent by construction: a tag accepted by the vision node and then
// dropped by the plan node does not raise an error, it just vanishes. That is the
// whole failure mode the vocabulary is supposed to prevent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { TAG_LIST, EMOTION_LIST } from "../scripts/lib/vocab.mjs";
import { EASING_EFFECTS } from "../scripts/lib/engineCapabilities.mjs";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

test("story-plan.schema.json's photoTags matches the canonical tag vocabulary", () => {
  const plan = readJson("schema/story-plan.schema.json");
  const planTags =
    plan.properties?.segments?.items?.properties?.photoTags?.items?.enum ??
    plan.$defs?.segment?.properties?.photoTags?.items?.enum;

  assert.ok(Array.isArray(planTags), "could not find photoTags enum in story-plan.schema.json");
  assert.deepEqual(
    [...planTags].sort(),
    [...TAG_LIST].sort(),
    "story-plan.schema.json has drifted from photo-content.schema.json — a tag accepted by the vision node would be dropped by the plan node, silently"
  );
});

test("the vocabulary can express a life before the wedding day", () => {
  // The original 22 tags were all wedding-DAY: a couple who met abroad and dated
  // for two years collapsed to `couple, candid, portrait`, and the story the
  // customer actually told became invisible to the director.
  for (const tag of ["everyday", "travel", "transit", "city", "selfie", "traditional_dress", "landmark"]) {
    assert.ok(TAG_LIST.includes(tag), `vocabulary lost "${tag}"`);
  }
});

test("emotions stay a closed set", () => {
  assert.deepEqual(
    [...EMOTION_LIST].sort(),
    ["calm", "celebratory", "joyful", "playful", "romantic", "solemn", "tender"],
    "the emotion vocabulary changed — check every oneOf() default that falls back to 'calm'"
  );
});

// SAME FAILURE SHAPE, DIFFERENT VOCABULARY. `easing` is legal on exactly the effects the
// engine drives with zoompan. src/types.ts owns that list for the renderer; a .mjs composer
// cannot import a .ts module, so scripts/lib/engineCapabilities.mjs restates it.
//
// It used to DERIVE it instead, from each effect's `motion` flag — and `motion` is wider:
// panel_flip moves without zoompan. So the composer wrote `easing: "snap"` onto panel_flip
// slides, validateTimeline rejected the film, and every `editorial_clean` Lite job failed
// before a frame was encoded. Nothing above the renderer could see it: the timeline was
// well-formed, the QA proxy never ran, the tier just could not be built.
test("engineCapabilities' EASING_EFFECTS matches the engine's EASED_MOTION_EFFECTS", () => {
  const types = fs.readFileSync("src/types.ts", "utf8");
  const block = types.match(/EASED_MOTION_EFFECTS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  assert.ok(block, "could not find EASED_MOTION_EFFECTS in src/types.ts — update this guard, do not delete it");
  const engine = [...block[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
  // A regex that silently matched nothing would make this test vacuous.
  assert.ok(engine.length >= 8, `parsed only ${engine.length} effects from src/types.ts`);
  assert.deepEqual([...EASING_EFFECTS].sort(), engine.sort(),
    "the composer would write `easing` onto slides the renderer refuses");
});
