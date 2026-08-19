// Phase 6 of docs/LITE-QUALITY-STABILITY-PLAN.md: the per-profile regression gallery.
//
// Builds the SAME album three times, once per Lite style profile, and fingerprints the
// three timelines against each other. The album, the story, the music and — critically —
// the project id are held constant, because `nudgeGrade()` seeds off the id: give each
// profile its own id and the grades diverge for a reason that has nothing to do with the
// profile, and the comparison stops meaning anything.
//
// Usage:
//   node scripts/generateLiteProfileGallery.mjs --project projects/tuan-tien-lite
//   node scripts/generateLiteProfileGallery.mjs --project projects/x --out analysis/gallery.json --keep
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { LITE_STYLE_PROFILES } from "./lib/liteStyleProfiles.mjs";
import { profileFingerprint, compareFingerprints } from "./lib/liteProfileGallery.mjs";
import { stageLiteProject } from "./lib/stageLiteProject.mjs";

const root = process.cwd();
const arg = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};

const projectArg = arg("--project");
if (!projectArg) throw new Error("Usage: node scripts/generateLiteProfileGallery.mjs --project <dir> [--out report.json] [--profiles a,b] [--keep]");
const sourceDir = path.resolve(root, projectArg);
const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, "project.json"), "utf8"));
const requested = arg("--profiles").split(",").map((id) => id.trim()).filter(Boolean);
const profiles = requested.length ? requested : Object.keys(LITE_STYLE_PROFILES);
for (const id of profiles) if (!LITE_STYLE_PROFILES[id]) throw new Error(`Unknown Lite style profile "${id}"`);

const workRoot = path.resolve(root, "temp/lite-profile-gallery");
const outPath = path.resolve(root, arg("--out", path.join(projectArg, manifest.analysisDir || "analysis", "lite-profile-gallery.json")));
const keep = process.argv.includes("--keep");

const sourceAbs = (relative) => path.resolve(sourceDir, relative);
const analysisDir = manifest.analysisDir || "analysis";
const storyRel = manifest.story || `${analysisDir}/story-template.generated.json`;

for (const required of [`${analysisDir}/photos.json`, storyRel]) {
  if (!fs.existsSync(sourceAbs(required))) {
    throw new Error(`Gallery needs an analyzed project: missing ${required} in ${projectArg}`);
  }
}

// id is NOT overridden — held constant across the three, see the header note about nudgeGrade().
const stageProject = (profileId) => stageLiteProject(sourceDir, {
  workDir: path.join(workRoot, profileId),
  overrides: { styleProfile: profileId },
}).dir;

const relFromRoot = (target) => path.relative(root, target).replace(/\\/g, "/");
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

const photos = readJson(sourceAbs(`${analysisDir}/photos.json`)).photos || [];
const fingerprints = [];

for (const profileId of profiles) {
  const dir = stageProject(profileId);
  const result = spawnSync(process.execPath, ["scripts/generateProjectTimeline.mjs", "--project", relFromRoot(dir)],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  if (result.status !== 0) {
    throw new Error(`Profile ${profileId} failed to build:\n${result.stderr || result.stdout}`);
  }
  const timeline = readJson(path.join(dir, "timeline", "timeline.json"));
  const storyboard = readJson(path.join(dir, analysisDir, "lite-storyboard.json"));
  const direction = readJson(path.join(dir, analysisDir, "lite-style-direction.json"));
  fingerprints.push(profileFingerprint({
    profileId, provenance: direction.provenance, timeline, storyboard, photos,
  }));
  console.log(`[gallery] ${profileId}: ${timeline.slides.length} scenes, theme ${storyboard.libraryTheme}, provenance ${direction.provenance}`);
  if (!keep) fs.rmSync(dir, { recursive: true, force: true });
}

const comparison = compareFingerprints(fingerprints);
const report = {
  version: 1,
  generatedAt: new Date().toISOString(),
  source: relFromRoot(sourceDir),
  photos: photos.length,
  profiles: fingerprints,
  pairs: comparison.pairs,
  findings: comparison.findings,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");

for (const pair of comparison.pairs) {
  console.log(`[gallery] ${pair.a} vs ${pair.b}: overlap ${pair.overlap} (effects ${pair.effects}, transitions ${pair.transitions}, layouts ${pair.layouts})`);
}
for (const finding of comparison.findings) console.warn(`[gallery] WARNING ${finding.check}: ${finding.detail}`);
console.log(`[gallery] ${relFromRoot(outPath)}`);
if (!keep) fs.rmSync(workRoot, { recursive: true, force: true });
process.exit(comparison.findings.length && process.argv.includes("--strict") ? 1 : 0);
