// The Lite tier is two scripts and nothing else — generateProjectStory (words) and
// generateProjectTimeline (frames) — yet neither had a test. This locks the two things
// the timeline generator learned to do: pace scenes to the music's phrasing instead of a
// flat split, and pick the bookend/body photos with intent instead of a round-robin
// cursor. Both are subprocess tests, because the generator is an executable that reads a
// project directory and writes a timeline — the same shape vision-cache.test.mjs drives.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const node = process.execPath;
const bucket = (n) => (n == null ? "unknown" : n === 0 ? "detail" : n === 1 ? "solo" : n === 2 ? "pair" : "group");

/** A Lite project on disk: manifest + photos + (optional) story, music, prompt. The
 *  generators never stat the image files, so the photo records are enough — no pixels. */
function fixture({ photos, story, music, prompt }) {
  const dir = fs.mkdtempSync(path.join(root, "tmp-lite-tier-"));
  fs.mkdirSync(path.join(dir, "input"));
  fs.mkdirSync(path.join(dir, "music"));
  fs.mkdirSync(path.join(dir, "analysis", "music"), { recursive: true });
  fs.writeFileSync(path.join(dir, "music", "track.mp3"), "fixture");
  fs.writeFileSync(path.join(dir, "analysis", "photos.json"), JSON.stringify({ photos }));
  if (story) fs.writeFileSync(path.join(dir, "analysis", "story-template.generated.json"), JSON.stringify(story));
  if (music) fs.writeFileSync(path.join(dir, "analysis", "music", "track.json"), JSON.stringify(music));
  if (prompt != null) fs.writeFileSync(path.join(dir, "prompt.txt"), prompt);
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({
    version: 1, id: "lite-tier-test", name: "Lite tier test",
    ...(prompt != null ? { promptFile: "prompt.txt" } : {}),
    inputDir: "input", music: ["music/track.mp3"], analysisDir: "analysis",
    timeline: "timeline/timeline.json", output: "output/final.mp4", quality: "draft", tier: "lite",
  }));
  return { dir, rel: path.relative(root, dir) };
}

function generate(rel) {
  const r = spawnSync(node, ["scripts/generateProjectTimeline.mjs", "--project", rel], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r;
}

/** Run the story generator with the API key scrubbed, forcing its deterministic STUB
 *  path — the generator captures the key at import, so an unset env is a hard offline. */
function generateStory(rel) {
  const env = { ...process.env };
  delete env.DEEPSEEK_API_KEY;
  const r = spawnSync(node, ["scripts/generateProjectStory.mjs", "--project", rel], { cwd: root, encoding: "utf8", env });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r;
}

function readStory(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "analysis", "story-template.generated.json"), "utf8"));
}

function readTimeline(dir) {
  return JSON.parse(fs.readFileSync(path.join(dir, "timeline", "timeline.json"), "utf8"));
}

const singleBeats = (n) => ({
  title: "Title", closing: "Closing",
  beats: Array.from({ length: n }, (_, i) => ({
    heading: `H${i}`, body: `B${i}`, emotion: "warm", sceneKind: "single", preferredPhotos: [],
  })),
});

// A 60s track with irregular phrase and downbeat grids, so snapping scene ends to those
// boundaries produces varied — not flat — durations.
const musicAware = {
  analysisVersion: 2, duration: 60, bpmEstimate: 120,
  beatGrid: { beatSeconds: 0.5 },
  sections: [
    { kind: "calm", start: 0, end: 15 }, { kind: "build", start: 15, end: 30 },
    { kind: "calm", start: 30, end: 45 }, { kind: "build", start: 45, end: 60 },
  ],
  phrases: [0, 7, 14, 21, 28, 35, 42, 49, 56].map((time, index) => ({ index, time })),
  downbeats: Array.from({ length: 20 }, (_, index) => ({ index, time: index * 3 })),
};

// The same photo shapes, but clumped: five landscape-pairs then five portrait-solos. A
// naive cursor draws L,L,L,L,L,P,... and neighbours collide; the picker must interleave.
function clumpedBody() {
  const body = [];
  for (let i = 0; i < 5; i++) body.push({ file: `L${i}.jpg`, orient: "landscape", subjectCount: 2, heroScore: 0.1 });
  for (let i = 0; i < 5; i++) body.push({ file: `P${i}.jpg`, orient: "portrait", subjectCount: 1, heroScore: 0.1 });
  return body;
}

