// Phase 7 of docs/LITE-QUALITY-STABILITY-PLAN.md: the canary.
//
// Runs the Lite build across a corpus of REAL albums and checks the §11 rollout metrics that
// can be decided before a frame is encoded — which is five of the eight:
//
//   0 technical text overflow · 0 within-scene duplicate · 0 music drift over 0.1s
//   · timeline deterministic for the same inputs · build succeeds at all
//
// The remaining three (first-pass delivery rate, render failure rate, render time) need an
// encoder and belong to a sampled render pass, not here. Splitting them this way is what
// makes the canary runnable in minutes instead of the 15–48 minutes PER ALBUM a full render
// costs on this machine — so it can run often enough to catch a regression.
//
// ALBUMS ARE NEVER MUTATED. Each case is staged into temp/ and points at the original
// photographs by path; nothing is copied and nothing is written back.
//
// Usage:
//   node scripts/runLiteCanary.mjs --auto
//   node scripts/runLiteCanary.mjs --projects projects/a,projects/b --strict
//   node scripts/runLiteCanary.mjs --auto --no-determinism    (half the runtime)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { buildLiteQualityReport } from "./lib/liteQualityReport.mjs";
import { stageLiteProject, STAGE_ROOT } from "./lib/stageLiteProject.mjs";

const root = process.cwd();
const arg = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const strict = process.argv.includes("--strict");
const checkDeterminism = !process.argv.includes("--no-determinism");
const workRoot = path.resolve(root, STAGE_ROOT);
const outPath = path.resolve(root, arg("--out", "analysis/lite-canary.json"));

