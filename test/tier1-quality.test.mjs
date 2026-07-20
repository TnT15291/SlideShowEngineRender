import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { assignPhotos } from "../scripts/lib/photoAssignment.mjs";
import { applyStoryArc, deriveRoleScores, snapScenesToPhrases } from "../scripts/lib/tier1Editorial.mjs";
import { createTransitionGrammar } from "../scripts/lib/transitionGrammar.mjs";
import { buildDiversityReport } from "../scripts/lib/diversityPlanner.mjs";
import { createMotionPlanner } from "../scripts/lib/motionPlanner.mjs";
import { buildColorNormalization } from "../scripts/lib/colorNormalizer.mjs";
import { makePreviewCut } from "../scripts/lib/previewCut.mjs";
import { buildContactSheetReport } from "../scripts/lib/contactSheetReport.mjs";
import { retargetTimeline } from "../scripts/lib/socialRetarget.mjs";
import { compareRegression, hammingHex } from "../scripts/lib/regressionFrames.mjs";
import { aggregateFeedback, anonymousProjectId } from "../scripts/lib/feedbackLedger.mjs";
import { revisionInvalidation, invalidateApproval } from "../scripts/lib/revisionInvalidation.mjs";
import { evaluateTier1Quality } from "../scripts/lib/tier1QualityGate.mjs";
import { solveRecipeShotList } from "../scripts/lib/recipeShotList.mjs";
import { createRequire } from "node:module";
const { fingerprintFiles, validateFingerprint } = createRequire(import.meta.url)("../scripts/lib/approvalFingerprint.cjs");
const { currentSelection, validateApprovedSelection } = createRequire(import.meta.url)("../scripts/lib/previewApproval.cjs");

const root = process.cwd();

test("every recipe offers three to five pacing variants", () => {
  for (const file of fs.readdirSync("story-templates").filter((f) => f.endsWith(".json"))) {
    const recipe = JSON.parse(fs.readFileSync(path.join("story-templates", file), "utf8"));
    assert.ok(recipe.pacingVariants.length >= 3 && recipe.pacingVariants.length <= 5, file);
  }
});

test("transition grammar caps special transitions and stays in vocabulary", () => {
  const grammar = createTransitionGrammar({ default: { type: "crossfade" }, peak: { type: "radial" }, final: { type: "none" } },
    { vocabulary: ["crossfade", "radial", "none"], specialRoles: ["peak"], limits: { peak: 1 } });
  assert.equal(grammar.select("peak", false).type, "radial");
  assert.equal(grammar.select("peak", false).type, "crossfade");
  assert.ok(grammar.decisions.every((d) => grammar.vocabulary.includes(d.type)));
});

test("diversity evaluates scenes, not matching portraits inside one triptych", () => {
  const photos = [1, 2, 3].map((n) => ({ file: `${n}.jpg`, orient: "portrait", subjectCount: 1 }));
  const assignments = new Map([["triptych:p", photos.map((p) => p.file)]]);
  const oneScene = buildDiversityReport({ scenes: [{ id: "triptych", effect: "layer_scene", layout: "three_photo_row" }], assignments, photos });
  assert.equal(oneScene.warnings.length, 0);
});

test("diversity flags three repeated scene states unless recipe allows the sequence", () => {
  const photos = [1, 2, 3].map((n) => ({ file: `${n}.jpg`, orient: "portrait", subjectCount: 1 }));
  const assignments = new Map(photos.map((p, i) => [`s${i + 1}:hero`, [p.file]]));
  const scenes = photos.map((_, i) => ({ id: `s${i + 1}`, effect: "still" }));
  assert.equal(buildDiversityReport({ scenes, assignments, photos }).warnings.length, 1);
  scenes[1].allowSequence = true;
  assert.equal(buildDiversityReport({ scenes, assignments, photos }).warnings.length, 0);
});

test("diversity flags an adjacent same-layout pair even when a third scene breaks the run", () => {
  const photos = [
    { file: "1.jpg", orient: "portrait", subjectCount: 1 },
    { file: "2.jpg", orient: "portrait", subjectCount: 1 },
    { file: "3.jpg", orient: "portrait", subjectCount: 2 },
  ];
  const assignments = new Map(photos.map((p, i) => [`s${i + 1}:bg`, [p.file]]));
  const scenes = [
    { id: "s1", effect: "layer_scene", layout: "full_bleed_quote" },
    { id: "s2", effect: "layer_scene", layout: "full_bleed_quote" },
    { id: "s3", effect: "polaroid" },
  ];
  const report = buildDiversityReport({ scenes, assignments, photos });
  assert.equal(report.warnings.length, 1);
  assert.deepEqual(report.warnings[0].sceneIds, ["s1", "s2"]);
  assert.equal(report.warnings[0].adjacentPair, true);
  assert.equal(report.verdict, "review");
  scenes[1].allowSequence = true;
  assert.equal(buildDiversityReport({ scenes, assignments, photos }).warnings.length, 0);
});