// op/cl carry the winning opening/closing scores; the ten body photos do not, so the
// bookends are chosen by score and then held out of the body cycle.
const withBookends = (body) => [
  { file: "op.jpg", orient: "landscape", subjectCount: 2, heroScore: 0.2, openingScore: 0.99 },
  { file: "cl.jpg", orient: "landscape", subjectCount: 2, heroScore: 0.2, closingScore: 0.99 },
  ...body,
];

test("music-aware: scenes are paced to the track's phrasing, not a flat split", (t) => {
  const f = fixture({ photos: withBookends(clumpedBody()), story: singleBeats(4), music: musicAware });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  generate(f.rel);
  const tl = readTimeline(f.dir);

  assert.ok(tl.metadata.musicSync, "the music-aware branch did not record its provenance");
  assert.equal(tl.metadata.musicSync.mode, "music-aware-v1");
  assert.ok(tl.metadata.musicSync.snappedBoundaries > 0, "nothing snapped to a phrase or downbeat");

  const durations = tl.slides.map((s) => s.duration);
  assert.ok(new Set(durations.map((d) => d.toFixed(3))).size >= 2, "durations are flat — the track's shape was ignored");

  const net = tl.slides.reduce((sum, s) => sum + s.duration - (s.transition?.duration || 0), 0);
  assert.ok(Math.abs(net - 60) < 0.05, `net runtime ${net} should match the 60s track`);
});

test("no-phrasing music: the generator falls back to an even split and says so", (t) => {
  // A stub/old analysis carries a duration but no beatGrid or phrases — the same shape a
  // pre-upgrade project has on disk. Lite must still produce a timeline, just a flat one.
  const f = fixture({ photos: withBookends(clumpedBody()), story: singleBeats(4), music: { duration: 60 } });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  generate(f.rel);
  const tl = readTimeline(f.dir);

  assert.equal(tl.metadata.musicSync, undefined, "flat split must not claim music-aware provenance");
  const durations = tl.slides.map((s) => s.duration.toFixed(3));
  assert.equal(new Set(durations).size, 1, "a flat split gives every scene the same length");

  const net = tl.slides.reduce((sum, s) => sum + s.duration - (s.transition?.duration || 0), 0);
  assert.ok(Math.abs(net - 60) < 0.05, `net runtime ${net} should match the 60s target`);
});

test("bookends are the analyzer's opening/closing picks, not the cursor's", (t) => {
  const f = fixture({ photos: withBookends(clumpedBody()), story: singleBeats(4), music: musicAware });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  generate(f.rel);
  const singles = readTimeline(f.dir).slides.filter((s) => s.image);

  assert.equal(singles[0].image, "op.jpg", "the opening scene ignored the top openingScore photo");
  assert.equal(singles.at(-1).image, "cl.jpg", "the closing scene ignored the top closingScore photo");
  // A reserved bookend is not reused in the body when the pool can spare it.
  assert.ok(!singles.slice(1, -1).some((s) => s.image === "op.jpg" || s.image === "cl.jpg"),
    "a reserved bookend leaked back into the body of the film");
});

test("a story beat naming its own opening photo outranks the score heuristic", (t) => {
  const story = singleBeats(4);
  story.beats[0].preferredPhotos = ["L3.jpg"]; // beat 0 maps to the opening scene
  const f = fixture({ photos: withBookends(clumpedBody()), story, music: musicAware });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  generate(f.rel);
  const singles = readTimeline(f.dir).slides.filter((s) => s.image);

  assert.equal(singles[0].image, "L3.jpg", "the beat's explicit choice was overridden by the hero heuristic");
});

test("neighbouring single scenes materially avoid the same orientation-and-people shape", (t) => {
  const f = fixture({ photos: withBookends(clumpedBody()), story: singleBeats(4), music: musicAware });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  generate(f.rel);
  const singles = readTimeline(f.dir).slides.filter((s) => s.image);
  const byFile = new Map(withBookends(clumpedBody()).map((p) => [p.file, p]));
  const patternOf = (file) => { const p = byFile.get(file); return `${p.orient}:${bucket(p.subjectCount)}`; };
  const collisions = (sequence) => sequence.reduce((n, pat, i, arr) =>
    (i > 0 && pat === arr[i - 1] && !pat.includes("unknown") ? n + 1 : n), 0);

  const real = collisions(singles.map((s) => patternOf(s.image)));

  // The picker's lookahead window is bounded, so a pathological run cannot be fully
  // broken up — the contract is "materially fewer collisions", not zero. A naive cursor
  // drawing this clumped pool in order collides on nearly every step; the picker must do
  // far better. (On a realistically mixed album it reaches zero — see the manual runs.)
  const naiveOrder = ["landscape:pair", ...clumpedBody().map((p) => `${p.orient}:${bucket(p.subjectCount)}`)];
  const naive = collisions(naiveOrder);
  assert.ok(naive >= 6, `the fixture must be clumped enough to be meaningful (naive=${naive})`);
  assert.ok(real < naive / 2, `the picker barely improved on a naive cursor (real=${real}, naive=${naive})`);
});

