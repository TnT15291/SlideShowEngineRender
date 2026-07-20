import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { retimeSlidesToMusic } from "../scripts/lib/musicRetime.mjs";
import { solveRecipeShotList } from "../scripts/lib/recipeShotList.mjs";
import { MIN_SCENE, MAX_SCENE, makeEnergy } from "../scripts/lib/pacing.mjs";

// THE SEAM these tests guard. solveRecipeShotList clamps every scene to
// [MIN_SCENE, MAX_SCENE] — but retimeSlidesToMusic runs AFTER it and used to dump all the
// leftover time onto the final slide with no upper rail, so a photo-poor album produced a
// 32–43 second closing card that the engine rejected outright (validateTimeline: "Number
// must be less than or equal to 30") and the film did not render at all. The unit tests
// that drove the two functions separately never saw it: the fault lived only where they
// were joined. tier1-fit.test.mjs measures OUTCOME (does the film cover the song); these
// measure the ENGINE CONTRACT the outcome rides on (is every slide renderable at all).

const music = JSON.parse(fs.readFileSync("analysis/music/Em Đồng Ý (I Do).json", "utf8"));

/** The slide list applyStoryTemplate hands to retime, from a solved shot list. */
function slidesFromShotList(recipe, photoCount) {
  const photoDemandOf = (s) => (s.photoSlots || []).reduce((n, p) => n + (p.count || 1), 0) || 1;
  const { scenes } = solveRecipeShotList({
    recipe, photoCount, musicDuration: music.duration,
    durationOf: () => 6, photoDemandOf, bodyPhotoBudget: Math.max(1, photoCount - 2),
    energy: makeEnergy(music),
  });
  return scenes.map((s, i) => ({
    id: s.id,
    duration: s.durationSec,
    transition: { type: i === scenes.length - 1 ? "none" : "dissolve", duration: i === scenes.length - 1 ? 0 : 1 },
  }));
}

test("solver → retime keeps every slide inside the engine's duration limits on a photo-poor album", () => {
  // 23 photos against a 203s track is the exact shape that produced the 32–43s closing
  // cards on jmii / afterparty / white-weddings-full. Drive the joined pipeline and assert
  // it now emits nothing the engine will reject.
  for (const id of ["jmii-silk-botanical-01", "afterparty-pulse-01", "white-weddings-full-01"]) {
    const recipe = JSON.parse(fs.readFileSync(`story-templates/${id}.json`, "utf8"));
    const { slides } = retimeSlidesToMusic(slidesFromShotList(recipe, 23), music);
    for (const s of slides) {
      assert.ok(s.duration >= MIN_SCENE - 0.001, `${id}: ${s.id} is ${s.duration}s, below MIN_SCENE`);
      assert.ok(s.duration <= MAX_SCENE + 0.001, `${id}: ${s.id} is ${s.duration}s, past MAX_SCENE — engine rejects this`);
    }
    const total = slides.reduce((sum, s) => sum + s.duration - (s.transition?.duration || 0), 0);
    assert.equal(+total.toFixed(2), +music.duration.toFixed(2), `${id}: film length drifted from the track`);
  }
});

test("retime spreads leftover time across the film instead of piling it on the last slide", () => {
  // Four 6s slides, a 100s track: the old code gave slides 1–3 a scaled share and slide 4
  // whatever remained, which ballooned past MAX_SCENE. The last slide must not swallow it.
  const slides = Array.from({ length: 4 }, (_, i) => ({
    id: `s${i}`, duration: 6,
    transition: { type: i === 3 ? "none" : "dissolve", duration: i === 3 ? 0 : 1 },
  }));
  const { slides: out } = retimeSlidesToMusic(slides, { duration: 100, beatGrid: { beatSeconds: 0.5 } });
  for (const s of out) assert.ok(s.duration <= MAX_SCENE + 0.001, `${s.id} is ${s.duration}s, past MAX_SCENE`);
  const last = out.at(-1).duration;
  const maxOther = Math.max(...out.slice(0, -1).map((s) => s.duration));
  assert.ok(last <= maxOther * 3, `the last slide (${last}s) still swallows the leftover vs the rest`);
});

test("retime refuses a track too long for the slide count instead of emitting an invalid film", () => {
  // Two slides cannot cover 100s without one exceeding MAX_SCENE. Failing with the numbers
  // beats handing the renderer a timeline it rejects on slide 2.
  const slides = Array.from({ length: 2 }, (_, i) => ({ id: `s${i}`, duration: 6, transition: { type: "none", duration: 0 } }));
  assert.throws(
    () => retimeSlidesToMusic(slides, { duration: 100, beatGrid: { beatSeconds: 0.5 } }),
    /cannot stretch 2 slide\(s\) to cover 100s|covers at most/,
  );
});

test("retime clamps a caption that would outlive its shrunken slide", () => {
  // A caption sized 0.6..4.4s on an authored 6s slide; a 9s/3-slide track forces each toward
  // its 2.5s floor, and a caption running past the slide end is rejected by the engine.
  const slides = [
    { id: "a", duration: 6, captions: [{ text: "x", start: 0.6, duration: 3.8 }], transition: { type: "dissolve", duration: 1 } },
    { id: "b", duration: 6, transition: { type: "dissolve", duration: 1 } },
    { id: "c", duration: 6, transition: { type: "none", duration: 0 } },
  ];
  const { slides: out } = retimeSlidesToMusic(slides, { duration: 9, beatGrid: { beatSeconds: 0.5 } });
  for (const s of out) for (const c of s.captions || []) {
    assert.ok((c.start || 0) + c.duration <= s.duration + 0.001,
      `${s.id}: caption runs to ${((c.start || 0) + c.duration).toFixed(2)}s past a ${s.duration}s slide`);
  }
});

// The mask-reveal signature beat is punctuation the library says to use "at most once per
// video"; a photo-poor budget used to replay it ten times in a row because it was the only
// affordable scene. The cap turns that stutter into a single appearance.
test("a signature mask reveal is never repeated to fill a photo-poor film", () => {
  const recipe = JSON.parse(fs.readFileSync("story-templates/playful-scrapbook-01.json", "utf8"));
  const photoDemandOf = (s) => (s.photoSlots || []).reduce((n, p) => n + (p.count || 1), 0) || 1;
  const { scenes } = solveRecipeShotList({
    recipe, photoCount: 23, musicDuration: 203,
    durationOf: () => 6, photoDemandOf, bodyPhotoBudget: 21,
  });
  const maskCount = scenes.filter((s) => s.effect === "mask_reveal").length;
  assert.ok(maskCount <= 1, `mask reveal appears ${maskCount} times; a "once per video" beat must not pad the film`);
});
