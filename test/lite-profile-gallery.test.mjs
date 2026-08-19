// The per-profile regression gallery — Phase 6 of docs/LITE-QUALITY-STABILITY-PLAN.md.
//
// test/lite-style-profiles.test.mjs already proves the three profiles are distinct AS A
// TABLE. This one builds the same album three times and proves the distinctness survives
// into the film, which is the only place a customer can see it.
//
// It also guards the bug that made the gallery necessary: `styleProfile` in project.json
// was rejected by schema/project.schema.json (`additionalProperties: false`), so the
// `requested` branch of resolveLiteStyleProfile could never run outside a unit test and a
// profile could only ever be guessed from prompt keywords. `provenance === "requested"`
// below is that regression test.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  VIETNAMESE_PROBE, compareFingerprints, fontCodepointCoverage,
} from "../scripts/lib/liteProfileGallery.mjs";

const root = process.cwd();

/** A Lite project on disk. The generators never stat the image files, so photo records are
 *  enough — the same shape lite-tier.test.mjs drives. */
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmp-lite-gallery-"));
  fs.mkdirSync(path.join(dir, "input"));
  fs.mkdirSync(path.join(dir, "music"));
  fs.mkdirSync(path.join(dir, "analysis", "music"), { recursive: true });
  fs.writeFileSync(path.join(dir, "music", "track.mp3"), "fixture");

  const photos = Array.from({ length: 40 }, (_, index) => ({
    file: `photo-${String(index + 1).padStart(3, "0")}.jpg`,
    orient: index % 3 === 0 ? "portrait" : "landscape",
    subjectCount: index % 5 === 0 ? 1 : 2,
    qualityNorm: +(0.5 + (index % 10) / 20).toFixed(2),
    openingScore: index === 0 ? 1 : 0.1,
    closingScore: index === 39 ? 1 : 0.1,
  }));
  fs.writeFileSync(path.join(dir, "analysis", "photos.json"), JSON.stringify({ photos }));

  const story = {
    title: "Tân & Hằng",
    closing: "Hẹn gặp lại ở đám cưới của chúng mình",
    beats: Array.from({ length: 6 }, (_, i) => ({
      heading: `Chương ${i + 1}`,
      body: `Một kỷ niệm nhỏ của chúng mình, số ${i + 1}.`,
      emotion: "warm", sceneKind: "single", preferredPhotos: [],
    })),
  };
  fs.writeFileSync(path.join(dir, "analysis", "story-template.generated.json"), JSON.stringify(story));

  fs.writeFileSync(path.join(dir, "analysis", "music", "track.json"), JSON.stringify({
    analysisVersion: 2, duration: 120, bpmEstimate: 120,
    beatGrid: { beatSeconds: 0.5 },
    sections: [
      { kind: "calm", start: 0, end: 30 }, { kind: "build", start: 30, end: 60 },
      { kind: "calm", start: 60, end: 90 }, { kind: "build", start: 90, end: 120 },
    ],
    phrases: Array.from({ length: 16 }, (_, index) => ({ index, time: index * 8 })).filter((row) => row.time < 120),
    downbeats: Array.from({ length: 30 }, (_, index) => ({ index, time: index * 4 })).filter((row) => row.time < 120),
  }));

  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({
    version: 1, id: "lite-gallery-test", name: "Lite gallery test",
    inputDir: "input", music: ["music/track.mp3"], analysisDir: "analysis",
    timeline: "timeline/timeline.json", output: "output/final.mp4",
    quality: "draft", tier: "lite",
  }));
  return dir;
}

