import assert from "node:assert/strict";
import test from "node:test";

import { combineMusicAnalyses, playlistFit } from "../scripts/lib/playlistMusic.mjs";

const analysis = (duration, step) => ({
  analysisVersion: 2,
  duration,
  bpmEstimate: 120,
  beatGrid: { beatSeconds: 0.5 },
  phrases: [{ time: 0 }, { time: step }],
  downbeats: [{ time: 0 }],
  sections: [{ start: 0, end: duration, kind: "calm" }],
});

// Same shape analyzeMusic.mjs emits: one energy sample every ENV_STEP (0.5s) seconds.
const withEnvelope = (duration, value) => ({
  ...analysis(duration, duration / 2),
  envelope: Array.from({ length: duration / 0.5 }, () => value),
});

test("playlist analysis joins durations and shifts musical boundaries across crossfades", () => {
  const combined = combineMusicAnalyses([analysis(60, 30), analysis(40, 20)], 2);
  assert.equal(combined.duration, 98);
  assert.deepEqual(combined.phrases.map((item) => item.time), [0, 30, 58, 78]);
  assert.deepEqual(combined.sections.map((item) => [item.start, item.end]), [[0, 60], [58, 98]]);
});

// The energy envelope is POSITIONAL — lib/pacing.mjs reads sample i as second i * 0.5 — so
// keeping track 1's envelope under a playlist duration silently restated the step. On a real
// pair pacing.mjs warned "spacing looks like 1.165s, not 0.5s" and read every calm/build
// verdict off the wrong second of the film.
test("playlist analysis concatenates the energy envelope so its step still means 0.5s", () => {
  const combined = combineMusicAnalyses([withEnvelope(60, 0.2), withEnvelope(40, 0.8)], 2);
  assert.equal(combined.duration, 98);
  const step = combined.duration / combined.envelope.length;
  assert.ok(Math.abs(step - 0.5) < 0.1, `step is ${step.toFixed(3)}s, not ~0.5s`);
  // Track 1 keeps everything up to the joint; track 2 supplies the rest.
  assert.equal(combined.envelope.filter((value) => value === 0.2).length, 116);
  assert.equal(combined.envelope.filter((value) => value === 0.8).length, 80);
});

test("playlist analysis does not invent rows the analyzer never emitted", () => {
  const combined = combineMusicAnalyses([analysis(60, 30), analysis(40, 20)], 2);
  assert.equal("beats" in combined, false, "no input had beats, so the playlist has none either");
  assert.equal("envelope" in combined, false);
});

test("playlist fit asks only outside the supported seconds-per-photo band", () => {
  assert.equal(playlistFit({ duration: 400, photoCount: 100 }).mismatch, null);
  assert.equal(playlistFit({ duration: 800, photoCount: 50 }).mismatch, "too_much_music");
  assert.equal(playlistFit({ duration: 100, photoCount: 100 }).mismatch, "too_many_photos");
});
