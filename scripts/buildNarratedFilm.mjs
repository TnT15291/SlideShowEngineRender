/**
 * One command for a narration-led film.
 *
 *   npm run narration:build -- --project <dir> [--source <script.md>] [--config <json>]
 *                              [--allow-unapproved] [--dry-run] [--no-render]
 *
 * Runs import → photo index → synthesis → visual assignment → timeline → text fit →
 * render → subtitles, in that order, stopping at the first gate that does not pass and
 * saying what would close it. Nothing new happens here: every step is one of the
 * scripts that made the first film, and lib/narratedBuildPlan.mjs decides which of them
 * this project still needs.
 *
 * Re-running is the normal case. Each step is skipped when its output is newer than its
 * inputs, so a build interrupted at the render resumes at the render, and a film whose
 * script changed re-synthesizes only what that costs.
 *
 * `--dry-run` prints the plan and runs nothing — the flag means the same thing here as
 * it does in the visual assigner, since this is the command that spends money.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { arg, loadProject, root } from "./lib/project.mjs";
import { INTERNAL_PHOTO_INDEX, planNarratedBuild } from "./lib/narratedBuildPlan.mjs";
import { writePhotoIndex } from "./lib/photoIndex.mjs";

const projectArg = arg("--project");
if (!projectArg) {
  console.error("Usage: node scripts/buildNarratedFilm.mjs --project <dir> [--source <script.md>] [--config <json>] [--allow-unapproved] [--dry-run] [--no-render]");
  process.exit(1);
}

const options = {
  source: arg("--source"),
  config: arg("--config"),
  allowUnapproved: process.argv.includes("--allow-unapproved"),
  render: !process.argv.includes("--no-render"),
};
const dryRun = process.argv.includes("--dry-run");

let project;
try {
  project = loadProject(projectArg);
} catch (error) {
  console.error(`[narration:build] ${error.message}`);
  if (/manifest not found/i.test(error.message)) {
    console.error(`  A narrated film still starts from a project: npm run project:create -- --id <id> --name "<title>"`);
  }
  process.exit(1);
}

const label = (step) => `${step.id.padEnd(16)}${step.action.padEnd(9)}${step.reason}`;

function show(plan) {
  console.log(`\n[narration:build] ${project.relDir}`);
  for (const step of plan.steps) console.log(`  ${label(step)}`);
  if (plan.pending) console.log("  …            (the rest of the plan is decided by the script the import writes)");
}

function runCommand(step) {
  const result = spawnSync(process.execPath, step.command, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    console.error(`\n[narration:build] ${step.id} failed (exit ${result.status ?? 1}).`);
    process.exit(result.status || 1);
  }
}

function runInternal(step) {
  if (step.internal !== INTERNAL_PHOTO_INDEX) throw new Error(`Unknown internal step: ${step.internal}`);
  const target = path.join(project.dir, "analysis", "photo-index.json");
  const rows = writePhotoIndex(target, project.abs(project.manifest.inputDir || "photos"));
  const shape = rows.reduce((counts, row) => ({ ...counts, [row.orient]: (counts[row.orient] ?? 0) + 1 }), {});
  console.log(`Photo index ready: ${project.rel(target)} (${rows.length} photographs — ` +
    `${Object.entries(shape).map(([orient, count]) => `${count} ${orient}`).join(", ")}).`);
  console.log("  Pools index into this file BY POSITION. Tag them in analysis/pools.json before assigning.");
}

// The plan is re-read from disk after every step, so a step that changes what the next
// one should do (synthesis deciding how many pictures a beat needs) is simply seen.
const executed = new Set();
const ledger = [];
let plan = planNarratedBuild(project, options);
show(plan);
if (dryRun) {
  console.log(plan.blocked
    ? `\n[narration:build] --dry-run: blocked at ${plan.blocked.id}.`
    : "\n[narration:build] --dry-run: nothing was run.");
  process.exit(plan.blocked ? 2 : 0);
}

for (let guard = 0; guard <= 32; guard += 1) {
  if (guard === 32) throw new Error("The build plan is not converging — a step keeps asking to run after it ran.");
  const next = plan.steps.find((step) => !executed.has(step.id));
  if (!next) break;
  executed.add(next.id);
  if (next.action === "stop") {
    // Everything BEFORE the closed gate still runs: the album inventory is exactly
    // what a person needs in front of them to write the pool file the gate is asking for.
    console.error(`\n[narration:build] stopped at ${next.id}: ${next.reason}`);
    process.exit(2);
  }
  if (next.action === "run") {
    console.log(`\n[narration:build] ${next.id}: ${next.reason}`);
    const started = Date.now();
    if (next.internal) runInternal(next); else runCommand(next);
    ledger.push({ id: next.id, action: "ran", seconds: (Date.now() - started) / 1000 });
    plan = planNarratedBuild(project, options);
  } else if (next.action === "deferred") {
    // Only the visual step defers, and only until the narration it plans against
    // exists. Re-planning here is what turns it into a real decision — unless the
    // voice we just made still does not answer to the script, which is a real fault
    // and must be reported as one rather than deferred around in a circle.
    const voice = plan.steps.find((step) => step.id === "narration");
    if (executed.has("narration") && voice?.action === "run") {
      console.error(`\n[narration:build] the narration that was just synthesized still does not match the script: ${voice.reason}`);
      process.exit(1);
    }
    executed.delete(next.id);
    plan = planNarratedBuild(project, options);
  } else {
    ledger.push({ id: next.id, action: next.action, seconds: 0 });
  }
}

const ran = ledger.filter((entry) => entry.action === "ran");
console.log(`\n[narration:build] done — ${ran.length} step(s) ran, ${ledger.length - ran.length} already up to date.`);
for (const entry of ran) console.log(`  ${entry.id.padEnd(16)}${entry.seconds.toFixed(1)}s`);
const output = project.abs(project.manifest.output);
if (fs.existsSync(output)) {
  console.log(`  film            ${project.rel(output)} (${(fs.statSync(output).size / 1e6).toFixed(1)} MB)`);
}