test("diversity's people signal abstains when faces were never counted", () => {
  // Same photoCount + orientation across three DIFFERENT layouts: only a degenerate
  // "unknown === unknown" people match could push this over the 3-signal threshold.
  const photos = [1, 2, 3].map((n) => ({ file: `${n}.jpg`, orient: "portrait" }));
  const assignments = new Map(photos.map((p, i) => [`s${i + 1}:hero`, [p.file]]));
  const scenes = [
    { id: "s1", effect: "layer_scene", layout: "full_bleed_quote" },
    { id: "s2", effect: "still" },
    { id: "s3", effect: "slow_zoom_in" },
  ];
  assert.equal(buildDiversityReport({ scenes, assignments, photos }).warnings.length, 0);
  // With real face counts the same run IS three matching signals again.
  const counted = photos.map((p) => ({ ...p, subjectCount: 1 }));
  assert.equal(buildDiversityReport({ scenes, assignments, photos: counted }).warnings.length, 1);
});

test("motion planner protects groups and aims hero motion at the subject", () => {
  const planner = createMotionPlanner();
  const group = planner.plan({ file: "group.jpg", subjectCount: 6, focusX: 0.5, focusY: 0.4 }, { id: "family", arcBeat: "family" }, { isHero: true });
  assert.equal(group.motion, "zoom_in");
  assert.ok(group.strength <= 0.03);
  const portrait = planner.plan({ file: "bride.jpg", subjectCount: 1, orient: "portrait", focusX: 0.8, focusY: 0.35 }, { id: "bride", arcBeat: "connection" }, { isHero: true });
  assert.equal(portrait.motion, "pan_right");
  assert.deepEqual(portrait.target, { x: 0.8, y: 0.35 });
  assert.equal(planner.plan({ file: "end.jpg", subjectCount: 2 }, { id: "end", arcBeat: "closing" }, { isHero: true }).motion, "none");
});

test("color normalization is album-relative and bounded", () => {
  const report = buildColorNormalization([
    { file: "dark.jpg", meanLuma: 70, meanRgb: { r: 120, g: 80, b: 60 }, colorfulness: 0.3, subjectCount: 2 },
    { file: "neutral.jpg", meanLuma: 130, meanRgb: { r: 128, g: 128, b: 128 }, colorfulness: 0.25 },
    { file: "bright.jpg", meanLuma: 190, meanRgb: { r: 110, g: 140, b: 175 }, colorfulness: 0.3 },
  ]);
  assert.ok(report.decisions[0].brightness > 0 && report.decisions[2].brightness < 0);
  assert.ok(report.decisions.every((d) => Math.abs(d.brightness) <= 0.12 && d.saturation >= 0.9 && d.saturation <= 1.1));
  assert.ok(report.decisions[0].redBalance < 0 && report.decisions[2].blueBalance < 0);
});

test("preview cut samples the emotional arc and stays short", () => {
  const slides = ["hook", "establish", "connection", "build", "family", "peak", "breathe", "closing"].map((beat, i) =>
    ({ id: `${i}`, editorialBeat: beat, duration: 6, transition: { type: "crossfade", duration: 1 } }));
  const cut = makePreviewCut({ project: { quality: "share" }, output: { path: "full.mp4" }, slides }, { duration: 20, output: "preview.mp4" });
  assert.deepEqual(cut.slides.map((s) => s.editorialBeat), ["hook", "connection", "build", "peak", "closing"]);
  assert.equal(cut.output.path, "preview.mp4");
  assert.equal(cut.project.quality, "draft");
  assert.ok(cut.slides.reduce((n, s) => n + s.duration, 0) <= 20.1);
});

test("preview cut includes the riskiest scene", () => {
  const slides = ["hook", "connection", "build", "peak", "closing", "family"].map((beat, i) =>
    ({ id: beat, editorialBeat: beat, duration: 5, transition: { type: "crossfade", duration: 1 },
      layers: beat === "family" ? [{ type: "text", text: "x".repeat(200) }, { type: "image", fit: "cover" }, { type: "image", fit: "cover" }] : [] }));
  const cut = makePreviewCut({ project: {}, output: { path: "full.mp4" }, slides }, { duration: 20 });
  assert.ok(cut.preview.sourceSceneIds.includes("family"));
  assert.ok(cut.preview.riskSceneIds.includes("family"));
});

