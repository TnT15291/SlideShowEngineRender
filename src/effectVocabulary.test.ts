import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { EFFECT_PRESETS } from "./types";

test("schema/timeline.schema.json's effect enum matches EFFECT_PRESETS exactly", () => {
  const schemaPath = path.resolve(process.cwd(), "schema", "timeline.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  const schemaEffects: unknown = schema.$defs?.effect?.enum;

  assert.ok(Array.isArray(schemaEffects), "schema.$defs.effect.enum must be an array");
  // Two independent artifacts describing the same vocabulary — TS can't
  // generate JSON Schema at build time, so this test is the sync guard
  // instead of a shared source. A mismatch means one was edited without
  // the other, which used to fail silently (see types.ts's EFFECT_PRESETS).
  assert.deepEqual(schemaEffects, EFFECT_PRESETS, "schema effect enum drifted from src/types.ts EFFECT_PRESETS");
});
