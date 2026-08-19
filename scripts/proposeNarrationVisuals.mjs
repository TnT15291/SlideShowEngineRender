/**
 * Ask the director which picture belongs to which sentence, and write the answer
 * into a review file for a person to sign.
 *
 *   node scripts/proposeNarrationVisuals.mjs --project <dir> [--allow-unapproved]
 *                                            [--dry-run] [--no-cache]
 *
 * WRITES script/visual-review.json, NEVER script.json. Nothing reaches the film
 * until `npm run narration:apply` is run against a review file whose `approved`
 * flag a person has set to true. That separation is the whole point of the
 * workflow: in a film that carries an organisation's name, every picture is
 * somebody's decision, not a model's.
 *
 * MUST RUN AFTER `narration:synthesize`, for the same reason the assigner does —
 * how many pictures a stretch of script holds is decided by how long it takes to
 * read aloud, and only voice/narration.json knows that.
 *
 * No key -> STUB. The stub proposes nothing rather than inventing picks, so an
 * unconfigured machine produces a review file that is honestly empty instead of
 * one that looks reviewed.
 */
import fs from "node:fs";
import path from "node:path";

import { arg, loadProject } from "./lib/project.mjs";
import { planGroups, transitionFor } from "./lib/narratedTimeline.mjs";
import { buildDirectorPrompt, stubProposal, validateProposal } from "./lib/narrationDirector.mjs";
import * as deepseek from "./lib/deepseek.mjs";

const project = loadProject(arg("--project"));
const dryRun = process.argv.includes("--dry-run");

function readJson(relative, { required = true } = {}) {
  const file = path.join(project.dir, relative);
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`Required input not found: ${file}`);
    return null;
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const script = readJson("script/script.json");
const narration = readJson("voice/narration.json");
if (script.reviewStatus !== "approved" && !process.argv.includes("--allow-unapproved")) {
  throw new Error(
    `Content review gate is "${script.reviewStatus || "missing"}". Choosing pictures for words that may still change wastes the choosing.`,
  );
}
if (script.beats.length !== narration.segments.length) {
  throw new Error(`Beat/segment count mismatch: ${script.beats.length} beats, ${narration.segments.length} segments — re-run narration:synthesize.`);
}

const photoIndex = readJson("analysis/photo-index.json");
const rawPools = readJson("analysis/pools-curated.json");
const pools = Object.fromEntries(Object.entries(rawPools).filter(([name]) => !name.startsWith("_")));
const footage = readJson("footage/footage.json", { required: false }) ?? { clips: [] };
// Written by the vision node when it has been run; absent is fine, the director
// then reasons from pool and filename alone and says so in the review file.
const captions = readJson("analysis/photo-captions.json", { required: false });

const inputDir = project.manifest.inputDir || "photos";
const poolOf = new Map();
for (const [name, indices] of Object.entries(pools)) for (const index of indices) if (!poolOf.has(index)) poolOf.set(index, name);

// Only photographs that some pool vouches for are offered. The rest were struck
// out by curation.json as weak, duplicated or sensitive, and a director that
// cannot see them cannot choose them.
const photos = photoIndex
  .map((photo, index) => ({ ...photo, index, file: `${inputDir}/${photo.file}`, pool: poolOf.get(index), caption: captions?.[String(index)]?.caption }))
  .filter((photo) => photo.pool);
const clips = (footage.clips ?? []).map((clip, index) => ({ ...clip, index }));

const maxShotDuration = Number(script.project.maxShotDuration ?? 9);
const groups = planGroups(script.beats, narration, maxShotDuration);

// One review row per group, because a group is what the film actually cuts on:
// beats merge when they are too short to hold a slide, and split when they run
// long, so "how many pictures does this beat need" is only answerable here.
const rows = [];
for (const [position, group] of groups.entries()) {
  if (group.part !== 1) continue;
  const next = groups[position + group.partCount] ?? { beats: [{ section: "closing" }] };
  const seconds = ((group.end - group.start) + transitionFor(group, next, null).duration);
  rows.push({
    id: group.beats.map((beat) => beat.id).join("+"),
    beatIds: group.beats.map((beat) => beat.id),
    section: group.beats[0]?.section ?? "",
    narration: group.beats.map((beat) => beat.narration).join(" "),
    needs: group.partCount,
    // Per VISUAL, not for the whole beat: a window longer than
    // maxShotDuration is cut into partCount slides of this length each.
    seconds,
    secondsTotal: Number((seconds * group.partCount).toFixed(2)),
  });
}

const { system, user } = buildDirectorPrompt({
  beats: rows,
  photos,
  clips,
  filmName: script.project.name,
  issuer: script.project.issuer,
});

if (dryRun) {
  console.log("[propose] dry run — nothing sent, nothing written.");
  console.log(`  beats to place : ${rows.length} (${rows.reduce((sum, row) => sum + row.needs, 0)} visuals)`);
  console.log(`  photographs    : ${photos.length} offered (${photoIndex.length} in the album, the rest struck out by curation)`);
  console.log(`  captions       : ${captions ? "present" : "ABSENT — run the vision node for picture-level matching"}`);
  console.log(`  clips          : ${clips.length}`);
  console.log(`  prompt size    : ~${Math.round((system.length + user.length) / 4)} tokens`);
  console.log(`  provider       : ${deepseek.hasKey() ? deepseek.provenance() : "STUB (no DEEPSEEK_API_KEY)"}`);
  process.exit(0);
}

let raw;
let generatedBy;
if (deepseek.hasKey()) {
  generatedBy = deepseek.provenance();
  process.stdout.write(`[propose] asking ${generatedBy} to place ${rows.length} beats… `);
  raw = await deepseek.callDeepSeekJSON({
    system,
    user,
    label: "narration-director",
    temperature: 0.3,
    onCall: (sent) => process.stdout.write(sent ? "(request)\n" : "(cached)\n"),
  });
} else {
  generatedBy = "stub";
  console.log("[propose] no DEEPSEEK_API_KEY — writing an empty proposal (STUB).");
  raw = stubProposal(rows);
}

const { beats: reviewed, repairs } = validateProposal(raw, { beats: rows, photos, clips });

const review = {
  version: 1,
  // The gate. narration:apply refuses to touch script.json until a person sets
  // this to true, having read the rows below.
  approved: false,
  generatedBy,
  generatedAt: new Date().toISOString(),
  captionsAvailable: Boolean(captions),
  repairs,
  beats: reviewed,
};
const outPath = path.join(project.dir, "script", "visual-review.json");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, `${JSON.stringify(review, null, 2)}\n`, "utf8");

const chosen = reviewed.reduce((sum, row) => sum + row.picks.length, 0);
const wanted = rows.reduce((sum, row) => sum + row.needs, 0);
console.log(`\n[propose] ${chosen}/${wanted} visual(s) chosen across ${rows.length} beat(s).`);
if (!captions) console.log("  note: no analysis/photo-captions.json — the director could not see the photographs, only their pool.");
if (repairs.length) {
  console.log(`  ${repairs.length} correction(s) applied to the director's answer:`);
  for (const repair of repairs.slice(0, 12)) console.log(`    - ${repair}`);
  if (repairs.length > 12) console.log(`    … and ${repairs.length - 12} more (all listed in the review file)`);
}
console.log(`\nWrote ${project.rel("script/visual-review.json")}.`);
console.log('Read it, edit any pick you disagree with, set "approved": true, then run: npm run narration:apply -- --project <dir>');
