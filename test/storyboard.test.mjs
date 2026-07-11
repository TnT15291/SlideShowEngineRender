// The shot list must be a function of the inputs. Three jobs, three answers.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { composeStoryboard, planSceneCount } from "../scripts/lib/storyboard.mjs";
import { makeEnergy } from "../scripts/lib/pacing.mjs";

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
  const used = new Set(sb.scenes.map((s) => s.layout).filter(Boolean));
  assert.ok(used.size >= 3, `only ${used.size} distinct layout(s) across ${sb.scenes.length} scenes`);
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

test("planSceneCount: the binding constraint is named, not guessed", () => {
  const poor = planSceneCount({ photoCount: 10, musicDuration: 200, avgBase: 5.8 });
  assert.equal(poor.bound, "photos");
  assert.equal(poor.scenes, 10, "cannot make more scenes than there are photos to fill them");

  const rich = planSceneCount({ photoCount: 500, musicDuration: 120, avgBase: 5.8 });
  assert.equal(rich.bound, "music");
  assert.ok(rich.photosPerScene > 1, "a photo-rich job must pack photos into each scene");
});
