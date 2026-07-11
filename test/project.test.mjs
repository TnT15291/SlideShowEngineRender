import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { createJobTracker } from "../scripts/lib/jobManifest.mjs";
import { loadProject, root } from "../scripts/lib/project.mjs";
import { inspectResume } from "../scripts/lib/resumeProject.mjs";

function fixture(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(root, "tmp-project-test-"));
  fs.mkdirSync(path.join(dir, "input"));
  fs.mkdirSync(path.join(dir, "music"));
  fs.writeFileSync(path.join(dir, "prompt.txt"), "A story\n");
  fs.writeFileSync(path.join(dir, "music", "track.mp3"), "fixture");
  const manifest = {
    version: 1,
    id: "test-project",
    name: "Test project",
    promptFile: "prompt.txt",
    inputDir: "input",
    music: ["music/track.mp3"],
    analysisDir: "analysis",
    selectionPolicy: "analysis/selection_policy.json",
    selectedPhotos: "analysis/photos.selected.json",
    story: "analysis/story.json",
    timeline: "timeline/timeline.json",
    output: "output/final.mp4",
    quality: "share",
    ...overrides,
  };
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify(manifest));
  return { dir, rel: path.relative(root, dir) };
}

function writeFixtureFile(dir, rel) {
  const target = path.join(dir, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "fixture\n");
}

function completedFixture() {
  const f = fixture();
  const outputs = [
    "analysis/photos.json",
    "analysis/photo_content.json",
    "analysis/music/track.json",
    "analysis/selection_policy.json",
    "analysis/photos.selected.json",
    "analysis/story.json",
    "timeline/timeline.json",
    "output/final.mp4",
    "analysis/qa/timeline.proxy.json",
    "analysis/qa/timeline.json",
    "output/deliver/final.mp4",
    "output/deliver/preview.mp4",
    "output/deliver/thumbnail.jpg",
    "output/deliver/project_summary.json"
  ];
  for (const output of outputs) writeFixtureFile(f.dir, output);
  const project = loadProject(f.rel);
  const tracker = createJobTracker(project);
  tracker.initialize();
  for (const phase of ["analyze", "plan", "build", "render", "qa", "deliver"]) {
    tracker.start(phase);
    tracker.complete(phase);
  }
  tracker.finish();
  return { ...f, project };
}

test("loads a valid project manifest", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  assert.equal(loadProject(f.rel).manifest.id, "test-project");
});

test("rejects a manifest that violates the schema", (t) => {
  const f = fixture({ quality: "ultra" });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  assert.throws(() => loadProject(f.rel), /quality.*not in enum/);
});

test("rejects a missing input asset", (t) => {
  const f = fixture({ music: ["music/missing.mp3"] });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  assert.throws(() => loadProject(f.rel), /music\[0\] does not exist/);
});

test("rejects paths that escape the project", (t) => {
  const f = fixture({ output: "../outside.mp4" });
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  assert.throws(() => loadProject(f.rel), /Path escapes project/);
});

test("writes a schema-valid completed job manifest", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const project = loadProject(f.rel);
  const tracker = createJobTracker(project);
  tracker.initialize();
  tracker.start("analyze");
  tracker.complete("analyze");
  for (const phase of ["plan", "build", "render", "qa", "deliver"]) tracker.skip(phase, "test fixture");
  tracker.finish();

  const job = JSON.parse(fs.readFileSync(tracker.path, "utf8"));
  assert.equal(job.status, "completed");
  assert.equal(job.phases.validate.status, "completed");
  assert.equal(job.phases.analyze.status, "completed");
  assert.equal(job.phases.render.status, "skipped");
  assert.equal(job.currentPhase, undefined);
});

test("records the failed phase and exit code", (t) => {
  const f = fixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const tracker = createJobTracker(loadProject(f.rel));
  tracker.initialize();
  tracker.start("build");
  const error = new Error("timeline failed");
  error.exitCode = 2;
  tracker.fail("build", error);

  const job = JSON.parse(fs.readFileSync(tracker.path, "utf8"));
  assert.equal(job.status, "failed");
  assert.equal(job.currentPhase, "build");
  assert.deepEqual(job.error, { phase: "build", message: "timeline failed", exitCode: 2 });
});

test("resume reuses every phase when artifacts are fresh", (t) => {
  const f = completedFixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const state = inspectResume(f.project);
  assert.equal(state.invalidatedAt, null);
  assert.deepEqual([...state.reusable], ["analyze", "plan", "build", "render", "qa", "deliver"]);
});

test("resume invalidates plan and downstream phases after prompt changes", (t) => {
  const f = completedFixture();
  t.after(() => fs.rmSync(f.dir, { recursive: true, force: true }));
  const future = new Date(Date.now() + 2000);
  fs.utimesSync(path.join(f.dir, "prompt.txt"), future, future);
  const state = inspectResume(f.project);
  assert.equal(state.invalidatedAt, "plan");
  assert.deepEqual([...state.reusable], ["analyze"]);
});
