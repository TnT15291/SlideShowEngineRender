// Premium pipeline orchestrator.
//
// One local CLI that wires the already-built nodes together for a v1/Premium job:
//   analysis -> story options -> node 4 choice -> director notes -> story plan
//   -> validate/fallback -> render+QA -> optional delivery.
//
// This file is only orchestration. It does not generate FFmpeg commands, repair
// timelines itself, or duplicate node logic; it calls the node scripts that own
// those responsibilities.
//
// Usage:
//   node scripts/runPremiumJob.mjs [--music "music/a thousand years.mp3"]
//     [--brief "cinematic Korean romance"] [--choice A|B|C|D|auto]
//     [--out timeline/quoc-nhi-full-v2.json] [--dry-run-only] [--deliver]
//     [--max-retries 2] [--max-revisions 2] [--require-vision]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const node = process.execPath;

const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const has = (flag) => process.argv.includes(flag);

const music = arg("--music", "music/a thousand years.mp3");
const brief = arg("--brief", "");
const choice = (arg("--choice", "auto") || "auto").toUpperCase();
const outTimeline = arg("--out", "timeline/quoc-nhi-full-v2.json");
const photosPath = arg("--photos", "analysis/photos.json");
const contentPath = arg("--content", "analysis/photo_content.json");
const optionsPath = arg("--options", "analysis/story_options.json");
const selectionPath = arg("--selection", "analysis/selected_story.json");
const directorPath = arg("--director", "analysis/director_notes.json");
const planPath = arg("--plan", "analysis/story_plan.json");
const maxRetries = arg("--max-retries", "2");
const maxRevisions = arg("--max-revisions", "2");
const dryRunOnly = has("--dry-run-only");
const deliver = has("--deliver");
const requireVision = has("--require-vision");
const forceAnalysis = has("--force-analysis");
const skipQa = has("--skip-qa");

const die = (msg, code = 1) => {
  console.error(`[runPremiumJob] FAILED: ${msg}`);
  process.exit(code);
};

if (!["A", "B", "C", "D", "AUTO"].includes(choice)) {
  die(`--choice must be A|B|C|D|auto, got "${choice}"`);
}
if (dryRunOnly && deliver) die("--deliver cannot be used with --dry-run-only");

const rel = (p) => path.resolve(root, p);
const exists = (p) => fs.existsSync(rel(p));
const musicName = path.basename(music).replace(/\.[^.]+$/, "");
const musicAnalysis = `analysis/music/${musicName}.json`;

function run(args, label) {
  console.log(`\n[runPremiumJob] ${label}`);
  const r = spawnSync(node, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) die(`${label} failed (exit ${r.status})`, r.status || 1);
}

function runCapture(args, label) {
  console.log(`\n[runPremiumJob] ${label}`);
  const r = spawnSync(node, args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  process.stdout.write(r.stdout || "");
  process.stderr.write(r.stderr || "");
  if (r.status !== 0) die(`${label} failed (exit ${r.status})`, r.status || 1);
  return (r.stdout || "") + (r.stderr || "");
}

function ensureAnalysis() {
  if (forceAnalysis || !exists(photosPath)) {
    run(["scripts/analyzePhotos.mjs", "--out", photosPath], "node 2a: rule-based photo analysis");
  } else {
    console.log(`[runPremiumJob] reuse ${photosPath}`);
  }

  if (forceAnalysis || !exists(contentPath)) {
    const args = ["scripts/analyzePhotoContent.mjs", "--photos", photosPath, "--out", contentPath];
    if (requireVision) args.push("--require-vision");
    run(args, "node 2b: semantic photo analysis");
  } else {
    console.log(`[runPremiumJob] reuse ${contentPath}`);
  }

  if (forceAnalysis || !exists(musicAnalysis)) {
    run(["scripts/analyzeMusic.mjs", music], "music analysis");
  } else {
    console.log(`[runPremiumJob] reuse ${musicAnalysis}`);
  }
}

/** Node 4 has a third outcome besides ok/error: exit 3 = the customer's response
 *  window is still open. That is the whole point of the non-blocking design — the
 *  job is not failed, it is not yet ready, and this orchestrator must step aside
 *  rather than default on the customer's behalf. */
function selectStoryChoice() {
  const args = ["scripts/selectStoryOption.mjs", "--options", optionsPath, "--choice", choice, "--out", selectionPath];
  console.log(`\n[runPremiumJob] node 4: user choice`);
  const r = spawnSync(node, args, { cwd: root, stdio: "inherit" });
  if (r.status === 3) {
    console.log(
      `\n[runPremiumJob] PAUSED — the customer's response window is still open; nothing rendered.\n` +
        `  Re-run when they reply, pass --choice <A-D>, or wait for the deadline.`
    );
    process.exit(3);
  }
  if (r.status !== 0) die(`node 4: user choice failed (exit ${r.status})`, r.status || 1);
}

function buildCreativeArtifacts() {
  const storyArgs = ["scripts/generateStoryOptions.mjs", "--content", contentPath, "--out", optionsPath];
  if (brief) storyArgs.push("--brief", brief);
  run(storyArgs, "node 3: story options");

  selectStoryChoice();

  run(
    [
      "scripts/generateDirectorNotes.mjs",
      "--options", optionsPath,
      "--selection", selectionPath,
      "--music", music,
      "--out", directorPath,
    ],
    "nodes 5+6: director notes"
  );

  run(
    ["scripts/generateStoryPlan.mjs", "--notes", directorPath, "--content", contentPath, "--out", planPath],
    "node 7: story plan"
  );
}

function validateAndMaybeFallback() {
  const args = [
    "scripts/renderWithRetry.mjs",
    "--music", music,
    "--director", directorPath,
    "--plan", planPath,
    "--out", outTimeline,
    "--photos", photosPath,
    "--max-retries", maxRetries,
    "--dry-run-only",
  ];
  const output = runCapture(args, "nodes 8+9: generate + validate/fallback");
  const m = output.match(/SUCCESS\s+—\s+(director|lite),/);
  return m?.[1] || "unknown";
}

function renderQaAndDeliver(tier) {
  if (skipQa) {
    run(["--import", "tsx", "src/index.ts", "--timeline", outTimeline], "node 10: render");
  } else {
    run(
      ["scripts/qaLoop.mjs", "--timeline", outTimeline, "--content", contentPath, "--max-revisions", maxRevisions],
      "nodes 10+11: render + QA loop"
    );
  }

  if (deliver) {
    run(["scripts/deliver.mjs", outTimeline, "--tier", tier], "node 12: deliver");
  }
}

console.log(
  `[runPremiumJob] start — music=${music}, choice=${choice}, out=${outTimeline}` +
    `${dryRunOnly ? ", dry-run only" : ""}${deliver ? ", deliver" : ""}`
);

ensureAnalysis();
buildCreativeArtifacts();
const tier = validateAndMaybeFallback();

if (dryRunOnly) {
  console.log(`\n[runPremiumJob] SUCCESS — validated (${tier}). Timeline: ${outTimeline}`);
  process.exit(0);
}

renderQaAndDeliver(tier);

const tl = JSON.parse(fs.readFileSync(rel(outTimeline), "utf8"));
console.log(`\n[runPremiumJob] SUCCESS — tier=${tier}. Output: ${tl.output?.path ?? outTimeline}`);