test("approval fingerprint detects changed or missing inputs", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-approval-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "recipe.json"), "one");
  fs.writeFileSync(path.join(dir, "direction.json"), "two");
  const fingerprint = fingerprintFiles(dir, ["recipe.json", "direction.json"]);
  assert.equal(validateFingerprint(dir, fingerprint).ok, true);
  fs.writeFileSync(path.join(dir, "direction.json"), "changed");
  assert.equal(validateFingerprint(dir, fingerprint).ok, false);
  fs.rmSync(path.join(dir, "recipe.json"));
  assert.match(validateFingerprint(dir, fingerprint).reason, /missing/i);
});

test("desktop approval rejects stale generations, changed recipes and changed inputs", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-desktop-approval-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, "direction.json"), "one");
  const selection = { status: "approved", previewGeneratedAt: "g1", recipeId: "warm",
    fingerprint: fingerprintFiles(dir, ["direction.json"]) };
  assert.equal(currentSelection({ generatedAt: "g2" }, selection), null);
  assert.equal(validateApprovedSelection(dir, { generatedAt: "g1" }, selection, { recipe: "dark" }).ok, false);
  assert.equal(validateApprovedSelection(dir, { generatedAt: "g1" }, selection, { recipe: "warm" }).ok, true);
  fs.writeFileSync(path.join(dir, "direction.json"), "two");
  assert.equal(validateApprovedSelection(dir, { generatedAt: "g1" }, selection, { recipe: "warm" }).ok, false);
});

test("revision invalidation preserves caption approvals but invalidates creative rebuilds", () => {
  assert.deepEqual(revisionInvalidation([{ kind: "caption" }], "timeline"), { reenter: "render", requiresReapproval: false });
  assert.deepEqual(revisionInvalidation([{ kind: "pacing" }], "build"), { reenter: "build", requiresReapproval: true });
  let value = JSON.stringify({ status: "approved", id: "balanced" });
  const changed = invalidateApproval({ read: () => value, write: (next) => { value = next; } }, { round: 2, radius: "build" });
  assert.equal(changed, true);
  const doc = JSON.parse(value);
  assert.equal(doc.status, "invalidated");
  assert.deepEqual(doc.invalidation.round, 2);
});

test("contact sheet merges QA flags and checks must-use coverage", () => {
  const timeline = { project: { name: "x" }, photoAssignment: { customerLocks: { mustUsePhotos: ["must.jpg"] } }, slides: [
    { id: "a", duration: 5, effect: "still", image: "other.jpg", transition: { duration: 1 }, captions: [] },
    { id: "b", duration: 5, effect: "still", image: "must.jpg", transition: { duration: 0 }, captions: [] },
  ] };
  const report = buildContactSheetReport({ timeline, proxy: { problems: [{ id: "a", flags: ["unsafe_crop"] }] }, clip: null, diversity: null, color: null, photos: [] });
  assert.equal(report.scenes[0].status, "error");
  assert.equal(report.scenes[1].start, 4);
  assert.deepEqual(report.coverage.missingMustUse, []);
  assert.equal(report.verdict, "error");
});

test("Tier-1 quality gate blocks must-use, unsafe text and broken closing cards", () => {
  const timeline = { project: { width: 1000, height: 600 }, photoAssignment: { customerLocks: { mustUsePhotos: ["required.jpg"] } }, slides: [
    { id: "hook", duration: 4, effect: "still", image: "other.jpg", layers: [{ type: "text", x: 0, y: 20, width: 400, height: 100 }] },
    { id: "last", duration: 1, effect: "still", layers: [] },
  ] };
  const gate = evaluateTier1Quality(timeline, { enforceClosing: true });
  assert.equal(gate.verdict, "error");
  assert.deepEqual(new Set(gate.errors.flatMap((e) => e.flags)), new Set(["missing_must_use", "text_outside_safe_area", "missing_closing_card"]));
});

