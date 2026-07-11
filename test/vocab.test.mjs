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
