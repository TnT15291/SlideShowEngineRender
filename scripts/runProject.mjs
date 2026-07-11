// The one orchestrator. All three product tiers run through the same project
// isolation, the same job manifest and the same resume rules; they differ only in
// which nodes build the story and the timeline.
//
//   template — an art-directed recipe from story-templates/, rendered with the full
//              engine (layer_scene, LUTs, masks, frames). ZERO AI calls: the copy is
//              in the recipe and slots are matched on orientation/sharpness, so the
//              vision node is skipped. This is the cheap tier, and the cheapest tier
//              must not quietly run the one node whose cost scales with photo count.
//   lite     — rule-based timeline (zoom/pan/kenburns), AI writes the words.
//   premium  — the AI-director chain: story options (3) -> customer choice (4) ->
//              director notes (5+6) -> story plan (7) -> generate/validate/fallback
//              (8+9) -> render + QA revise loop (10+11).
//
// Note the ladder is not a straight line: `template` looks RICHER than `lite`, since
// a human art-directed it. What it cannot do is adapt its words to these particular
// photos. That is what you buy going up.
//
// Tier comes from `project.json` ("tier") or --tier; it is never inferred. The tier
// that reaches delivery is the tier that actually SURVIVED — premium can fall back
// to lite mid-run, and only the run knows that.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
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
const maxRetries = arg("--max-retries", "2");
const maxRevisions = arg("--max-revisions", "2");
const choice = (arg("--choice", "auto") || "auto").toUpperCase();
const node = process.execPath;

const tier = (arg("--tier") || project.manifest.tier || "lite").toLowerCase();
if (!["template", "lite", "premium"].includes(tier)) throw new Error(`--tier must be template|lite|premium, got "${tier}"`);
if (!["A", "B", "C", "D", "AUTO"].includes(choice)) throw new Error(`--choice must be A|B|C|D|auto, got "${choice}"`);
if (dryRun && deliver) throw new Error("--deliver cannot be used with --dry-run");

// Two opt-in AI nodes for the recipe path. Off by default, so `--tier template`
// stays a zero-AI tier. Together they are what the middle tier will be once
// recipes stretch to the music: the same art-directed engine output as the cheap
// tier, but with the recipe CHOSEN for this couple and the words WRITTEN for them.
const autoRecipe = process.argv.includes("--auto-recipe"); // node A: pickRecipe
const aiCopy = process.argv.includes("--ai-copy");         // node B: writeRecipeCopy
if ((autoRecipe || aiCopy) && tier !== "template") {
  throw new Error(`--auto-recipe/--ai-copy apply to --tier template (got "${tier}")`);
}

// The recipe IS the product in the template tier, so a missing one is a hard error,
// not a silent fall back to some default recipe the customer never chose. Unless
// --auto-recipe, in which case node A picks it and says why.
let recipe = arg("--recipe") || project.manifest.recipe || "";
if (tier === "template" && !recipe && !autoRecipe) {
  throw new Error(`tier "template" needs a recipe: set "recipe" in project.json, pass --recipe story-templates/<id>.json, or pass --auto-recipe`);
}
if (tier === "template" && recipe && !fs.existsSync(path.resolve(root, recipe))) {
  throw new Error(`recipe not found: ${recipe}`);
}

const analysisDir = project.rel(project.manifest.analysisDir);
const timeline = project.rel(project.manifest.timeline);
const videoOut = project.rel(project.manifest.output);
const photos = `${analysisDir}/photos.json`;
const content = `${analysisDir}/photo_content.json`;
const selected = project.manifest.selectedPhotos ? project.rel(project.manifest.selectedPhotos) : `${analysisDir}/photos.selected.json`;
const options = `${analysisDir}/story_options.json`;
const selection = `${analysisDir}/selected_story.json`;
const director = `${analysisDir}/director_notes.json`;
const plan = `${analysisDir}/story_plan.json`;
const tierFile = `${analysisDir}/tier.json`;
const recipeChoice = `${analysisDir}/recipe_choice.json`;
const recipeCopy = `${analysisDir}/recipe_copy.json`;
const contentSample = `${analysisDir}/photo_content.sample.json`;
const visionSample = arg("--vision-sample", "24");
const qaDir = `${analysisDir}/qa`;
const base = path.basename(project.manifest.timeline, path.extname(project.manifest.timeline));
const music = project.manifest.music[0];
const musicPath = music ? project.rel(music) : "";
const musicAnalysis = music ? `${analysisDir}/music/${path.parse(music).name}.json` : "";
// Premium's generator needs a photo pool; prefer the policy-filtered one when the
// plan phase produced it, exactly as the lite generator does.
const photoPool = () => (fs.existsSync(path.resolve(root, selected)) ? selected : photos);

