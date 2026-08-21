/**
 * Fill every `pending` beat with a photograph or a clip.
 *
 *   node scripts/assignNarrationVisuals.mjs --project <dir> [--write] [--allow-unapproved]
 *
 * Dry by default: it prints what it would do and writes nothing. `--write` is
 * what edits script.json, because this overwrites the one file that holds the
 * editor's work.
 *
 * READS THE ANALYSIS THAT ALREADY EXISTS. The ANTT album was reviewed by hand
 * off contact sheets into analysis/photo-index.json (file, width, height,
 * orientation), analysis/pools-curated.json (topic → photo indices, with the
 * weak/duplicate/sensitive removals in curation.json already applied) and
 * footage/footage.json. Those files ARE the editorial intent; inventing a
 * parallel scheme of pool-named folders would have thrown that judgement away
 * and asked for it again. A film that has not had a curation pass keeps its pools
 * in the plainly-named analysis/pools.json, which is read when the curated one is
 * absent — one album's history is not the shape of every album after it.
 *
 * MUST RUN AFTER `narration:synthesize`. How many pictures a stretch of script
 * needs is decided by how long it takes to read aloud — planGroups() derives it
 * from voice/narration.json, and nothing before synthesis knows it.
 */
import fs from "node:fs";
import path from "node:path";

import { arg, loadProject } from "./lib/project.mjs";
import { POOL_FILES, resolvePoolsFile } from "./lib/photoIndex.mjs";
import { planGroups, transitionFor } from "./lib/narratedTimeline.mjs";
import { assignVisuals, hasAuthoredVisual } from "./lib/visualAssigner.mjs";

const project = loadProject(arg("--project"));
const write = process.argv.includes("--write");

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
if (script.reviewStatus !== "approved" && !process.argv.includes("--allow-unapproved")) {
  throw new Error(
    `Content review gate is "${script.reviewStatus || "missing"}". Assigning pictures to unapproved words wastes the work when the words change.`,
  );
}
if (script.beats.length !== narration.segments.length) {
  throw new Error(`Beat/segment count mismatch: ${script.beats.length} beats, ${narration.segments.length} segments — re-run narration:synthesize.`);
}

// photo-index.json is the fuller record (every file, with dimensions);
// pools-curated.json indexes into it and already has curation.json applied.
const photos = readJson("analysis/photo-index.json");
// Curated pools win where a curation pass has happened; a first film has only
// analysis/pools.json (see lib/photoIndex.mjs).
const poolsFile = resolvePoolsFile(project.dir);
if (!poolsFile) throw new Error(`Required input not found: ${POOL_FILES.map((name) => `${project.relDir}/${name}`).join(" or ")}`);
const rawPools = readJson(poolsFile);
const pools = Object.fromEntries(Object.entries(rawPools).filter(([name]) => !name.startsWith("_")));
const footage = readJson("footage/footage.json", { required: false }) ?? { clips: [] };

// `photo-index.json` holds bare filenames; every visual path is project-relative.
const inputDir = project.manifest.inputDir || "photos";
const indexed = photos.map((photo) => ({ ...photo, file: `${inputDir}/${photo.file}` }));

const sectionPools = /** @type {Record<string, string[]>} */ ({});
for (const section of script.sections ?? []) {
  if (Array.isArray(section.pools) && section.pools.length) sectionPools[section.id] = section.pools;
}
const undeclared = (script.sections ?? []).filter((section) => !sectionPools[section.id]);
if (!script.sections?.length || undeclared.length === script.sections.length) {
  throw new Error(
    'No section declares which pools it draws from. Add "sections": { "<section-id>": { "pools": ["community", ...] } } ' +
      `to the script front-matter and re-import. Available pools: ${Object.keys(pools).join(", ")}`,
  );
}
for (const section of undeclared) console.warn(`[warning] section "${section.id}" declares no pools; its beats will be left pending.`);
for (const [id, names] of Object.entries(sectionPools)) {
  const unknown = names.filter((name) => !pools[name]);
  if (unknown.length) throw new Error(`Section "${id}" names pool(s) that do not exist: ${unknown.join(", ")}`);
}

const maxShotDuration = Number(script.project.maxShotDuration ?? 9);
const groups = planGroups(script.beats, narration, maxShotDuration);

// The same duration the builder will compute, so a clip that passes here cannot
// fail the builder's "clip is shorter than its slide" check afterwards.
const slideDuration = (group) => {
  const position = groups.indexOf(group);
  const next = groups[position + 1] || { beats: [{ section: "closing" }] };
  return (group.end - group.start) + transitionFor(group, next, null).duration;
};

const { assignments, warnings } = assignVisuals({
  groups,
  sectionPools,
  pools,
  photos: indexed,
  clips: footage.clips ?? [],
  slideDuration,
});

const beatsById = new Map(script.beats.map((beat) => [beat.id, beat]));
let filled = 0;
let photoCount = 0;
let clipCount = 0;
const orientation = { landscape: 0, portrait: 0, square: 0 };
const byFile = new Map(indexed.map((photo) => [photo.file, photo]));
for (const [beatId, visuals] of assignments) {
  const beat = beatsById.get(beatId);
  if (!beat) continue;
  beat.visuals = visuals;
  delete beat.visual;
  filled += visuals.length ? 1 : 0;
  for (const visual of visuals) {
    if (visual.kind === "clip") clipCount += 1;
    else {
      photoCount += 1;
      const meta = byFile.get(visual.src);
      if (meta) orientation[meta.orient] = (orientation[meta.orient] ?? 0) + 1;
    }
  }
}

const stillPending = script.beats.filter((beat) => !hasAuthoredVisual(beat)).map((beat) => beat.id);
const nonLandscape = orientation.portrait + orientation.square;
console.log(`Assigned ${photoCount} photograph(s) and ${clipCount} clip(s) across ${filled} beat(s).`);
console.log(`  orientation: ${JSON.stringify(orientation)}`);
if (photoCount) console.log(`  pillarboxed: ${nonLandscape}/${photoCount} = ${(100 * nonLandscape / photoCount).toFixed(1)}% (hand-assigned ANTT cut: 7.4%)`);
for (const warning of warnings) console.warn(`[warning] ${warning}`);
if (stillPending.length) console.warn(`[warning] still pending: ${stillPending.join(", ")}`);

if (!write) {
  console.log("\nDry run — nothing written. Re-run with --write to edit script/script.json.");
} else {
  fs.writeFileSync(scriptPath, `${JSON.stringify(script, null, 2)}\n`, "utf8");
  console.log(`\nWrote ${project.rel("script/script.json")}.`);
}