test("Tier-1 quality gate separates warnings and manual review from blockers", () => {
  const slides = Array.from({ length: 5 }, (_, i) => ({ id: i === 4 ? "closing" : `s${i}`, editorialBeat: i === 4 ? "closing" : "build",
    duration: 4, effect: "still", layout: "full", layers: [] }));
  const gate = evaluateTier1Quality({ project: { width: 1000, height: 600 }, overlays: [{ variant: "warm" }], slides });
  assert.equal(gate.errors.length, 0);
  assert.ok(gate.warnings.some((f) => f.flags.includes("layout_run_exceeded")));
  assert.ok(gate.manualReview.some((f) => f.flags.includes("full_film_overlay")));
  assert.equal(gate.verdict, "manual-review");
});

test("social retarget keeps layers inside canvas and protects group photos", () => {
  const timeline = { project: { name: "x", width: 1920, height: 1080 }, output: { path: "x.mp4" }, slides: [{ id: "a", effect: "layer_scene", duration: 4,
    transition: { type: "none", duration: 0 }, captions: [], layers: [
      { type: "rect", x: 0, y: 0, width: 1920, height: 1080, color: "white", opacity: 1 },
      { type: "image", path: "group.jpg", x: 100, y: 100, width: 900, height: 800, fit: "cover", motion: "zoom_in", motionStrength: 0.08 },
      { type: "text", text: "Names", x: 1100, y: 400, width: 700, height: 200, size: 100, color: "black" },
    ] }] };
  const out = retargetTimeline(timeline, { width: 1080, height: 1920, output: "v.mp4", photos: [{ file: "group.jpg", orient: "landscape", subjectCount: 5 }] });
  const layers = out.slides[0].layers;
  assert.ok(layers.every((l) => l.x >= 0 && l.y >= 0 && l.x + l.width <= 1080 && l.y + l.height <= 1920));
  const image = layers.find((l) => l.type === "image");
  assert.equal(image.fit, "contain");
  assert.ok(image.motionStrength <= 0.025);
});

test("visual regression separates small drift from structural change", () => {
  assert.equal(hammingHex("0000000000000000", "0000000000000001"), 1);
  const baseline = { signature: "a", frames: [{ beat: "hook", hash: "0000000000000000" }] };
  assert.equal(compareRegression({ signature: "a", frames: [{ beat: "hook", hash: "0000000000000001" }] }, baseline).verdict, "pass");
  assert.equal(compareRegression({ signature: "b", frames: [{ beat: "hook", hash: "0000000000000001" }] }, baseline).verdict, "changed");
});

test("feedback ranking rewards approval and penalizes revisions without exposing project ids", () => {
  const project = anonymousProjectId("customer-name"); assert.equal(project.length, 16); assert.ok(!project.includes("customer"));
  const ranking = aggregateFeedback([
    { project, type: "preview_selected", recipeId: "warm", pacing: "balanced", data: {} },
    { project, type: "preview_approved", recipeId: "warm", pacing: "balanced", data: { source: "user" } },
    { project: "b", type: "revision_requested", recipeId: "dark", pacing: "lively", data: {} },
  ]);
  assert.equal(ranking[0].recipeId, "warm"); assert.ok(ranking[0].adjustedScore > 0); assert.ok(ranking.at(-1).adjustedScore < 0);
});

test("deterministic QA reports overflow, adjacent reuse and unsafe crop", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-qa-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const timeline = path.join(dir, "timeline.json");
  const out = path.join(dir, "qa.json");
  const photos = path.join(dir, "photos.json");
  fs.writeFileSync(photos, JSON.stringify({ photos: [{
    file: "same.jpg", w: 1600, h: 900, duplicateGroup: "dup-001",
    faceBoxEstimate: { x: 0.05, y: 0.2, width: 0.18, height: 0.3 },
  }] }));
  fs.writeFileSync(timeline, JSON.stringify({
    project: { width: 1920, height: 1080, fps: 30, quality: "draft" },
    output: { path: path.join(dir, "missing.mp4") },
    slides: [
      { id: "a", duration: 5, effect: "layer_scene", transition: { type: "none", duration: 0 }, captions: [], layers: [
        { type: "image", path: "same.jpg", x: 0, y: 0, width: 100, height: 100, fit: "cover", focusX: 0.99, focusY: 0.5 },
        { type: "text", text: "A very long sentence that cannot possibly fit", font: "fonts/x.ttf", x: 0, y: 0, width: 80, height: 20, size: 40 },
      ] },
      { id: "b", duration: 5, effect: "still", image: "same.jpg", transition: { type: "none", duration: 0 }, captions: [] },
    ],
  }));
  const result = spawnSync(process.execPath, ["scripts/qaProxy.mjs", timeline, "--photos", photos, "--out", out], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(report.checks.textOverflow.flagged, 1);
  assert.equal(report.checks.duplicates.flagged, 1);
  assert.equal(report.checks.crop.flagged, 1);
  assert.ok(report.checks.crop.layers[0].flags.includes("face_cropped"));
  const cropFix = report.problems.find((problem) => problem.check === "crop").fix;
  assert.ok(cropFix.focusX >= 0.08 && cropFix.focusX <= 0.92);
  assert.ok(cropFix.focusY >= 0.08 && cropFix.focusY <= 0.92);
  assert.equal(report.checks.captionIntegrity.status, "ran");
  assert.equal(report.verdict, "review");
});