const resumeState = resume ? inspectResume(project) : { reusable: new Set() };
const tracker = createJobTracker(project);
tracker.initialize();
if (resume) console.log(`[runProject] resume: ${resumeState.reason}`);
console.log(`[runProject] tier=${tier}${dryRun ? ", dry-run" : ""}`);

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
function reuse(name) {
  if (!resumeState.reusable.has(name)) return false;
  tracker.skip(name, "resume: artifacts exist and are newer than inputs");
  return true;
}

/** Node 4 has a third outcome besides ok/failed: exit 3 = the customer's response
 *  window is still open. The job is not broken, it is waiting on a person — so the
 *  manifest says "paused", not "failed", and this process exits 3 for the caller. */
function selectStoryChoice() {
  console.log(`\n[runProject] node 4: user choice`);
  const r = spawnSync(node, [
    "scripts/selectStoryOption.mjs",
    "--options", options,
    "--choice", choice,
    "--out", selection,
  ], { cwd: root, stdio: "inherit" });

  if (r.status === 3) {
    tracker.pause("plan", "node 4: the customer's story-choice window is still open");
    console.log(
      `\n[runProject] PAUSED — the customer has not chosen a story yet; nothing was rendered.\n` +
        `  Re-run when they reply, pass --choice <A-D>, or wait for the deadline.`
    );
    process.exit(3);
  }
  if (r.status !== 0) {
    const error = new Error(`node 4: user choice failed (exit ${r.status})`);
    error.exitCode = r.status || 1;
    throw error;
  }
}

/** Premium build: generate the director-aware timeline, validate it against the real
 *  engine, repair or fall back to Lite. Returns the tier that survived. */
function premiumBuild() {
  const args = [
    "scripts/renderWithRetry.mjs",
    "--music", musicPath,
    "--director", director,
    "--plan", plan,
    "--out", timeline,
    "--photos", photoPool(),
    "--analysis-dir", analysisDir,
    "--output", videoOut,
    "--name", project.manifest.id,
    "--quality", project.manifest.quality || "share",
    "--job-dir", project.relDir,
    "--tier-out", tierFile,
    "--max-retries", maxRetries,
    "--dry-run-only",
  ];
  run(args, "nodes 8+9: generate + validate/fallback");
}

/** The tier that actually reached the screen. renderWithRetry writes it as data
 *  because it is the only thing that knows whether the director layer survived. */
function survivingTier() {
  const abs = path.resolve(root, tierFile);
  if (!fs.existsSync(abs)) return "unknown";
  try {
    return JSON.parse(fs.readFileSync(abs, "utf8")).tier || "unknown";
  } catch {
    return "unknown";
  }
}

