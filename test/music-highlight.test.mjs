import assert from "node:assert/strict";
import test from "node:test";
import { chooseMusicEdit, sliceMusicAnalysis } from "../scripts/lib/musicHighlight.mjs";

const music = {
  analysisVersion: 2,
  duration: 203,
  envelope: Array.from({ length: 406 }, (_, i) => i / 405),
  phrases: Array.from({ length: 14 }, (_, i) => ({ index: i, time: i * 15.5, kind: "phrase" })),
};

test("23 photos against 203s becomes a phrase-aligned highlight", () => {
  const edit = chooseMusicEdit(music, 23);
  assert.equal(edit.mode, "highlight");
  assert.ok(edit.duration >= 75 && edit.duration <= 105);
  assert.ok(music.phrases.some((p) => p.time === edit.start));
  assert.ok(music.phrases.some((p) => p.time === edit.end));
  const sliced = sliceMusicAnalysis(music, edit);
  assert.equal(sliced.duration, edit.duration);
  assert.ok(sliced.phrases.every((p) => p.time >= 0 && p.time <= edit.duration));
});

test("a photo-rich job keeps the whole song", () => {
  assert.equal(chooseMusicEdit(music, 60).mode, "full_song");
});

test("highlight is honoured even when there are enough photos", () => {
  assert.equal(chooseMusicEdit(music, 60, { mode: "highlight" }).mode, "highlight");
});

test("full song is honoured even when there are few photos", () => {
  assert.equal(chooseMusicEdit(music, 23, { mode: "full_song" }).mode, "full_song");
});

test("a shorter requested duration selects a highlight", () => {
  const edit = chooseMusicEdit(music, 60, { targetDuration: 90 });
  assert.equal(edit.mode, "highlight");
  assert.ok(Math.abs(edit.duration - 90) < 10);
});

test("the selector records cadence and section-boundary quality", () => {
  const edit = chooseMusicEdit({ ...music, sections: [{ start: 0, end: 93 }, { start: 93, end: 203 }] }, 23);
  assert.equal(edit.mode, "highlight");
  assert.ok(Number.isFinite(edit.selection.score));
  assert.ok("cadenceDrop" in edit.selection);
  assert.ok("sectionBoundaryDrift" in edit.selection);
});
