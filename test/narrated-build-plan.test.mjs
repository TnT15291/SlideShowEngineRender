// What the one-command narrated build decides, without it doing any of it.
//
// Two of the steps it drives spend real money — text-to-speech minutes and an encode —
// so the value of the planner is that every gate is decided from files alone. These
// tests are the proof of that: no ffmpeg, no TTS key, no network, and every branch of
// the plan reachable from a fixture directory.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadProject } from "../scripts/lib/project.mjs";
import { planNarratedBuild } from "../scripts/lib/narratedBuildPlan.mjs";

function write(dir, relative, contents) {
  const target = path.join(dir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, typeof contents === "string" ? contents : `${JSON.stringify(contents, null, 2)}\n`);
  return target;
}

/** Make `relative` look like it was written `seconds` after everything else. */
function touch(dir, relative, seconds) {
  const when = new Date(Date.now() + seconds * 1000);
  fs.utimesSync(path.join(dir, relative), when, when);
}

function fixture({ beats, sections, music = [], reviewStatus = "approved", photos = 3 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmp-narrated-build-"));
  write(dir, "project.json", {
    version: 1,
    id: "narrated-fixture",
    name: "Narrated fixture",
    inputDir: "photos",
    music: [],
    analysisDir: "analysis",
    timeline: "timeline/film.json",
    output: "output/film.mp4",
    quality: "share",
  });
  for (let index = 1; index <= photos; index += 1) write(dir, `photos/img${index}.jpg`, "photo");
  if (beats) {
    write(dir, "script/script.json", {
      reviewStatus,
      project: { maxShotDuration: 9 },
      sections: sections ?? [{ id: "opening", title: "Mở đầu", pools: ["community"] }],
      music,
      beats,
    });
  }
  return { dir, project: () => loadProject(dir) };
}

const pendingBeat = (id) => ({ id, section: "opening", narration: "Một câu.", visual: { kind: "pending" } });
const assignedBeat = (id) => ({ id, section: "opening", narration: "Một câu.", visuals: [{ kind: "photo", src: "photos/img1.jpg" }] });

/** A project with the voice already synthesized and every beat assigned. */
function builtFixture(overrides = {}) {
  const beats = overrides.beats ?? [assignedBeat("b001"), assignedBeat("b002")];
  const f = fixture({ ...overrides, beats });
  write(f.dir, "voice/narration.json", {
    provider: "vieneu", voice: "Phạm Tuyên", style: "tin_tuc", speed: 0, totalDuration: 12,
    segments: beats.map((beat) => ({ id: beat.id, text: beat.narration })),
  });
  write(f.dir, "voice/narration.wav", "wav");
  touch(f.dir, "voice/narration.json", 60);
  touch(f.dir, "voice/narration.wav", 60);
  return f;
}

const byId = (plan, id) => plan.steps.find((step) => step.id === id);
const cleanup = (context, f) => context.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));

test("a project with no script says what to point the build at", (context) => {
  const f = fixture();
  cleanup(context, f);
  const plan = planNarratedBuild(f.project(), {});
  assert.equal(plan.blocked.id, "script");
  assert.match(plan.blocked.reason, /--source <script\.md>/);
});

test("with a source the only planned step is the import, and the rest waits for it", (context) => {
  const f = fixture();
  cleanup(context, f);
  const plan = planNarratedBuild(f.project(), { source: "script.md" });
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].action, "run");
  assert.deepEqual(plan.steps[0].command.slice(0, 1), ["scripts/importNarrationScript.mjs"]);
  assert.ok(plan.steps[0].command.includes("--source"));
  assert.equal(plan.pending, true);
});

// The importer refuses to overwrite an assigned script, and days of picture work live
// in that file. The build has to say that rather than pass --source along and fail.
test("a source given to an already-imported project is refused, not forwarded", (context) => {
  const f = builtFixture();
  cleanup(context, f);
  const plan = planNarratedBuild(f.project(), { source: "script.md" });
  assert.equal(byId(plan, "script").action, "skip");
  assert.match(byId(plan, "script").reason, /discards every visual assignment/);
});

test("an unapproved script stops the build before it spends a second of synthesis", (context) => {
  const f = builtFixture({ reviewStatus: "needs-content-approval" });
  cleanup(context, f);
  const plan = planNarratedBuild(f.project(), {});
  assert.equal(plan.blocked.id, "content-review");
  assert.match(plan.blocked.reason, /needs-content-approval/);
  // Nothing expensive was planned before the gate.
  assert.ok(!plan.steps.some((step) => step.id === "narration"));
});

