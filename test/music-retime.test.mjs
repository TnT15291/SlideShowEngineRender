import assert from "node:assert/strict";
import test from "node:test";
import { retimeSlidesToMusic } from "../scripts/lib/musicRetime.mjs";

test("music retiming preserves authored structure and fits the track", () => {
  const slides = [
    { id: "a", duration: 6, effect: "still", transition: { type: "fade_slow", duration: 1 } },
    { id: "b", duration: 6, renderer: "blender", transition: { type: "crossfade", duration: 1 } },
    { id: "c", duration: 6, effect: "still", transition: { type: "none", duration: 0 } },
  ];
  const music = {
    duration: 30,
    bpmEstimate: 120,
    beatGrid: { beatSeconds: 0.5 },
    phrases: [{ time: 0 }, { time: 8 }, { time: 16 }, { time: 24 }],
    downbeats: Array.from({ length: 16 }, (_, index) => ({ time: index * 2 })),
    sections: [{ kind: "calm", start: 0, end: 10 }, { kind: "build", start: 10, end: 30 }],
  };
  const result = retimeSlidesToMusic(slides, music);
  const total = result.slides.reduce((sum, slide) => sum + slide.duration - slide.transition.duration, 0);
  assert.equal(+total.toFixed(3), 30);
  assert.deepEqual(result.slides.map((slide) => slide.id), ["a", "b", "c"]);
  assert.equal(result.slides[0].transition.type, "fade_slow");
  assert.equal(result.slides[1].renderer, "blender");
  assert.equal(result.slides.at(-1).transition.duration, 0);
});

test("music retiming rejects a track too short for the scene floor", () => {
  const slides = Array.from({ length: 3 }, (_, index) => ({
    id: `s${index + 1}`,
    duration: 3,
    transition: { type: "none", duration: 0 },
  }));

  assert.throws(
    () => retimeSlidesToMusic(slides, { duration: 7 }),
    /cannot fit 3 slide\(s\) into 7s.*needs at least 7\.5s/,
  );
});

test("a single short track fails cleanly instead of reading a previous slide", () => {
  const slides = [{ id: "only", duration: 3, transition: { type: "none", duration: 0 } }];
  assert.throws(
    () => retimeSlidesToMusic(slides, { duration: 2 }),
    /cannot fit 1 slide\(s\) into 2s/,
  );
});

test("music retiming never emits a scene below the configured floor", () => {
  const slides = Array.from({ length: 4 }, (_, index) => ({
    id: `s${index + 1}`,
    duration: 8,
    transition: { type: index === 3 ? "none" : "crossfade", duration: index === 3 ? 0 : 1 },
  }));
  const music = {
    duration: 10,
    beatGrid: { beatSeconds: 0.5 },
    phrases: [{ time: 0 }, { time: 2.5 }, { time: 5 }, { time: 7.5 }],
  };

  const result = retimeSlidesToMusic(slides, music);
  const netDurations = result.slides.map((slide) => slide.duration - slide.transition.duration);
  assert.ok(netDurations.every((duration) => duration >= 2.5));
  assert.equal(+netDurations.reduce((sum, duration) => sum + duration, 0).toFixed(3), 10);
});
