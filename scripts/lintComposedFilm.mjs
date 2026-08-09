// Lint a COMPOSED storyboard — the recipe premium and lite generate for themselves.
//
// The authoring lint (lintStoryTemplates.mjs) is a CI gate on files a person wrote and
// commits. This one is a per-JOB gate on a file the composer just emitted, so it runs
// inside the build rather than in CI, and it reports the numbers as well as the failures:
// a composed film has no author to have noticed them.
//
// Usage:
//   node scripts/lintComposedFilm.mjs --storyboard analysis/storyboard.json
//     [--copy analysis/recipe_copy.json] [--library layouts/library.json]
//     [--repair] [--strict]
//
// --repair rewrites the storyboard in place first, applying the one deterministic fix we
// have (lib/composedRepair.mjs), and reports what it changed. Measure → repair → measure
// again → judge, in that order, so the log shows both what was wrong and what is left.
//
// --strict exits 1 on any error that survives the repair. The build then treats it the way
// it treats an engine validation failure: as something to fix, not something to ship.
import fs from "node:fs";
import path from "node:path";
import { evaluateComposedFilm } from "./lib/rules/composedFilm.mjs";
import { repairComposedFilm } from "./lib/composedRepair.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const storyboardPath = arg("--storyboard", "");
const copyPath = arg("--copy", "");
const libraryPath = arg("--library", "layouts/library.json");
const strict = process.argv.includes("--strict");
const repair = process.argv.includes("--repair");

if (!storyboardPath) {
  console.error("[lintComposedFilm] FAILED: --storyboard is required");
  process.exit(1);
}

const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const exists = (p) => p && fs.existsSync(path.resolve(root, p));

let recipe = readJson(storyboardPath);
const library = readJson(libraryPath);
// A missing copy file is not an error: lite writes its words into the storyboard itself,
// and a premium --dry-run may not have reached node 8b yet.
const copy = exists(copyPath) ? readJson(copyPath) : null;
if (copyPath && !copy) console.warn(`[lintComposedFilm] copy not found: ${copyPath} — judging the storyboard's own text`);

if (repair) {
  const { recipe: repaired, repairs, unrepaired } = repairComposedFilm(recipe, { library, copy });
  for (const r of repairs) {
    console.log(`[lintComposedFilm] repair ${r.id}: ${r.from} -> ${r.to} (textRequired layout, no copy)`);
  }
  for (const id of unrepaired) {
    console.log(`[lintComposedFilm] repair ${id}: no equal-cost wordless layout exists — left as authored`);
  }
  if (repairs.length) {
    recipe = repaired;
    fs.writeFileSync(path.resolve(root, storyboardPath), JSON.stringify(recipe, null, 2) + "\n");
  }
}

const report = evaluateComposedFilm(recipe, { library, copy });
const m = report.measured;
console.log(
  `[lintComposedFilm] ${path.basename(storyboardPath)}: ${m.scenes} scenes, ${m.distinctEffects} effect(s), ` +
    `${m.distinctLayouts} layout(s), ${m.distinctPhotoCounts} scene size(s), ${m.adjacentRepeats} adjacent repeat(s), ` +
    `${m.typefaces} typeface(s)` +
    (m.photoCount ? `, ${m.photosUsed}/${m.photoCount} photos placed` : "")
);
for (const f of report.errors) console.log(`  ERROR ${f.check} [${f.id}] ${f.detail}`);
for (const f of report.warnings) console.log(`  warn  ${f.check} [${f.id}] ${f.detail}`);
console.log(`[lintComposedFilm] verdict: ${report.verdict}` + (strict ? " (--strict)" : ""));

process.exit(strict && report.errors.length ? 1 : 0);