test("--allow-unapproved carries through to every script that enforces the same gate", (context) => {
  const f = fixture({ beats: [pendingBeat("b001")], reviewStatus: "needs-content-approval" });
  cleanup(context, f);
  write(f.dir, "analysis/pools.json", { community: [0, 1, 2] });
  const plan = planNarratedBuild(f.project(), { allowUnapproved: true });
  assert.equal(byId(plan, "content-review").action, "pass");
  assert.match(byId(plan, "content-review").reason, /not a delivery master/);
  assert.ok(byId(plan, "narration").command.includes("--allow-unapproved"));
  assert.ok(byId(plan, "timeline").command.includes("--allow-unapproved"));
});

test("music the script names but the project does not hold stops the build", (context) => {
  const f = builtFixture({ music: [{ path: "music/theme.mp3" }] });
  cleanup(context, f);
  const plan = planNarratedBuild(f.project(), {});
  assert.equal(plan.blocked.id, "inputs");
  assert.match(plan.blocked.reason, /music\/theme\.mp3/);
});

test("beats still to fill with no pools file stop at the pools gate, naming the sections", (context) => {
  const f = fixture({ beats: [pendingBeat("b001")] });
  cleanup(context, f);
  const plan = planNarratedBuild(f.project(), {});
  assert.equal(plan.blocked.id, "pools");
  assert.match(plan.blocked.reason, /opening/);
  assert.match(plan.blocked.reason, /photo-index\.json/);
});

test("a section naming a pool the curation does not have stops with both lists", (context) => {
  const f = fixture({ beats: [pendingBeat("b001")], sections: [{ id: "opening", title: "Mở đầu", pools: ["parade"] }] });
  cleanup(context, f);
  write(f.dir, "analysis/pools-curated.json", { _note: "curated", community: [0], school: [1] });
  const plan = planNarratedBuild(f.project(), {});
  assert.equal(plan.blocked.id, "pools");
  assert.match(plan.blocked.reason, /parade/);
  assert.match(plan.blocked.reason, /community, school/);
});

test("a missing album inventory is measured, and an existing one is never rebuilt", (context) => {
  const f = fixture({ beats: [pendingBeat("b001")] });
  cleanup(context, f);
  write(f.dir, "analysis/pools.json", { community: [0, 1, 2] });
  const fresh = planNarratedBuild(f.project(), {});
  assert.equal(byId(fresh, "photo-index").action, "run");
  assert.equal(byId(fresh, "photo-index").internal, "photo-index");

  write(f.dir, "analysis/photo-index.json", [
    { i: 0, file: "img1.jpg", w: 1600, h: 900, orient: "landscape" },
    { i: 1, file: "img2.jpg", w: 900, h: 1600, orient: "portrait" },
  ]);
  const existing = planNarratedBuild(f.project(), {});
  assert.equal(byId(existing, "photo-index").action, "skip");
  // The album grew after the pools were tagged: a note, because appended files keep
  // every existing position.
  assert.match(byId(existing, "photo-index").reason, /covers 2 of 3 photographs/);
});

// The pools are positions in this array. A folder whose order changed re-points every
// one of them at a different photograph, and no later gate can see it happen.
test("an album inventory that no longer describes the folder stops the build", (context) => {
  const f = fixture({ beats: [pendingBeat("b001")] });
  cleanup(context, f);
  write(f.dir, "analysis/pools.json", { community: [0, 1, 2] });
  write(f.dir, "analysis/photo-index.json", [
    { i: 0, file: "img1.jpg", w: 1600, h: 900, orient: "landscape" },
    { i: 1, file: "removed.jpg", w: 1600, h: 900, orient: "landscape" },
  ]);
  const plan = planNarratedBuild(f.project(), {});
  assert.equal(plan.blocked.id, "photo-index");
  assert.match(plan.blocked.reason, /position 1 is "removed\.jpg" .* "img2\.jpg"/s);
});

