import assert from "node:assert/strict";
import test from "node:test";
import { assessFit, NATURAL_SEC_PER_PHOTO, MIN_COHERENT_PHOTOS } from "../scripts/lib/fitPlan.mjs";
import { FULL_SONG_MAX_SEC_PER_PHOTO } from "../scripts/lib/musicHighlight.mjs";

// A synthetic 200s track. The predicate only reads duration (+ phrases for the highlight),
// so a bare analysis is enough to exercise every regime boundary deterministically.
const music = { duration: 200, phrases: Array.from({ length: 26 }, (_, i) => ({ time: i * 8 })) };
const photos = (n) => Array.from({ length: n }, (_, i) => ({ file: `input/${i}.jpg` }));
const fit = (n, extra = {}) => assessFit({ music, photos: photos(n), ...extra });

test("a song and album in proportion ask no question", () => {
  const r = fit(Math.round(200 / NATURAL_SEC_PER_PHOTO)); // 50 photos ≈ 4s each
  assert.equal(r.regime, "balanced");
  assert.deepEqual(r.options, []);
});

test("too few photos recommends a highlight, not a stretched crawl", () => {
  const r = fit(23); // 8.7s/photo, past the 7.2 line
  assert.equal(r.regime, "few_photos");
  assert.equal(r.options[0].id, "highlight");
  assert.equal(r.options[0].recommended, true);
  assert.ok(r.options.some((o) => o.id === "full_song_stretch"), "the customer may still insist on the whole song");
});

test("the few/too-few boundary is the full-song carry line", () => {
  // Just above 7.2s/photo → few_photos; a count that still crawls but far worse → far_too_few.
  assert.equal(fit(Math.floor(200 / FULL_SONG_MAX_SEC_PER_PHOTO)).regime, "few_photos"); // 27
  assert.equal(fit(6).regime, "far_too_few_photos");
});

test("too many photos DEFAULTS to keeping them all — culling is offered, never taken", () => {
  const r = fit(120); // 1.67s/photo — montages absorb, but it is crowded
  assert.equal(r.regime, "many_photos");
  assert.equal(r.options[0].id, "keep_all", "keep_all must be the default");
  assert.equal(r.options[0].recommended, true);
  const cull = r.options.find((o) => o.id === "cull");
  assert.ok(cull, "a cull option is offered");
  assert.ok(!cull.recommended, "but the cull is never the recommended default");
});

test("an egregiously over-stuffed album recommends culling but still offers to keep all", () => {
  const r = fit(400); // 0.5s/photo
  assert.equal(r.regime, "far_too_many_photos");
  assert.equal(r.options[0].id, "cull");
  assert.equal(r.options[0].recommended, true);
  assert.ok(r.options.some((o) => o.id === "keep_all"), "keeping everything remains the customer's to choose");
});

test("an album too small for a bookended film is flagged, not silently padded", () => {
  const r = fit(MIN_COHERENT_PHOTOS - 1);
  assert.equal(r.regime, "too_few_for_a_film");
  assert.ok(r.options.some((o) => o.id === "add_photos"));
});

test("extra tracks turn 'extend the music' from a loop into a playlist", () => {
  const looped = fit(400);
  assert.ok(looped.options.some((o) => o.id === "loop"), "with one track, extending means looping it");
  const playlisted = fit(400, { extraTracks: 1 });
  assert.ok(playlisted.options.some((o) => o.id === "playlist"), "with another track, extending means playing it next");
  assert.ok(!playlisted.options.some((o) => o.id === "loop"), "a playlist is preferred over a loop when a second song exists");
});

test("a prompt that already chose the music mode pre-answers the question", () => {
  const orders = [{ kind: "music_mode", op: "set", target: "full_song", quote: "dùng trọn bài" }];
  const r = fit(23, { orders });
  assert.equal(r.preAnswered, true);
  assert.equal(r.evidence.preAnswered.target, "full_song");
});

test("feasibleBand is consistent with the regime it reports", () => {
  for (const n of [10, 27, 50, 100, 200, 400]) {
    const r = fit(n);
    const { min, max } = r.evidence.feasibleBand;
    if (r.regime === "balanced") assert.ok(n >= min && n <= max, `${n} balanced but outside band [${min},${max}]`);
    if (r.regime === "far_too_many_photos") assert.ok(n > max, `${n} far_too_many but within band max ${max}`);
  }
});
