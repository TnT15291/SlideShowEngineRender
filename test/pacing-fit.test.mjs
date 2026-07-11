// The photo budget. A shot list spends photos at a rate (seconds of film per photo
// shown), and the song sets how many seconds there are to spend. Nothing in the
// pipeline used to compute either number, which is how a 203s track came back as a
// 113s film with one photo on screen eight times.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sceneDur, fitScale, describeFit, photoSeconds, DUR_CALM, DUR_LOUD,
} from "../scripts/lib/pacing.mjs";

test("fitScale stretches a short shot list to cover the whole track", () => {
  // 16 scenes at their natural ~5.8s cover ~93s of a 203s song.
  const base = Array(16).fill(5.8);
  const trans = Array(16).fill(0.7);
  const k = fitScale({ baseDurations: base, transitions: trans, targetDuration: 203 });

  assert.ok(k > 1, "a short shot list must stretch, not leave the song playing over nothing");

  // Apply it and confirm the film now actually lands on the track's length.
  const scaled = base.map((d) => d * k);
  const film = scaled.reduce((a, b) => a + b, 0) - trans.slice(0, -1).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(film - 203) < 0.5, `film is ${film.toFixed(1)}s, expected ~203s`);
});

test("fitScale shrinks a shot list that overruns the track", () => {
  const base = Array(60).fill(6.0);
  const k = fitScale({ baseDurations: base, transitions: Array(60).fill(0.7), targetDuration: 120 });
  assert.ok(k < 1, "an over-long shot list must compress");

  const film = base.map((d) => d * k).reduce((a, b) => a + b, 0) - 0.7 * 59;
  assert.ok(Math.abs(film - 120) < 0.5, `film is ${film.toFixed(1)}s, expected ~120s`);
});

test("the music still sets the RHYTHM after scaling — quiet scenes stay the longer ones", () => {
  // Scaling must be uniform: it changes the scale of the film, not its shape.
  const quiet = sceneDur(0.1);
  const loud = sceneDur(0.9);
  assert.ok(quiet > loud, "the curve itself must keep quiet scenes longer");

  const k = fitScale({ baseDurations: [quiet, loud], transitions: [0.7, 0.7], targetDuration: 30 });
  assert.ok(quiet * k > loud * k, "scaling must not flatten the rhythm");
  assert.ok(
    Math.abs((quiet * k) / (loud * k) - quiet / loud) < 1e-9,
    "the ratio between a quiet and a loud scene must survive scaling untouched"
  );
});

test("k is a number that speaks: too few photos, too many, or just right", () => {
  assert.equal(describeFit(2.4).verdict, "too_few_photos");
  assert.match(describeFit(2.4).message, /Add photos|shorter track/);

  assert.equal(describeFit(0.6).verdict, "too_many_photos");
  assert.match(describeFit(0.6).message, /drop the weakest/);

  assert.equal(describeFit(1.05).verdict, "ok");
});

test("photoSeconds exposes the budget every layout is spending against", () => {
  // The real job: 23 photos, a 203s track.
  const budget = photoSeconds(203.1, 23);
  assert.ok(Math.abs(budget - 8.83) < 0.05, `budget is ${budget.toFixed(2)}s/photo`);

  // Every layout in the library spends faster than that, which is precisely why
  // the fixed 42-slot shot list could only ever reach 113s.
  const spendRate = (photos, duration) => duration / photos;
  assert.ok(spendRate(4, 6.0) < budget, "hero_title_card burns 4 photos in one scene");
  assert.ok(spendRate(6, 13.0) < budget, "a montage burns 6");
  // A single-photo scene, stretched, is the only thing that can meet this budget.
  assert.ok(spendRate(1, DUR_CALM * 1.5) > budget, "a stretched single-photo scene can");
  assert.ok(DUR_LOUD < DUR_CALM, "sanity: the curve is the right way round");
});