test("an unsigned director proposal stops the build instead of being assigned around", (context) => {
  const f = builtFixture({ beats: [pendingBeat("b001"), assignedBeat("b002")] });
  cleanup(context, f);
  write(f.dir, "analysis/pools.json", { community: [0, 1, 2] });
  write(f.dir, "analysis/photo-index.json", [{ i: 0, file: "img1.jpg", w: 1600, h: 900, orient: "landscape" }]);
  write(f.dir, "script/visual-review.json", { approved: false, beats: [{ id: "b001" }] });
  const plan = planNarratedBuild(f.project(), {});
  assert.equal(plan.blocked.id, "visuals");
  assert.match(plan.blocked.reason, /nobody has signed/);

  write(f.dir, "script/visual-review.json", { approved: true, beats: [{ id: "b001" }] });
  const signed = planNarratedBuild(f.project(), {});
  assert.equal(byId(signed, "visuals").action, "run");
  assert.deepEqual(byId(signed, "visuals").command.slice(0, 1), ["scripts/applyNarrationVisuals.mjs"]);
  assert.ok(byId(signed, "visuals").command.includes("--fill"));
});

// How many pictures a stretch of script needs comes from how long it takes to read
// aloud, so on the run that synthesizes the voice the assignment cannot be decided yet.
test("assignment waits for the narration it is planned against", (context) => {
  const f = fixture({ beats: [pendingBeat("b001")] });
  cleanup(context, f);
  write(f.dir, "analysis/pools.json", { community: [0, 1, 2] });
  write(f.dir, "analysis/photo-index.json", [{ i: 0, file: "img1.jpg", w: 1600, h: 900, orient: "landscape" }]);
  const first = planNarratedBuild(f.project(), {});
  assert.equal(byId(first, "narration").action, "run");
  assert.equal(byId(first, "visuals").action, "deferred");

  write(f.dir, "voice/narration.json", { totalDuration: 6, segments: [{ id: "b001", text: "Một câu." }] });
  write(f.dir, "voice/narration.wav", "wav");
  const second = planNarratedBuild(f.project(), {});
  assert.equal(byId(second, "narration").action, "skip");
  assert.equal(byId(second, "visuals").action, "run");
  assert.deepEqual(byId(second, "visuals").command.slice(0, 1), ["scripts/assignNarrationVisuals.mjs"]);
});

test("a finished film re-plans as nothing to do, and re-synthesizes when the script changes", (context) => {
  const f = builtFixture();
  cleanup(context, f);
  write(f.dir, "timeline/film.json", { slides: [] });
  write(f.dir, "output/film.mp4", "film");
  write(f.dir, "output/film.srt", "1\n");
  for (const file of ["timeline/film.json", "output/film.mp4", "output/film.srt"]) touch(f.dir, file, 120);

  const settled = planNarratedBuild(f.project(), {});
  assert.equal(settled.blocked, null);
  assert.deepEqual(settled.steps.filter((step) => step.action === "run").map((step) => step.id), []);

  // Editing the words invalidates the voice, and everything the voice decides.
  const script = JSON.parse(fs.readFileSync(path.join(f.dir, "script/script.json"), "utf8"));
  script.beats[1].narration = "Một câu khác hẳn.";
  write(f.dir, "script/script.json", script);
  const edited = planNarratedBuild(f.project(), {});
  assert.deepEqual(edited.steps.filter((step) => step.action === "run").map((step) => step.id),
    ["narration", "timeline", "text-fit", "render", "subtitles"]);
  assert.match(byId(edited, "narration").reason, /b002 was rewritten after it was spoken/);
});

// Assigning pictures rewrites script.json. Reading that as "the script changed" would
// re-stitch and re-measure a voice saying exactly the same words — 53 beats of it on the
// first film — which is why freshness is judged on the words and the voice settings.
test("giving the film its pictures does not re-synthesize the voice", (context) => {
  const f = builtFixture();
  cleanup(context, f);
  touch(f.dir, "script/script.json", 300);
  assert.equal(byId(planNarratedBuild(f.project(), {}), "narration").action, "skip");

  const script = JSON.parse(fs.readFileSync(path.join(f.dir, "script/script.json"), "utf8"));
  script.voice = { provider: "vieneu", voice: "Phạm Tuyên", style: "tin_tuc", speed: 0.9 };
  write(f.dir, "script/script.json", script);
  const respoken = planNarratedBuild(f.project(), {});
  assert.equal(byId(respoken, "narration").action, "run");
  assert.match(byId(respoken, "narration").reason, /speed 0\.9 .* read at 0/);
});

test("--no-render prepares the film without encoding it", (context) => {
  const f = builtFixture();
  cleanup(context, f);
  const plan = planNarratedBuild(f.project(), { render: false });
  assert.equal(byId(plan, "render").action, "skip");
  assert.equal(byId(plan, "render").reason, "--no-render");
  assert.equal(byId(plan, "timeline").action, "run");
  assert.equal(byId(plan, "subtitles").action, "run");
});