test("photo analysis groups renamed copies by perceptual content", (t) => {
  const sourceA = path.join(root, "input", "001.jpg");
  const sourceB = path.join(root, "input", "002.jpg");
  if (!fs.existsSync(sourceA) || !fs.existsSync(sourceB)) return t.skip("sample input photos unavailable");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-duplicates-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.copyFileSync(sourceA, path.join(dir, "renamed-a.jpg"));
  fs.copyFileSync(sourceA, path.join(dir, "renamed-copy.jpg"));
  fs.copyFileSync(sourceB, path.join(dir, "different.jpg"));
  const out = path.join(dir, "photos.json");
  const result = spawnSync(process.execPath, ["scripts/analyzePhotos.mjs", "--dir", dir, "--out", out], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  const a = doc.photos.find((p) => p.file.endsWith("renamed-a.jpg"));
  const copy = doc.photos.find((p) => p.file.endsWith("renamed-copy.jpg"));
  assert.equal(a.perceptualHash, copy.perceptualHash);
  assert.equal(a.duplicateGroup, copy.duplicateGroup);
  assert.equal(doc.photos.filter((p) => p.duplicateRepresentative).length, 1);
});

test("Tier-1 direction records whitelisted style and multi-signal pacing", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-direction-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prompt = path.join(dir, "prompt.txt"), photos = path.join(dir, "photos.json");
  const music = path.join(dir, "music.json"), out = path.join(dir, "direction.json");
  fs.writeFileSync(prompt, "Hiện đại tối giản, nhịp nhanh, sạch và không overlay.");
  fs.writeFileSync(photos, JSON.stringify({ photos: Array.from({ length: 90 }, (_, i) => ({ file: `${i}.jpg` })) }));
  fs.writeFileSync(music, JSON.stringify({ duration: 120, bpmEstimate: 145, energy: { mean: 0.72 },
    sections: [{ kind: "build", dur: 50 }, { kind: "normal", dur: 70 }] }));
  const result = spawnSync(process.execPath, ["scripts/chooseTier1Direction.mjs",
    "--recipe", "story-templates/modern-teal-01.json", "--prompt", prompt,
    "--photos", photos, "--music", music, "--out", out], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(doc.style.themeId, "modern_teal");
  assert.equal(doc.style.overlayId, "none");
  assert.equal(doc.style.overlays.length, 0);
  assert.equal(doc.pacing.class, "lively");
  assert.equal(doc.pacing.controls.repeatLimit, 3);
  assert.ok(doc.style.fonts.heading && doc.style.fonts.body);
  assert.equal(doc.generatedBy, "rules");
});

test("Tier-1 direction clamps montage density when the album is below the recipe's floor", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-capacity-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const prompt = path.join(dir, "prompt.txt"), photos = path.join(dir, "photos.json");
  const music = path.join(dir, "music.json"), out = path.join(dir, "direction.json");
  fs.writeFileSync(prompt, "Nhịp nhanh, sôi động.");
  fs.writeFileSync(photos, JSON.stringify({ photos: Array.from({ length: 12 }, (_, i) => ({ file: `${i}.jpg` })) }));
  fs.writeFileSync(music, JSON.stringify({ duration: 120, bpmEstimate: 145, energy: { mean: 0.72 },
    sections: [{ kind: "build", dur: 50 }, { kind: "normal", dur: 70 }] }));
  const result = spawnSync(process.execPath, ["scripts/chooseTier1Direction.mjs",
    "--recipe", "story-templates/modern-teal-01.json", "--prompt", prompt,
    "--photos", photos, "--music", music, "--out", out], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  // 12 photos < modern-teal's floor of 30: a lively track must not buy extra montage
  // density the pool cannot pay for, and the clamp must say why it is there.
  assert.equal(doc.pacing.class, "lively");
  assert.equal(doc.pacing.controls.repeatLimit, 1);
  assert.ok(doc.pacing.controls.montagePhotoMultiplier <= 1);
  assert.equal(doc.pacing.capacityLimited.availablePhotos, 12);
  assert.equal(doc.pacing.capacityLimited.recipeMinPhotos, 30);
});

test("global assignment reserves scarce orientations before flexible slots", () => {
  const photos = [
    { file: "only-portrait.jpg", orient: "portrait", qualityNorm: 0.6 },
    { file: "best-wide.jpg", orient: "landscape", qualityNorm: 1 },
    { file: "other-wide.jpg", orient: "landscape", qualityNorm: 0.5 },
  ];
  const requests = [
    { key: "early:flex", order: 0, count: 1, orient: "any", hero: false },
    { key: "late:portrait", order: 1, count: 1, orient: "portrait", hero: false },
    { key: "hero:wide", order: 2, count: 1, orient: "landscape", hero: true },
  ];
  const plan = assignPhotos({ photos, requests });
  assert.deepEqual(plan.assignments.get("late:portrait"), ["only-portrait.jpg"]);
  assert.deepEqual(plan.assignments.get("hero:wide"), ["best-wide.jpg"]);
  assert.deepEqual(plan.assignments.get("early:flex"), ["other-wide.jpg"]);
  assert.equal(plan.unfilled.length, 0);
});

test("chronological assignment follows uploadIndex instead of editorial quality", () => {
  const photos = [
    { file: "late-best.jpg", orient: "landscape", qualityNorm: 1, uploadIndex: 2 },
    { file: "first.jpg", orient: "landscape", qualityNorm: 0.1, uploadIndex: 0 },
    { file: "second.jpg", orient: "landscape", qualityNorm: 0.5, uploadIndex: 1 },
  ];
  const requests = [
    { key: "scene-1", order: 0, count: 1, orient: "landscape" },
    { key: "scene-2", order: 1, count: 1, orient: "landscape" },
  ];
  const editorial = assignPhotos({ photos, requests });
  const chronological = assignPhotos({ photos, requests, sequenceMode: "chronological" });
  assert.deepEqual([...editorial.assignments.values()].flat(), ["late-best.jpg", "second.jpg"]);
  assert.deepEqual([...chronological.assignments.values()].flat(), ["first.jpg", "second.jpg"]);
});

test("editorial assignment is stable when upload order changes", () => {
  const photos = [
    { file: "02.jpg", orient: "landscape", qualityNorm: 0.8, uploadIndex: 0 },
    { file: "01.jpg", orient: "landscape", qualityNorm: 0.8, uploadIndex: 1 },
    { file: "03.jpg", orient: "landscape", qualityNorm: 0.5, uploadIndex: 2 },
  ];
  const requests = [{ key: "scene", order: 0, count: 2, orient: "landscape" }];
  const assigned = (pool) => [...assignPhotos({ photos: pool, requests }).assignments.values()].flat();
  assert.deepEqual(assigned(photos), ["01.jpg", "02.jpg"]);
  assert.deepEqual(assigned([...photos].reverse()), ["01.jpg", "02.jpg"]);
});

test("global assignment keeps perceptual duplicates out of neighbouring scenes", () => {
  const photos = [
    { file: "duplicate-a.jpg", orient: "landscape", qualityNorm: 1, duplicateGroup: "same-photo" },
    { file: "duplicate-b.jpg", orient: "landscape", qualityNorm: 0.99, duplicateGroup: "same-photo" },
    { file: "different.jpg", orient: "landscape", qualityNorm: 0.4 },
  ];
  const plan = assignPhotos({ photos, requests: [
    { key: "scene-1:wide", order: 0, count: 1, orient: "landscape" },
    { key: "scene-2:wide", order: 1, count: 1, orient: "landscape" },
  ] });
  const selected = [...plan.assignments.values()].flat();
  assert.ok(!(selected.includes("duplicate-a.jpg") && selected.includes("duplicate-b.jpg")));
  assert.equal(plan.unfilled.length, 0);
});

test("customer must-use preference outranks automatic quality", () => {
  const photos = [
    { file: "customer-choice.jpg", orient: "landscape", qualityNorm: 0.2 },
    { file: "automatic-best.jpg", orient: "landscape", qualityNorm: 1 },
  ];
  const plan = assignPhotos({ photos, requests: [
    { key: "story:wide", order: 0, count: 1, orient: "landscape", preferred: "customer-choice.jpg" },
  ] });
  assert.deepEqual(plan.assignments.get("story:wide"), ["customer-choice.jpg"]);
});

test("role scoring and assignment choose photos for the requested editorial job", () => {
  const detail = { file: "ring.jpg", orient: "landscape", qualityNorm: 0.7, detailScore: 0.98, heroScore: 0.3 };
  const hero = { file: "couple.jpg", orient: "landscape", qualityNorm: 0.8, detailScore: 0.2, heroScore: 0.99 };
  const plan = assignPhotos({ photos: [detail, hero], requests: [{ key: "detail", order: 0, count: 1, role: "detail" }] });
  assert.deepEqual(plan.assignments.get("detail"), ["ring.jpg"]);
  const scores = deriveRoleScores({ qualityNorm: 0.8, meanLuma: 128, orient: "landscape", faces: [] });
  assert.ok(scores.detailScore > scores.emotionScore);
});

test("story arc is explicit and scene boundaries snap to phrases", () => {
  const scenes = applyStoryArc(Array.from({ length: 8 }, (_, i) => ({ id: `${i}` })));
  assert.equal(scenes[0].arcBeat, "hook");
  assert.equal(scenes.at(-1).arcBeat, "closing");
  const result = snapScenesToPhrases([
    { id: "a", duration: 5.4, transition: { duration: 0.4 } },
    { id: "b", duration: 5, transition: { duration: 0 } },
  ], { phrases: [{ time: 5 }] });
  assert.equal(result.slides[0].duration, 5.4);
  assert.equal(result.snapped, 1);
});

// The library geometry IS the template tier's product; a slot that crosses the 5% title-safe
// margin makes qaProxy's tier-1 gate flag every recipe that uses it (it fired on 7 of 8 until
// the slots were pulled in). This locks the geometry the frame-hash regression suite cannot see.
test("every library text slot sits inside the 5% title-safe margin", () => {
  const lib = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));
  const W = 1920, H = 1080, mx = W * 0.05, my = H * 0.05;
  const offenders = [];
  for (const layout of lib.layouts) for (const t of layout.textSlots || []) {
    if (t.x < mx || t.y < my || t.x + t.width > W - mx || t.y + t.height > H - my) offenders.push(`${layout.id}.${t.id}`);
  }
  assert.deepEqual(offenders, [], `text slots cross the title-safe margin: ${offenders.join(", ")}`);
});

