import { spawnSync } from "node:child_process";
import path from "node:path";
import { createJobTracker } from "./lib/jobManifest.mjs";
import { arg, loadProject, root } from "./lib/project.mjs";
import { inspectResume } from "./lib/resumeProject.mjs";

const projectArg = arg("--project");
const project = loadProject(projectArg);
const dryRun = process.argv.includes("--dry-run");
const skipAnalysis = process.argv.includes("--skip-analysis");
const skipQa = process.argv.includes("--skip-qa");
const deliver = process.argv.includes("--deliver");
const resume = process.argv.includes("--resume");
const node = process.execPath;

if (dryRun && deliver) throw new Error("--deliver cannot be used with --dry-run");
const resumeState = resume ? inspectResume(project) : { reusable: new Set() };
const tracker = createJobTracker(project);
tracker.initialize();
if (resume) console.log(`[runProject] resume: ${resumeState.reason}`);

function run(args, label) {
  console.log(`\n[runProject] ${label}`);
  const r = spawnSync(node, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    const error = new Error(`${label} failed (exit ${r.status ?? 1})`);
    error.exitCode = r.status || 1;
    throw error;
  }
}

let currentPhase = "validate";
function phase(name, action) {
  currentPhase = name;
  tracker.start(name);
  action();
  tracker.complete(name);
}

try {
  if (skipAnalysis) {
    tracker.skip("analyze", "--skip-analysis");
  } else if (resumeState.reusable.has("analyze")) {
    tracker.skip("analyze", "resume: artifacts exist and are newer than inputs");
  } else {
    phase("analyze", () => run(["scripts/analyzeProject.mjs", "--project", projectArg], "analyze"));
  }

  if (resumeState.reusable.has("plan")) {
    tracker.skip("plan", "resume: artifacts exist and are newer than inputs");
  } else {
    phase("plan", () => {
      run(["scripts/generateSelectionPolicy.mjs", "--project", projectArg], "selection policy");
      run(["scripts/selectProjectPhotos.mjs", "--project", projectArg], "photo selection");
      run(["scripts/generateProjectStory.mjs", "--project", projectArg], "story");
    });
  }

  if (resumeState.reusable.has("build")) {
    tracker.skip("build", "resume: artifacts exist and are newer than inputs");
  } else {
    phase("build", () => {
      run(["scripts/generateProjectTimeline.mjs", "--project", projectArg], "timeline");
      run(["scripts/fitTextInTimeline.mjs", project.rel(project.manifest.timeline)], "fit text");
    });
  }

  currentPhase = "render";
  if (!dryRun && resumeState.reusable.has("render")) {
    tracker.skip("render", "resume: artifacts exist and are newer than inputs");
  } else {
    tracker.start("render");
    const renderArgs = ["--import", "tsx", "src/index.ts", "--timeline", project.rel(project.manifest.timeline), "--job-dir", project.relDir];
    if (dryRun) renderArgs.push("--dry-run");
    run(renderArgs, dryRun ? "dry-run" : "render");
    if (dryRun) tracker.skip("render", "--dry-run validated render without producing output");
    else tracker.complete("render");
  }

  if (dryRun || skipQa) {
    tracker.skip("qa", dryRun ? "--dry-run" : "--skip-qa");
  } else if (resumeState.reusable.has("qa")) {
    tracker.skip("qa", "resume: artifacts exist and are newer than inputs");
  } else {
    phase("qa", () => {
      const timeline = project.rel(project.manifest.timeline);
      const qaDir = project.rel(`${project.manifest.analysisDir}/qa`);
      const base = path.basename(project.manifest.timeline, path.extname(project.manifest.timeline));
      const content = project.rel(`${project.manifest.analysisDir}/photo_content.json`);
      const proxyArgs = ["scripts/qaProxy.mjs", timeline, "--content", content, "--out", `${qaDir}/${base}.proxy.json`];
      const music = project.manifest.music[0];
      if (music) proxyArgs.push("--music", project.rel(`${project.manifest.analysisDir}/music/${path.parse(music).name}.json`));
      run(proxyArgs, "QA proxy");
      run(["scripts/qaClip.mjs", timeline, "--out", `${qaDir}/${base}.json`], "QA clip");
    });
  }

  if (!deliver) {
    tracker.skip("deliver", "--deliver not requested");
  } else if (resumeState.reusable.has("deliver")) {
    tracker.skip("deliver", "resume: artifacts exist and are newer than inputs");
  } else {
    phase("deliver", () => run([
      "scripts/deliver.mjs",
      project.rel(project.manifest.timeline),
      "--tier", "lite",
      "--analysis-dir", project.rel(project.manifest.analysisDir),
      "--out-dir", project.rel("output/deliver"),
    ], "deliver"));
  }

  tracker.finish();
  console.log(`\n[runProject] SUCCESS: ${dryRun ? project.rel(project.manifest.timeline) : project.rel(project.manifest.output)}`);
} catch (error) {
  tracker.fail(currentPhase, error);
  console.error(`\n[runProject] FAILED in ${currentPhase}: ${error.message}`);
  process.exit(error.exitCode || 1);
}