try {
  if (skipAnalysis) {
    tracker.skip("analyze", "--skip-analysis");
  } else if (!reuse("analyze")) {
    phase("analyze", () => {
      const args = ["scripts/analyzeProject.mjs", "--project", projectArg];
      if (tier === "template") args.push("--skip-vision"); // recipes never read it — see header
      run(args, "analyze");

      // --ai-copy needs to know what the photos are OF, but only as a profile
      // (which tags, which emotions dominate) — not a score for all 82. So it
      // judges a SAMPLE, which costs 2 requests instead of 7 and lands in its own
      // file precisely so it can never be mistaken for the complete set.
      if (aiCopy) {
        run([
          "scripts/analyzePhotoContent.mjs",
          "--photos", photoPool(),
          "--limit", visionSample,
          "--out", contentSample,
        ], `vision sample (${visionSample} photos, for the copy node)`);
      }
    });
  }

  if (!reuse("plan")) {
    phase("plan", () => {
      run(["scripts/generateSelectionPolicy.mjs", "--project", projectArg], "selection policy");
      run(["scripts/selectProjectPhotos.mjs", "--project", projectArg], "photo selection");

      if (tier === "template") {
        // Node A: let the model choose which recipe suits this couple, from the
        // recipes that actually exist. It reads the customer's own sentence.
        if (autoRecipe) {
          run([
            "scripts/pickRecipe.mjs",
            "--prompt", project.rel(project.manifest.promptFile || "prompt.txt"),
            "--photos", photoPool(),
            ...(musicAnalysis ? ["--music", musicAnalysis] : []),
            "--out", recipeChoice,
          ], "node A: pick recipe");
          const chosen = JSON.parse(fs.readFileSync(path.resolve(root, recipeChoice), "utf8"));
          recipe = chosen.recipe;
        }
        // Node B: rewrite the recipe's canned words for THIS couple. Nothing but
        // strings, and only into slots the recipe already declares.
        if (aiCopy) {
          run([
            "scripts/writeRecipeCopy.mjs",
            "--recipe", recipe,
            "--prompt", project.rel(project.manifest.promptFile || "prompt.txt"),
            "--content", contentSample,
            ...(musicAnalysis ? ["--music", musicAnalysis] : []),
            "--out", recipeCopy,
          ], "node B: write recipe copy");
        } else {
          console.log(`[runProject] story: ${recipe} (recipe copy, no AI)`);
        }
      } else if (tier === "lite") {
        run(["scripts/generateProjectStory.mjs", "--project", projectArg], "story");
      } else {
        run(["scripts/generateStoryOptions.mjs", "--content", content, "--out", options], "node 3: story options");
        selectStoryChoice();
        run([
          "scripts/generateDirectorNotes.mjs",
          "--options", options,
          "--selection", selection,
          "--music", musicPath,
          "--analysis-dir", analysisDir,
          "--out", director,
        ], "nodes 5+6: director notes");
        run(["scripts/generateStoryPlan.mjs", "--notes", director, "--content", content, "--out", plan], "node 7: story plan");
      }
    });
  }

  // --resume can skip the plan phase, and node A's choice lives in that phase. The
  // decision is on disk, so recover it there rather than re-deciding (a second
  // model call could pick a DIFFERENT recipe than the one already rendered).
  if (tier === "template" && autoRecipe && !recipe) {
    if (!fs.existsSync(path.resolve(root, recipeChoice))) {
      throw new Error(`--auto-recipe --resume, but ${recipeChoice} is missing; re-run without --resume`);
    }
    recipe = JSON.parse(fs.readFileSync(path.resolve(root, recipeChoice), "utf8")).recipe;
    console.log(`[runProject] resume: recipe ${recipe} (from ${recipeChoice})`);
  }

  if (!reuse("build")) {
    phase("build", () => {
      if (tier === "template") {
        run([
          "scripts/applyStoryTemplate.mjs",
          "--template", recipe,
          "--photos", photoPool(),
          "--music", musicPath,
          "--analysis-dir", analysisDir,
          "--out", timeline,
          "--output", videoOut,
          "--name", project.manifest.id,
          "--quality", project.manifest.quality || "share",
          ...(fs.existsSync(project.abs("brief.json")) ? ["--brief", project.rel("brief.json")] : []),
          ...(aiCopy ? ["--copy", recipeCopy] : []),
        ], `recipe: ${path.basename(recipe)}`);
        run(["scripts/fitTextInTimeline.mjs", timeline], "fit text");
      } else if (tier === "lite") {
        run(["scripts/generateProjectTimeline.mjs", "--project", projectArg], "timeline");
        run(["scripts/fitTextInTimeline.mjs", timeline], "fit text");
      } else {
        premiumBuild(); // generates AND fits text AND validates
      }
    });
  }

  // Premium's QA loop owns the render: it renders, measures, applies a deterministic
  // fix and re-renders, up to the revision cap. Splitting that across two phases
  // would mean rendering twice for no reason.
  const qaOwnsRender = tier === "premium" && !dryRun && !skipQa;

  currentPhase = "render";
  if (!dryRun && reuse("render")) {
    // resume already recorded the skip
  } else if (qaOwnsRender) {
    tracker.skip("render", "premium: the QA loop renders (see the qa phase)");
  } else {
    tracker.start("render");
    const renderArgs = ["--import", "tsx", "src/index.ts", "--timeline", timeline, "--job-dir", project.relDir];
    if (dryRun) renderArgs.push("--dry-run");
    run(renderArgs, dryRun ? "dry-run" : "render");
    if (dryRun) tracker.skip("render", "--dry-run validated render without producing output");
    else tracker.complete("render");
  }

  if (dryRun || skipQa) {
    tracker.skip("qa", dryRun ? "--dry-run" : "--skip-qa");
  } else if (!reuse("qa")) {
    phase("qa", () => {
      if (qaOwnsRender) {
        run([
          "scripts/qaLoop.mjs",
          "--timeline", timeline,
          "--content", content,
          "--analysis-dir", analysisDir,
          "--job-dir", project.relDir,
          "--max-revisions", maxRevisions,
        ], "nodes 10+11: render + QA revise loop");
      } else {
        const proxyArgs = ["scripts/qaProxy.mjs", timeline, "--content", content, "--analysis-dir", analysisDir, "--out", `${qaDir}/${base}.proxy.json`];
        if (musicAnalysis) proxyArgs.push("--music", musicAnalysis);
        run(proxyArgs, "QA proxy");
        run(["scripts/qaClip.mjs", timeline, "--out", `${qaDir}/${base}.json`], "QA clip");
      }
    });
  }

  if (!deliver) {
    tracker.skip("deliver", "--deliver not requested");
  } else if (!reuse("deliver")) {
    phase("deliver", () => run([
      "scripts/deliver.mjs",
      timeline,
      // Premium is the only tier that can end up as something other than itself.
      "--tier", tier === "premium" ? survivingTier() : tier,
      "--analysis-dir", analysisDir,
      "--out-dir", project.rel("output/deliver"),
    ], "node 12: deliver"));
  }

  tracker.finish();
  console.log(`\n[runProject] SUCCESS (${tier}): ${dryRun ? timeline : videoOut}`);
} catch (error) {
  tracker.fail(currentPhase, error);
  console.error(`\n[runProject] FAILED in ${currentPhase}: ${error.message}`);
  process.exit(error.exitCode || 1);
}
