// The shot list must be a function of the inputs. Three jobs, three answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { composeStoryboard, planSceneCount, applySignatureHybridScene } from "../scripts/lib/storyboard.mjs";
import { makeEnergy } from "../scripts/lib/pacing.mjs";
import { MOTION_EFFECTS } from "../scripts/lib/engineCapabilities.mjs";

const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));

/** A flat-energy track of the given length. */
const track = (seconds) =>
  makeEnergy({ duration: seconds, envelope: Array(Math.round(seconds / 0.5)).fill(0.5) });

const photosIn = (sb) => sb.scenes.reduce((n, s) => n + s.photos, 0);
const filmLength = (sb) =>
  sb.scenes.reduce((n, s) => n + s.duration, 0) -
  sb.scenes.slice(0, -1).reduce((n, s) => n + (s.xfade || 0), 0);

test("photo-poor: 23 photos, 203s — every photo used once, and the song is covered", () => {
  const sb = composeStoryboard({ photoCount: 23, musicDuration: 203, energy: track(203), library });

  assert.equal(sb.fit.boundBy, "photos", "with 23 photos the photo set, not the song, is the constraint");
  assert.ok(photosIn(sb) <= 23, `shot list demands ${photosIn(sb)} photos, only 23 exist`);

  // The old generator asked for 42 slots against 23 photos and showed one of them
  // eight times. Nothing here may exceed the budget.
  for (const s of sb.scenes) {
    assert.ok(s.photos <= 4, `scene ${s.id} wants ${s.photos} photos — a montage cannot be afforded here`);
  }

  const film = filmLength(sb);
  assert.ok(Math.abs(film - 203) < 12, `film is ${film.toFixed(0)}s against a 203s track`);
  assert.ok(sb.fit.scale > 1, "a photo-poor job must stretch its scenes, not end early");
});

test("photo-rich: 200 photos, 200s — scenes hold several photos each, nothing is wasted", () => {
  const sb = composeStoryboard({ photoCount: 200, musicDuration: 200, energy: track(200), library });

  assert.equal(sb.fit.boundBy, "music", "with 200 photos the song is the constraint");
  assert.ok(sb.fit.budgetSecondsPerPhoto < 1.5, "a photo-rich job has a tight per-photo budget");

  // Scenes must now carry many photos, or most of the set never appears.
  const avg = photosIn(sb) / sb.scenes.length;
  assert.ok(avg > 3, `scenes average ${avg.toFixed(1)} photos — too few for 200 photos in 200s`);

  const film = filmLength(sb);
  assert.ok(Math.abs(film - 200) < 12, `film is ${film.toFixed(0)}s against a 200s track`);
});

test("the fit report speaks up when the photo set cannot carry the song", () => {
  const sb = composeStoryboard({ photoCount: 6, musicDuration: 240, energy: track(240), library });
  assert.equal(sb.fit.verdict, "too_few_photos");
  assert.match(sb.fit.message, /Add photos|shorter track/);
});

test("scene count follows music length, not a constant", () => {
  const short = composeStoryboard({ photoCount: 60, musicDuration: 60, energy: track(60), library });
  const long = composeStoryboard({ photoCount: 60, musicDuration: 240, energy: track(240), library });
  assert.ok(
    long.scenes.length > short.scenes.length,
    `60s gave ${short.scenes.length} scenes and 240s gave ${long.scenes.length} — the count is not responding to the music`
  );
});

test("layouts rotate — a 23-scene film is not 23 copies of one frame", () => {
  const sb = composeStoryboard({ photoCount: 23, musicDuration: 203, energy: track(203), library });
  const used = new Set(sb.scenes.map((s) => s.layout || s.effect).filter(Boolean));
  assert.ok(used.size >= 3, `only ${used.size} distinct visual treatment(s) across ${sb.scenes.length} scenes`);
});