// recipeShotList repeats body scenes to spend the photo budget; a repeat with no authored
// variant goes MUTE. Driving the real solver on the photo-poor job that first exposed this,
// a scene that recurs must show its authored variant copy (>1 distinct line), never fall
// silent after the first use, and never repeat the same line. Strip the variants and s04_quote
// shows copy exactly once — this fails.
test("a repeated story scene consumes its authored variants instead of falling silent", () => {
  const recipe = JSON.parse(fs.readFileSync("story-templates/korean-soft-01.json", "utf8"));
  const photoDemandOf = (s) => (s.photoSlots || []).reduce((n, p) => n + (p.count || 1), 0);
  const { scenes } = solveRecipeShotList({ recipe, photoCount: 23, musicDuration: 203, durationOf: () => 5, photoDemandOf, bodyPhotoBudget: 19 });
  const spokenCopy = (id) => scenes.filter((s) => s.id === id || s.id.startsWith(`${id}_`))
    .map((s) => (s.text ? Object.values(s.text) : []).filter((v) => typeof v === "string" && v.trim()).join(" | "))
    .filter(Boolean);
  for (const id of ["s04_quote", "s05_story"]) { // both recur many times on this job
    const copy = spokenCopy(id);
    assert.ok(copy.length >= 2, `${id} repeats but speaks only once — its variants were not consumed`);
    assert.equal(new Set(copy).size, copy.length, `${id} shows the same line twice: ${copy.join(" / ")}`);
  }
});

