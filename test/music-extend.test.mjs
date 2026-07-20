import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

// loop/playlist EXTEND a track too short for the album — the mirror of highlight, which
// TRIMS one too long. The engine already covers any video with whatever music it is given
// (buildAudioMuxArgs: -stream_loop -1 for a single track, acrossfade for a playlist); the
// gap this closes is entirely at the SCRIPTS layer, which never asked for a longer film
// than the source track.
//
// THE BUG THESE TESTS GUARD (found by hand, not by a spec): pushing the target duration to
// exactly what N scenes can theoretically hold (N * MAX_SCENE) ignores that real transitions
// between slides eat into each slide's net contribution — 10 scenes joined by ~1s dissolves
// hold closer to 289s than 300s. Worse, if the shot-list SOLVER was already run against the
// original (larger, unclamped) target before the clamp landed, its per-scene weights are
// sized for a duration retime never receives — an inconsistency that surfaced as slides
// coming out past MAX_SCENE even though the target itself was "reduced." The fix re-solves
// the shot list against the corrected, transition-aware ceiling BEFORE building slides, so
// the weights retime redistributes are consistent with the target it actually gets.
const root = process.cwd();

// A self-contained photo fixture, built once from whichever of the repo's real input/*.jpg
// files actually exist on disk — never from a hand-made file living outside this test. An
// earlier version of this suite pointed at analysis/photos.evalreal.json, an ad-hoc scratch
// artifact created while diagnosing the bug by hand; cleaning that file up as "just scratch"
// silently broke every test here. The lesson: a fixture a test depends on is not scratch.
function buildPhotoFixture(count) {
  const files = fs.readdirSync(path.join(root, "input")).filter((f) => /\.jpe?g$/i.test(f)).slice(0, count);
  if (files.length < count) throw new Error(`fixture needs ${count} input/*.jpg files, found ${files.length}`);
  return files.map((name, i) => ({
    file: `input/${name}`, w: 1920, h: 1080, orient: i % 4 === 0 ? "portrait" : "landscape",
    sharpness: 30, meanLuma: 128, qualityNorm: 0.9 - i / 1000,
    openingScore: i === 0 ? 0.95 : 0.4, closingScore: i === files.length - 1 ? 0.95 : 0.4,
    focusX: 0.5, focusY: 0.45,
  }));
}

function build(template, photoCount, musicPath, extra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "music-extend-"));
  const photosPath = path.join(dir, "photos.json");
  const outPath = path.join(dir, "tl.json");
  fs.writeFileSync(photosPath, JSON.stringify({ photos: buildPhotoFixture(photoCount) }));
  const args = ["scripts/applyStoryTemplate.mjs", "--template", template, "--photos", photosPath,
    "--music", musicPath, "--out", outPath, "--accept-misfit", ...(extra || [])];
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf8")) : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, out };
}

test("loop mode extends a short track's target instead of trimming it to a highlight", () => {
  const { status, out, stderr } = build(
    "story-templates/warm-film-01.json", 81,
    "music/River Flows In You.mp3", ["--music-mode", "loop"],
  );
  assert.equal(status, 0, stderr);
  assert.ok(out, "no timeline written");
  assert.equal(out.music.length, 1, "loop keeps a single track");
  assert.ok(!out.music[0].start && !out.music[0].end, "loop does not trim the source — the engine's own stream_loop covers the video");
  const film = out.slides.reduce((n, s) => n + s.duration, 0) - out.slides.reduce((n, s) => n + (s.transition?.duration || 0), 0);
  assert.ok(film > 189, `film (${film.toFixed(1)}s) should exceed the 188.83s source track — that is the point of looping`);
});

test("playlist mode appends the second track and sets a crossfade", () => {
  const { status, out, stderr } = build(
    "story-templates/warm-film-01.json", 81,
    "music/River Flows In You.mp3", ["--music-mode", "playlist", "--extra-music", "music/Perfect.mp3"],
  );
  assert.equal(status, 0, stderr);
  assert.equal(out.music.length, 2);
  assert.equal(out.music[1].path, "music/Perfect.mp3");
  assert.ok(out.audio.crossfade > 0, "a playlist needs a crossfade to join its tracks");
});

test("playlist without a second track degrades to loop instead of failing", () => {
  const { status, out, stderr } = build(
    "story-templates/warm-film-01.json", 81,
    "music/River Flows In You.mp3", ["--music-mode", "playlist"],
  );
  assert.equal(status, 0, stderr);
  assert.equal(out.music.length, 1, "no --extra-music given, so playlist falls back to a single looped track");
});

test("every slide in an extended film stays inside the engine's duration limits", () => {
  // The exact regression: 81 photos against a 189s track, extended toward 324s (81 * 4s),
  // vastly exceeds what warm-film-01's 9-scene, repeat-capped palette can sustain. The build
  // must clamp the target to what the shot list can honestly cover, not hand the renderer a
  // timeline with slides past MAX_SCENE.
  const { status, out, stderr } = build(
    "story-templates/warm-film-01.json", 81,
    "music/River Flows In You.mp3", ["--music-mode", "loop"],
  );
  assert.equal(status, 0, stderr);
  for (const s of out.slides) assert.ok(s.duration <= 30.001, `slide ${s.id} is ${s.duration}s, past MAX_SCENE`);
});

test("an extended film still passes the engine's own validator", () => {
  const { out } = build(
    "story-templates/warm-film-01.json", 81,
    "music/River Flows In You.mp3", ["--music-mode", "loop"],
  );
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "music-extend-dry-"));
  const tlPath = path.join(dir, "tl.json");
  fs.writeFileSync(tlPath, JSON.stringify(out));
  const r = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts", "--timeline", tlPath, "--dry-run"], { cwd: root, encoding: "utf8" });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, (r.stdout || "") + (r.stderr || ""));
});
