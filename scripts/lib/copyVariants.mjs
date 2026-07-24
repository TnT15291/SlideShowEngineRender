// Deterministic per-field variant selection: a recipe scene may author `text`/
// `captionPattern` as an ARRAY of 2-3 equivalent lines instead of one string, so
// two couples buying the same template don't receive byte-identical wording.
// Selection must stay reproducible across re-renders of the SAME brief (same
// discipline as textCache.mjs) — no Math.random/Date.now anywhere here.

export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  // Plain FNV-1a's low bits barely mix — multiplying by an odd constant preserves
  // a simple XOR-parity chain in bit 0 — and `% 2` (the common case: a 2-option
  // variant array) reads exactly that weak bit. Two different couples could land
  // on identical picks for EVERY field at once off one shared low bit (observed
  // empirically, see test/copy-variants.test.mjs). Finish with murmur3's fmix32
  // avalanche so every output bit is a well-mixed function of the whole string
  // before anything reduces it mod N.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Pick one entry from an array-valued recipe field. `seed` identifies the
 *  customer (e.g. hashSeed of "bride|groom|date"); `key` identifies the FIELD
 *  (e.g. "sceneId:slotId") so different fields on the same customer don't all
 *  flip together off one global index. A non-array value passes through
 *  unchanged — every scene authored before this existed renders byte-for-byte
 *  the same as it always did. */
export function pickVariant(value, seed, key = "") {
  if (!Array.isArray(value)) return value;
  if (!value.length) return undefined;
  const fieldSeed = key ? hashSeed(`${seed}:${key}`) : seed;
  return value[fieldSeed % value.length];
}