// The regression this guards: the 4 recipes added in the eight-template commit shipped WITHOUT
// variants, so their story scenes fell silent on repeat. Each named narrative scene must offer
// at least one variant that actually carries copy (an all-empty variants list is the same bug).
test("the recipes added after the original four declare copy variants on their story scenes", () => {
  const required = {
    "classic-luxury-01": ["s03_ceremony", "s05_family"],
    "garden-botanical-01": ["s02_garden", "s04_family"],
    "korean-soft-01": ["s03_pair", "s04_quote", "s05_story"],
    "playful-scrapbook-01": ["s02_start", "s04_pair", "s06_roll"],
  };
  for (const [id, sceneIds] of Object.entries(required)) {
    const recipe = JSON.parse(fs.readFileSync(`story-templates/${id}.json`, "utf8"));
    for (const sceneId of sceneIds) {
      const scene = recipe.scenes.find((s) => s.id === sceneId);
      assert.ok(scene, `${id}: scene ${sceneId} is missing`);
      const variants = scene.repeatable?.variants || [];
      const hasCopy = variants.some((v) => (v.text && Object.values(v.text).some((x) => String(x).trim())) || String(v.captionPattern || "").trim());
      assert.ok(hasCopy, `${id}: ${sceneId} declares no copy variant — its repeats will be silent`);
    }
  }
});