test("the film always ends on a closing card, and the closing card never stretches", () => {
  for (const d of [60, 203, 300]) {
    const sb = composeStoryboard({ photoCount: 40, musicDuration: d, energy: track(d), library });
    const last = sb.scenes.at(-1);
    assert.equal(last.id, "s99_closing");
    assert.equal(last.photos, 0);
    assert.equal(last.duration, 8, "a full stop does not get longer because the song did");
  }
});

// ---------------------------------------------------------------------------
// MONOTONY IS A BUG, AND THESE ARE THE ASSERTIONS THAT SAY SO.
//
// The composer passed every test above while emitting 23 scenes that were all layer_scene,
// on a three-layout rotation, each holding one photo for ten seconds: A-B-C-A-B-C. Every
// property the suite checked — photo budget, film length, scene count — was correct. The
// film was still unwatchable, and it looked cheaper than the template tier.
//
// "Distinct treatments >= 3" was the only variety check there was, and three layouts on
// endless rotation passes it. So the bar moves here: an effect vocabulary, a mix of scene
// shapes, and a duration curve that is not flat.

test("the engine has 29 effects — a premium film may not be built from one", () => {
  const sb = composeStoryboard({ photoCount: 23, musicDuration: 203, energy: track(203), library });
  const effects = new Set(sb.scenes.map((s) => s.effect));

  assert.ok(
    effects.size >= 4,
    `the whole film is made of ${[...effects].join(", ")} — ${effects.size} effect(s) across ${sb.scenes.length} scenes`
  );

  // The specific failure: layer_scene is the only effect that can carry text, and it is the
  // only one that cannot move. A film made mostly of it is a slideshow of captioned cards.
  const cards = sb.scenes.filter((s) => s.effect === "layer_scene").length;
  assert.ok(
    cards / sb.scenes.length < 0.65,
    `${cards} of ${sb.scenes.length} scenes are text cards — that is a slideshow, not a film`
  );

  // A photo-poor job holds each frame for many seconds. A frame that does not move over an
  // eight-second hold is dead air, so most single-photo scenes must be motion effects.
  const singles = sb.scenes.filter((s) => s.effect !== "layer_scene" && s.photos === 1);
  const moving = singles.filter((s) => MOTION_EFFECTS.includes(s.effect));
  assert.ok(
    singles.length === 0 || moving.length >= singles.length / 2,
    `${singles.length - moving.length} of ${singles.length} held frames are static on a ${sb.fit.budgetSecondsPerPhoto}s/photo budget`
  );
});

test("no two neighbouring scenes are the same frame", () => {
  const sb = composeStoryboard({ photoCount: 60, musicDuration: 180, energy: track(180), library });
  for (let i = 1; i < sb.scenes.length; i++) {
    const a = sb.scenes[i - 1], b = sb.scenes[i];
    assert.ok(
      !(a.effect === b.effect && a.layout === b.layout && a.effect !== "layer_scene"),
      `scenes ${a.id} and ${b.id} are both ${b.effect}${b.layout ? ` / ${b.layout}` : ""}`
    );
  }
});

test("the rhythm is bimodal: frames that breathe, montages that sweep", () => {
  // 120 photos over 200s is 1.7s/photo. Spending them one per scene would leave most of
  // the set on the floor; spending them evenly makes every scene identical. Neither is a
  // film. The surplus belongs in a few montage beats.
  const sb = composeStoryboard({ photoCount: 120, musicDuration: 200, energy: track(200), library });

  const montages = sb.scenes.filter((s) => s.photos >= 4);
  assert.ok(montages.length >= 2, `only ${montages.length} montage beat(s) for 120 photos in 200s`);

  const singles = sb.scenes.filter((s) => s.photos === 1);
  assert.ok(singles.length >= 2, "a film of nothing but montages has no place to breathe");

  // And the surplus must actually be SPENT — the point of concentrating it is to use it.
  assert.ok(
    photosIn(sb) >= 120 * 0.9,
    `${photosIn(sb)} of 120 photos placed — the couple's photographs are being left on the floor`
  );
});