/** Every project on disk that has been analysed enough to build a Lite film from. */
function surveyAlbums() {
  const albums = [];
  for (const entry of fs.readdirSync("projects", { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join("projects", entry.name);
    const manifestPath = path.join(dir, "project.json");
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { continue; }
    const analysisDir = manifest.analysisDir || "analysis";
    const photosPath = path.join(dir, analysisDir, "photos.json");
    const storyPath = path.join(dir, manifest.story || `${analysisDir}/story-template.generated.json`);
    if (!fs.existsSync(photosPath) || !fs.existsSync(storyPath)) continue;
    let photos = [];
    try { photos = JSON.parse(fs.readFileSync(photosPath, "utf8")).photos || []; } catch { continue; }
    if (!photos.length) continue;
    const inputDir = path.join(dir, manifest.inputDir || "input");
    if (!fs.existsSync(inputDir) || !fs.readdirSync(inputDir).length) continue;
    const portrait = photos.filter((photo) => photo.orient === "portrait").length;
    albums.push({
      dir, id: entry.name, photos, count: photos.length,
      portraitShare: +(portrait / photos.length).toFixed(2),
      language: manifest.language || "vi",
    });
  }
  return albums;
}

/**
 * A corpus chosen to span the axes §7 Phase 7 names, and honest about the one it cannot.
 *
 * The photo-poor cases are SUBSETS of a real album rather than fixtures: the 10–70 photo band
 * is empty on disk, and that band is exactly where the greedy exact-fit photo solver is
 * fragile, so leaving it uncovered would leave the canary blind where the risk is highest.
 */
function autoCorpus(albums) {
  if (!albums.length) throw new Error("No analysed albums under projects/ to run a canary on");
  const by = (fn) => [...albums].sort(fn);
  const cases = [];
  const add = (album, label, keepPhotos = null) => {
    if (!album || cases.some((row) => row.label === label)) return;
    cases.push({ album, label, keepPhotos });
  };

  const real = albums.filter((album) => album.count >= 10);
  add(by((a, b) => b.count - a.count)[0], "photo-rich");
  add(by((a, b) => a.count - b.count).find((album) => album.count >= 10), "photo-fewest-real");
  add(by((a, b) => b.portraitShare - a.portraitShare)[0], "portrait-heavy");
  add(by((a, b) => a.portraitShare - b.portraitShare).find((album) => album.count >= 10), "landscape-heavy");
  add(albums.find((album) => album.language === "en"), "language-en");

  // Photo-poor band, synthesised from a mid-sized album. `uploadIndex` order keeps the subset
  // chronological, so the story beats still line up with the photographs they describe.
  const donor = by((a, b) => a.count - b.count).find((album) => album.count >= 60) || real[0];
  if (donor) {
    const ordered = [...donor.photos].sort((a, b) => (a.uploadIndex ?? 0) - (b.uploadIndex ?? 0));
    for (const size of [12, 25, 45]) {
      if (donor.count <= size) continue;
      add(donor, `photo-poor-${size}`, ordered.slice(0, size).map((photo) => photo.file));
    }
  }
  return cases;
}

function build(dir) {
  const relative = path.relative(root, dir).replace(/\\/g, "/");
  const started = Date.now();
  const result = spawnSync(process.execPath, ["scripts/generateProjectTimeline.mjs", "--project", relative],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  return { ok: result.status === 0, ms: Date.now() - started, stderr: (result.stderr || result.stdout || "").trim() };
}

const albums = surveyAlbums();
const explicit = arg("--projects").split(",").map((value) => value.trim()).filter(Boolean);
const cases = explicit.length
  ? explicit.map((dir) => {
    const album = albums.find((row) => row.dir.replace(/\\/g, "/") === dir.replace(/\\/g, "/") || row.id === dir);
    if (!album) throw new Error(`Not an analysed album: ${dir}`);
    return { album, label: album.id, keepPhotos: null };
  })
  : autoCorpus(albums);

console.log(`[canary] ${cases.length} case(s) over ${albums.length} analysed album(s); determinism ${checkDeterminism ? "on" : "off"}`);
const results = [];

for (const testCase of cases) {
  const { album, label, keepPhotos } = testCase;
  const workDir = path.join(workRoot, label);
  const staged = stageLiteProject(path.resolve(root, album.dir), { workDir, keepPhotos });
  const first = build(workDir);
  const row = {
    label, album: album.id, photos: staged.photos.length,
    portraitShare: album.portraitShare, language: album.language,
    built: first.ok, buildMs: first.ms,
  };

  if (!first.ok) {
    // The first line of a thrown engine error is the sentence that names the cause; the rest
    // is a Node stack that says nothing about the film.
    // Node prints a `file:///…:line` header BEFORE the `Error: <message>` line, and the header
    // also contains "Error:" often enough to win a naive first-match — which is how the first
    // canary run reported a file path as its cause. Take the message line and the numbers that
    // follow it, since for a fill failure the counts ARE the diagnosis.
    // `generateProjectTimeline.mjs` rethrows the CHILD's entire stderr as one message, so the
    // text contains several `Error:` lines and the outermost is a file path. The innermost —
    // the last — is the one that names what actually went wrong.
    const lines = first.stderr.split("\n").map((line) => line.trim());
    const at = lines.findLastIndex((line) => /^Error: /.test(line));
    row.error = at >= 0 ? lines.slice(at, at + 2).join(" ").slice(0, 300) : first.stderr.slice(0, 200);
  } else {
    // Snapshot BEFORE anything downstream touches the file. `fitTextInTimeline` below rewrites
    // the timeline in place, so comparing a post-fit file against a fresh build compares two
    // different stages of the pipeline and reports every album as non-deterministic — which is
    // exactly what the first version of this check did.
    const timelinePath = path.join(workDir, "timeline", "timeline.json");
    const asBuilt = fs.readFileSync(timelinePath);
    const timeline = JSON.parse(asBuilt.toString("utf8"));
    const report = buildLiteQualityReport({ timeline, photos: staged.photos });
    row.scenes = report.scenes;
    row.drift = report.music.drift;
    row.withinSceneDuplicates = report.photos.withinSceneDuplicates.length;
    row.adjacentDuplicates = report.photos.adjacentDuplicates.length;
    row.readingRateViolations = report.text.readingRateViolations;
    row.coverage = report.photos.coverage;

    // THE AUTHORITATIVE TEXT VERDICT, not `report.text.estimatedOverflow`. That field is a
    // character-count heuristic (`length > 60 && no newline`) and it called overflow on every
    // album in this corpus — 8 to 10 captions each — while the real fitter had not run yet.
    // `fitTextInTimeline` is a separate orchestrator step, so a canary that stops at the build
    // and then reports the estimate is a canary that cries wolf on every run.
    const fitPath = path.join(workDir, "analysis", "text-fit.json");
    const fit = spawnSync(process.execPath,
      ["scripts/fitTextInTimeline.mjs", path.join(workDir, "timeline", "timeline.json"), "--out", fitPath],
      { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
    if (fit.status === 0 && fs.existsSync(fitPath)) {
      const textFit = JSON.parse(fs.readFileSync(fitPath, "utf8"));
      row.textBlockers = (textFit.blockers || []).length;
      row.textAdjusted = textFit.adjusted ?? null;
    } else {
      row.textBlockers = null;
      row.textFitError = (fit.stderr || fit.stdout || "").split("\n").find((line) => line.includes("Error:")) || "fitter did not run";
    }

    if (checkDeterminism) {
      const second = build(workDir);
      row.deterministic = second.ok && asBuilt.equals(fs.readFileSync(timelinePath));
      if (!second.ok) row.rebuildError = "second build failed — not a determinism result";
    }
  }
  results.push(row);
  fs.rmSync(workDir, { recursive: true, force: true });
  console.log(`[canary] ${label.padEnd(20)} ${row.built ? "built" : "FAILED"} ${String(row.photos).padStart(4)} ảnh`
    + (row.built ? ` · ${row.scenes} scenes · drift ${row.drift}s · dup ${row.withinSceneDuplicates}`
      + ` · text blockers ${row.textBlockers ?? "n/a"}${row.deterministic === false ? " · NON-DETERMINISTIC" : ""}` : ` · ${row.error}`));
}

// §11's build-decidable metrics, each as a named violation rather than one pass/fail bit —
// "the canary is red" is not an actionable sentence.
const violations = [];
const failed = results.filter((row) => !row.built);
if (failed.length) violations.push({ metric: "build_success", detail: failed.map((row) => `${row.label}: ${row.error}`) });
const drifted = results.filter((row) => row.built && Math.abs(row.drift) > 0.1);
if (drifted.length) violations.push({ metric: "music_drift", detail: drifted.map((row) => `${row.label}: ${row.drift}s`) });
const duplicated = results.filter((row) => row.withinSceneDuplicates > 0);
if (duplicated.length) violations.push({ metric: "within_scene_duplicate", detail: duplicated.map((row) => `${row.label}: ${row.withinSceneDuplicates}`) });
const overflowed = results.filter((row) => row.textBlockers > 0);
if (overflowed.length) violations.push({ metric: "text_overflow", detail: overflowed.map((row) => `${row.label}: ${row.textBlockers} blocker(s)`) });
const unfitted = results.filter((row) => row.built && row.textBlockers === null);
if (unfitted.length) violations.push({ metric: "text_fit_unavailable", detail: unfitted.map((row) => `${row.label}: ${row.textFitError}`) });
const nondeterministic = results.filter((row) => row.deterministic === false);
if (nondeterministic.length) violations.push({ metric: "determinism", detail: nondeterministic.map((row) => row.label) });

const report = {
  version: 1, generatedAt: new Date().toISOString(),
  corpus: albums.length, cases: results.length,
  determinismChecked: checkDeterminism,
  // Written down because a canary that does not say what it FAILED to cover reads as if it
  // covered everything. No album on disk has a track under 189s.
  uncovered: ["short-music (no analysed track under 189s exists on disk)"],
  results, violations,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
fs.rmSync(workRoot, { recursive: true, force: true });

console.log(`\n[canary] ${results.filter((row) => row.built).length}/${results.length} built`
  + `, ${violations.length} metric violation(s)`);
for (const violation of violations) console.warn(`[canary] ${violation.metric}: ${violation.detail.join(" | ")}`);
console.log(`[canary] uncovered: ${report.uncovered.join(", ")}`);
console.log(`[canary] ${path.relative(root, outPath).replace(/\\/g, "/")}`);
process.exit(strict && violations.length ? 1 : 0);
