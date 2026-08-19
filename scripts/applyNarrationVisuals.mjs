/**
 * Write an APPROVED review file into script.json.
 *
 *   node scripts/applyNarrationVisuals.mjs --project <dir> [--write] [--fill]
 *
 * Refuses unless script/visual-review.json says `"approved": true`. That flag is
 * set by a person, after reading the director's choices and its reasons — it is
 * the signature on the picture edit, and nothing else in this pipeline can
 * produce it.
 *
 * Dry by default, like the assigner: `--write` is what edits script.json.
 *
 * `--fill` hands any beat the reviewer left short to the deterministic assigner
 * (scripts/lib/visualAssigner.mjs) so the film can be built. Without it, a short
 * beat stays pending and the timeline builder refuses — which is the right
 * default when a person is still deciding.
 */
import fs from "node:fs";
import path from "node:path";

import { arg, loadProject } from "./lib/project.mjs";
import { planGroups, transitionFor } from "./lib/narratedTimeline.mjs";
import { assignVisuals, distribute } from "./lib/visualAssigner.mjs";

const project = loadProject(arg("--project"));
const write = process.argv.includes("--write");
const fill = process.argv.includes("--fill");

function readJson(relative, { required = true } = {}) {
  const file = path.join(project.dir, relative);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Required input not found: ${file}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const scriptPath = path.join(project.dir, "script", "script.json");
const script = readJson("script/script.json");
const narration = readJson("voice/narration.json");
const review = readJson("script/visual-review.json");

if (review.approved !== true) {
  throw new Error(
    `script/visual-review.json is not approved. Read it, correct any pick you disagree with, set "approved": true, then run this again.`,
  );
}

// A review written against an older cut of the script would hang pictures on
// sentences that have since changed. Beat ids are the link, so check them.
const reviewIds = new Set(review.beats.flatMap((row) => row.beatIds ?? [row.id]));
const scriptIds = new Set(script.beats.map((beat) => beat.id));
const missing = [...scriptIds].filter((id) => !reviewIds.has(id));
if (missing.length) {
  throw new Error(`The review file does not cover ${missing.length} beat(s) (${missing.slice(0, 5).join(", ")}…). Re-run narration:propose against the current script.`);
}

let applied = 0;
let rejected = 0;
const beatsById = new Map(script.beats.map((beat) => [beat.id, beat]));
for (const row of review.beats) {
  // A reviewer strikes a pick by setting its verdict to "rejected"; anything
  // else is taken as kept, so the common case needs no editing at all.
  const kept = (row.picks ?? []).filter((pick) => pick.verdict !== "rejected");
  rejected += (row.picks ?? []).length - kept.length;
  const visuals = kept.map((pick) => pick.kind === "clip"
    ? { kind: "clip", src: pick.src }
    : { kind: "photo", src: pick.src, effect: pick.effect, ...(pick.pool ? { pool: pick.pool } : {}) });
  const ids = row.beatIds ?? [row.id];
  const shares = distribute(visuals.length, ids.length);
  let cursor = 0;
  for (const [offset, id] of ids.entries()) {
    const beat = beatsById.get(id);
    if (!beat) continue;
    const slice = visuals.slice(cursor, cursor + shares[offset]);
    cursor += shares[offset];
    if (!slice.length && !visuals.length) continue;
    beat.visuals = slice;
    delete beat.visual;
    applied += slice.length;
  }
}

// Anything the reviewer left short — because the director skipped it, or because
// they struck a pick — is either left pending or handed to the rule-based
// assigner. Never invented silently.
let filledCount = 0;
if (fill) {
  const photoIndex = readJson("analysis/photo-index.json");
  const rawPools = readJson("analysis/pools-curated.json");
  const pools = Object.fromEntries(Object.entries(rawPools).filter(([name]) => !name.startsWith("_")));
  const footage = readJson("footage/footage.json", { required: false }) ?? { clips: [] };
  const inputDir = project.manifest.inputDir || "photos";
  const photos = photoIndex.map((photo) => ({ ...photo, file: `${inputDir}/${photo.file}` }));
  const sectionPools = /** @type {Record<string, string[]>} */ ({});
  for (const section of script.sections ?? []) if (section.pools?.length) sectionPools[section.id] = section.pools;

  const groups = planGroups(script.beats, narration, Number(script.project.maxShotDuration ?? 9));
  const slideDuration = (group) => {
    const position = groups.indexOf(group);
    return (group.end - group.start) + transitionFor(group, groups[position + 1] ?? { beats: [{ section: "closing" }] }, null).duration;
  };
  const { assignments, warnings } = assignVisuals({ groups, sectionPools, pools, photos, clips: footage.clips ?? [], slideDuration });
  for (const [beatId, visuals] of assignments) {
    const beat = beatsById.get(beatId);
    if (!beat || !visuals.length) continue;
    beat.visuals = [...(beat.visuals ?? []), ...visuals.map((visual) => ({ ...visual, filledBy: "assigner" }))];
    filledCount += visuals.length;
  }
  for (const warning of warnings) console.warn(`[warning] ${warning}`);
}

console.log(`Applied ${applied} approved visual(s); ${rejected} struck by the reviewer.`);
if (fill) console.log(`  filled ${filledCount} gap(s) with the rule-based assigner.`);
else {
  const short = script.beats.filter((beat) => !beat.visuals?.length && beat.visual?.kind === "pending").length;
  if (short) console.log(`  ${short} beat(s) still have no picture — pass --fill, or choose them by hand.`);
}

if (!write) console.log("\nDry run — nothing written. Re-run with --write to edit script/script.json.");
else {
  fs.writeFileSync(scriptPath, `${JSON.stringify(script, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${project.rel("script/script.json")}.`);
}