// A cold-open recipe puts the couple's names on the slide AFTER a text-less opening photo, so
// the names first appear at index 1, not 0. The closing card echoes them — a deliberate
// bookend, not a copy defect. The old exception only excused an echo of slide 0.
test("caption integrity treats a title-to-closing name echo as an intentional bookend after a cold open", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-bookend-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const photos = path.join(dir, "photos.json");
  fs.writeFileSync(photos, JSON.stringify({ photos: [] }));
  const textSlide = (id, text) => ({ id, duration: 5, effect: "layer_scene", transition: { type: "none", duration: 0 }, captions: [],
    layers: text
      ? [{ type: "text", text, x: 300, y: 300, width: 800, height: 200, size: 60 }]
      : [{ type: "image", path: "x.jpg", x: 0, y: 0, width: 1920, height: 1080, fit: "cover" }] });
  const runProxy = (slides) => {
    const tl = path.join(dir, "tl.json"), out = path.join(dir, "qa.json");
    fs.writeFileSync(tl, JSON.stringify({ project: { width: 1920, height: 1080, fps: 30, quality: "draft" },
      output: { path: path.join(dir, "missing.mp4") }, slides }));
    const r = spawnSync(process.execPath, ["scripts/qaProxy.mjs", tl, "--photos", photos, "--out", out], { cwd: root, encoding: "utf8" });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(fs.readFileSync(out, "utf8"));
  };
  const echo = runProxy([textSlide("cold_open", null), textSlide("title", "An & Binh"), textSlide("body", "A quiet start"), textSlide("closing", "An & Binh")]);
  assert.ok(!echo.problems.some((p) => p.check === "caption_integrity"), "opening title echoed on the closing card must not be a duplicate");
  const midFilm = runProxy([textSlide("cold_open", null), textSlide("title", "An & Binh"), textSlide("body", "An & Binh"), textSlide("closing", "The End")]);
  assert.ok(midFilm.problems.some((p) => p.check === "caption_integrity" && p.flags.includes("duplicate_caption")), "a genuine mid-film repeat must still flag");
});

// --strict is a gate in EVERY mode. qaLoop's --skip-render path used to exit 0 unconditionally,
// so a pre-flight-only strict run silently passed a timeline it should have blocked.
test("qaLoop --skip-render honours --strict on an unresolved manual-review finding", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-skiprender-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const analysisDir = path.join(dir, "analysis");
  fs.mkdirSync(analysisDir, { recursive: true });
  fs.writeFileSync(path.join(analysisDir, "photos.json"), JSON.stringify({ photos: [] }));
  const timeline = path.join(dir, "timeline.json");
  // A text layer shoved into the bleed → text_safe_area, a manual-review finding with no fix.
  fs.writeFileSync(timeline, JSON.stringify({ project: { width: 1920, height: 1080, fps: 30, quality: "draft" },
    output: { path: path.join(dir, "missing.mp4") }, slides: [
      { id: "a", duration: 5, effect: "layer_scene", transition: { type: "none", duration: 0 }, captions: [],
        layers: [{ type: "text", text: "Off the edge", x: -40, y: 300, width: 800, height: 200, size: 60 }] },
      { id: "closing", duration: 4, effect: "layer_scene", transition: { type: "none", duration: 0 }, captions: [], layers: [] },
    ] }));
  const runLoop = (extra) => spawnSync(process.execPath, ["scripts/qaLoop.mjs", "--timeline", timeline,
    "--analysis-dir", analysisDir, "--tier", "template", "--skip-render", ...extra], { cwd: root, encoding: "utf8" });
  assert.equal(runLoop([]).status, 0, "without --strict the finding is delivered with flags, not failed");
  assert.equal(runLoop(["--strict"]).status, 1, "with --strict an open manual-review finding must fail the gate");
});