function buildGallery() {
  const dir = fixture();
  const out = path.join(dir, "gallery.json");
  const result = spawnSync(process.execPath,
    ["scripts/generateLiteProfileGallery.mjs", "--project", dir, "--out", out],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return { report: JSON.parse(fs.readFileSync(out, "utf8")), dir };
}

test("every Lite profile builds, and the profile asked for is the profile used", () => {
  const { report } = buildGallery();
  assert.equal(report.profiles.length, 3);
  for (const fingerprint of report.profiles) {
    // The schema regression: a rejected `styleProfile` would silently fall back to
    // prompt-guessing, and provenance would read "fallback" for all three.
    assert.equal(fingerprint.provenance, "requested", `${fingerprint.profile} did not honour the requested profile`);
    assert.ok(fingerprint.scenes > 0, `${fingerprint.profile} produced no scenes`);
  }
  const themes = new Set(report.profiles.map((fingerprint) => fingerprint.libraryTheme));
  assert.equal(themes.size, 3, "three profiles must reach three library themes");
});

test("all three profiles clear the same technical gates", () => {
  const { report } = buildGallery();
  for (const fingerprint of report.profiles) {
    assert.equal(fingerprint.photos.withinSceneDuplicates, 0, `${fingerprint.profile} repeats a photo inside a scene`);
    assert.ok(Math.abs(fingerprint.drift) <= 0.1, `${fingerprint.profile} drifts ${fingerprint.drift}s from the track`);
    assert.equal(fingerprint.photos.usedUnique, fingerprint.photos.references,
      `${fingerprint.profile} reuses a photo the budget did not ask it to`);
  }
  // Fonts are the one profile dimension that can fail invisibly: the render succeeds and
  // the customer gets tofu. `findings` carries a font entry only if a cmap scan came back
  // short, so this is the "Font pairing hiển thị đúng tiếng Việt" acceptance in §7 Phase 6.
  const fontFindings = report.findings.filter((finding) => finding.check.startsWith("font_"));
  assert.deepEqual(fontFindings, [], `Vietnamese coverage gap: ${JSON.stringify(fontFindings)}`);
});

// A RATCHET, NOT A TARGET. Measured on the 84-photo Tuân Tiên job at the time of writing:
// mean overlap 0.50–0.57, effects 0.14–0.28, transitions 0.43, layouts 0.94–1.00.
//
// Layouts are the known gap: a profile has no layout palette, so all three draw the whole
// library and land on nearly the same set. That is recorded as debt in the plan rather than
// asserted here — asserting a defect holds is how a defect becomes a requirement. The
// ceiling is set just above today's worst pair so the number can only come down.
test("profiles stay materially distinct in the film they produce", () => {
  const { report } = buildGallery();
  assert.equal(report.pairs.length, 3);
  for (const pair of report.pairs) {
    assert.ok(!pair.sameTheme, `${pair.a} and ${pair.b} share a library theme`);
    assert.ok(pair.effects <= 0.5,
      `${pair.a} vs ${pair.b}: effect vocabularies overlap ${pair.effects}, above the 0.5 ceiling`);
    assert.ok(pair.overlap <= 0.65,
      `${pair.a} vs ${pair.b}: overall overlap ${pair.overlap} regressed past the 0.65 ceiling`);
  }
});

test("the Vietnamese cmap scan reads real fonts and refuses to guess about the rest", () => {
  // Every display face the three profiles can reach, checked directly rather than trusting
  // a `subsets: ["vietnamese"]` metadata field that does not agree with the TTF.
  for (const font of ["fonts/CormorantGaramond-Regular.ttf", "fonts/Fraunces-Regular.ttf",
    "fonts/PlayfairDisplay.ttf", "fonts/BeVietnamPro-Regular.ttf", "fonts/Allura-Regular.ttf"]) {
    const coverage = fontCodepointCoverage(path.resolve(root, font));
    assert.ok(coverage.readable, `${font} could not be parsed: ${coverage.reason}`);
    assert.equal(coverage.checked, new Set([...VIETNAMESE_PROBE]).size);
    assert.deepEqual(coverage.missing, [], `${font} is missing ${coverage.missing.join("")}`);
  }
  // A file that is not a font must report unreadable, never an empty (clean-looking) miss list.
  const notAFont = fontCodepointCoverage(path.resolve(root, "package.json"));
  assert.equal(notAFont.readable, false);
  assert.equal(notAFont.missing.length, 0);
  assert.equal(fontCodepointCoverage(path.resolve(root, "does-not-exist.ttf")).readable, false);
});

test("the comparison names collisions instead of averaging them away", () => {
  const base = {
    profile: "a", libraryTheme: "same", effects: ["x"], transitions: ["t"], layouts: ["l"],
    fonts: [], fontCoverage: {}, drift: 0, photos: { withinSceneDuplicates: 0 },
  };
  const { findings } = compareFingerprints([base, { ...base, profile: "b" }]);
  const checks = findings.map((finding) => finding.check);
  assert.ok(checks.includes("profile_theme_collision"));
  assert.ok(checks.includes("profile_effect_collision"));

  const drifting = { ...base, profile: "c", libraryTheme: "other", effects: ["y"], drift: 0.4 };
  assert.ok(compareFingerprints([base, drifting]).findings.some((finding) => finding.check === "music_drift"));
});