test("a repeated preferred photo never creates adjacent duplicate scenes", (t) => {
  const story = singleBeats(4);
  for (const beat of story.beats) beat.preferredPhotos = ["L3.jpg"];
  const f = fixture({ photos: withBookends(clumpedBody()), story, music: musicAware });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  generate(f.rel);
  const files = readTimeline(f.dir).slides.filter((slide) => slide.image).map((slide) => slide.image);

  for (let index = 1; index < files.length; index++) {
    assert.notEqual(files[index], files[index - 1], `adjacent scenes ${index} and ${index + 1} repeat ${files[index]}`);
  }
});

test("perceptual duplicates are not placed on adjacent scenes", (t) => {
  const photos = withBookends(clumpedBody());
  photos.find((photo) => photo.file === "L0.jpg").duplicateGroup = "same-image";
  photos.find((photo) => photo.file === "P0.jpg").duplicateGroup = "same-image";
  const f = fixture({ photos, story: singleBeats(4), music: musicAware });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  generate(f.rel);
  const files = readTimeline(f.dir).slides.filter((slide) => slide.image).map((slide) => slide.image);
  const byFile = new Map(photos.map((photo) => [photo.file, photo]));

  for (let index = 1; index < files.length; index++) {
    const previous = byFile.get(files[index - 1]);
    const current = byFile.get(files[index]);
    assert.ok(!previous.duplicateGroup || previous.duplicateGroup !== current.duplicateGroup,
      `adjacent scenes use perceptual duplicates ${previous.file} and ${current.file}`);
  }
});

// --- generateProjectStory: the words half of the Lite tier ---
// Only the deterministic no-key path is tested here; the AI path is a live network call
// and belongs to a mocked-provider test, not this offline suite.

const bodyPhotos = [
  { file: "a.jpg", orient: "landscape", subjectCount: 2, heroScore: 0.5 },
  { file: "b.jpg", orient: "portrait", subjectCount: 1, heroScore: 0.6 },
];
const validEmotions = new Set(["calm", "warm", "build", "peak", "tender"]);
const validKinds = new Set(["single", "montage"]);

test("no-key story falls back deterministically, titled from the prompt's first sentence", (t) => {
  const prompt = "Chúng tôi yêu nhau. Ngày cưới thật đẹp. Cảm ơn mọi người.";
  const f = fixture({ photos: bodyPhotos, prompt, music: { duration: 60 } });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  generateStory(f.rel);
  const story = readStory(f.dir);

  assert.equal(story.generatedBy, "stub", "a keyless run must be stamped as a stub, not passed off as AI");
  assert.equal(story.title, "Chúng tôi yêu nhau", "the title should be the first sentence, punctuation trimmed");
  assert.ok(story.beats.length >= 3, "a story needs at least three beats");
  assert.ok(story.closing, "the story must carry a closing line");
  for (const beat of story.beats) {
    assert.ok(beat.body, "every beat needs a body");
    assert.ok(validEmotions.has(beat.emotion), `emotion "${beat.emotion}" is outside the vocabulary`);
    assert.ok(validKinds.has(beat.sceneKind), `sceneKind "${beat.sceneKind}" is outside the vocabulary`);
    assert.ok(Array.isArray(beat.preferredPhotos), "preferredPhotos must be an array");
  }
});

test("no-key story pads a one-line prompt up to the three-beat floor", (t) => {
  const f = fixture({ photos: bodyPhotos, prompt: "Một ngày để nhớ.", music: { duration: 60 } });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  generateStory(f.rel);
  const story = readStory(f.dir);

  assert.equal(story.beats.length, 3, "a single-sentence prompt must still be padded to three beats");
  assert.equal(story.generatedBy, "stub");
});