test("scene durations follow the shape, not a constant", () => {
  const sb = composeStoryboard({ photoCount: 120, musicDuration: 200, energy: track(200), library });
  const body = sb.scenes.filter((s) => s.id !== "s99_closing");
  const spread = Math.max(...body.map((s) => s.duration)) - Math.min(...body.map((s) => s.duration));

  // Every premium scene used to come out within a tenth of a second of every other, because
  // the durations were re-derived downstream from a flat table. A montage of eight photos
  // cannot land in the same five seconds as a single held portrait.
  assert.ok(spread > 1.5, `every scene runs within ${spread.toFixed(2)}s of every other — the film has no rhythm`);
});

test("planSceneCount: the binding constraint is named, not guessed", () => {
  const poor = planSceneCount({ photoCount: 10, musicDuration: 200, avgBase: 5.8 });
  assert.equal(poor.bound, "photos");
  assert.equal(poor.scenes, 10, "cannot make more scenes than there are photos to fill them");

  const rich = planSceneCount({ photoCount: 500, musicDuration: 120, avgBase: 5.8 });
  assert.equal(rich.bound, "music");
  assert.ok(rich.photosPerScene > 1, "a photo-rich job must pack photos into each scene");
});

// ---------------------------------------------------------------------------
// A SIGNATURE HYBRID SCENE IS ONE SWAP, NOT A SECOND PALETTE. The Blender-backed templates
// cost minutes per scene instead of seconds, so the substitution must never change scene
// count, photo count or total duration — only which scene, and which renderer, draws one
// already-decided single-photo beat.

test("signature hybrid scene replaces exactly the peak-energy single-photo scene", () => {
  const sb = composeStoryboard({ photoCount: 40, musicDuration: 180, energy: track(180), library });
  const before = { count: sb.scenes.length, photos: photosIn(sb), duration: filmLength(sb) };

  const singlePhotoScenes = sb.scenes.filter((s) => !s.layout && s.photos === 1 && s.id !== "s99_closing");
  const peak = singlePhotoScenes.reduce((a, b) => (b.energy > a.energy ? b : a));

  const scenes = applySignatureHybridScene(sb.scenes, { template: "confetti_bloom", renderer: "remotion" });

  assert.equal(scenes.length, before.count, "substitution must not change scene count");
  assert.equal(scenes.reduce((n, s) => n + s.photos, 0), before.photos, "substitution must not change photo count");
  assert.equal(filmLength({ scenes }), before.duration, "substitution must not change total film length");

  const swapped = scenes.filter((s) => s.renderer);
  assert.equal(swapped.length, 1, "exactly one scene is substituted");
  assert.equal(swapped[0].id, peak.id, "the substituted scene is the one with peak energy");
  assert.equal(swapped[0].renderer, "remotion");
  assert.equal(swapped[0].template, "confetti_bloom");
  assert.equal(swapped[0].effect, "still", "effect stays the schema's back-compat placeholder");
  assert.ok(!("easing" in swapped[0]), "easing computed for the old effect must not survive the swap");
});

test("signature hybrid scene is a no-op without a template, and skips gracefully with no candidate", () => {
  const sb = composeStoryboard({ photoCount: 40, musicDuration: 180, energy: track(180), library });
  assert.deepEqual(applySignatureHybridScene(sb.scenes, {}), sb.scenes);
  assert.deepEqual(applySignatureHybridScene(sb.scenes, { template: null, renderer: null }), sb.scenes);

  const noSingles = sb.scenes.map((s) => ({ ...s, effect: "layer_scene" }));
  const result = applySignatureHybridScene(noSingles, { template: "confetti_bloom", renderer: "remotion" });
  assert.deepEqual(result, noSingles, "with no single-photo scene to carry it, the shot list is returned unchanged");
});
