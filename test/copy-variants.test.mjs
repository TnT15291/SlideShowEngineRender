import assert from "node:assert/strict";
import test from "node:test";
import { hashSeed, pickVariant } from "../scripts/lib/copyVariants.mjs";

test("hashSeed is deterministic for the same string", () => {
  assert.equal(hashSeed("Linh|Nam|12.12.2026"), hashSeed("Linh|Nam|12.12.2026"));
});

test("pickVariant passes non-array values through unchanged", () => {
  assert.equal(pickVariant("hello", 123, "scene:slot"), "hello");
  assert.deepEqual(pickVariant({ value: "hi" }, 123, "scene:slot"), { value: "hi" });
  assert.equal(pickVariant(undefined, 123, "scene:slot"), undefined);
});

test("pickVariant is reproducible for the same seed and key", () => {
  const seed = hashSeed("Linh|Nam|12.12.2026");
  const a = pickVariant(["A", "B", "C"], seed, "s01:heading");
  const b = pickVariant(["A", "B", "C"], seed, "s01:heading");
  assert.equal(a, b);
});

// Regression: the first cut of this hash used plain FNV-1a, whose bit 0 is just
// the XOR-parity of every character in the string (multiplying by an odd
// constant preserves it). Field selection used `% 2` for the common 2-option
// case, so if two couples' seed strings happened to share that one parity bit,
// EVERY field in the film flipped identically together — confirmed with this
// exact pair of couples, which collided on all 7 fields of the real
// modern-teal-01 rollout before the murmur3 finalizer was added.
test("two different couples do not collapse to identical picks on every field", () => {
  const seedA = hashSeed("Linh|Nam|12.12.2026");
  const seedB = hashSeed("Thao|Duc|03.05.2027");
  const keys = [
    "s02_duo:captionPattern", "s04_journey:caption", "s04_journey:heading:value",
    "s04b_teal_glass:captionPattern", "s05_breath:quote",
    "s07b_geometric:captionPattern", "s07c_mirror:captionPattern",
  ];
  const picksA = keys.map((k) => pickVariant(["variant-0", "variant-1"], seedA, k));
  const picksB = keys.map((k) => pickVariant(["variant-0", "variant-1"], seedB, k));
  assert.ok(picksA.some((p, i) => p !== picksB[i]),
    "expected at least one field to diverge between two different couples");
});

test("different fields on the SAME couple are not forced to agree", () => {
  const seed = hashSeed("Linh|Nam|12.12.2026");
  const picks = new Set(
    Array.from({ length: 8 }, (_, i) => pickVariant(["variant-0", "variant-1"], seed, `scene${i}:slot`))
  );
  assert.ok(picks.size > 1, "expected at least two distinct picks across 8 independent fields");
});

test("pickVariant on an empty array is undefined, not a crash", () => {
  assert.equal(pickVariant([], 1, "k"), undefined);
});
