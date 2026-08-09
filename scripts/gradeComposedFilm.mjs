// Grade a composed film against the corpus a person art-directed.
//
// The gate (lintComposedFilm.mjs) says whether the film is broken. This says whether it is
// THIN — and it says it next to the 25 authored recipes, because "premium looks cheaper
// than the template tier" is a comparison, and a comparison needs both sides.
//
// It never fails a build. A number that can stop a render has to be defensible on every
// job, and these are not floors: a photo-poor album legitimately scores lower than a rich
// one on half of them. What it must do is be WRITTEN DOWN, per job, so the ratchet in
// test/composed-film-regression.test.mjs has something to hold and so a regression shows up
// as a number instead of as a customer noticing.
//
// Usage:
//   node scripts/gradeComposedFilm.mjs --storyboard analysis/storyboard.json
//     [--out analysis/film-scorecard.json] [--corpus story-templates] [--library layouts/library.json]
import fs from "node:fs";
import path from "node:path";
import { scoreFilm, corpusBaseline, HIGHER_IS_BETTER } from "./lib/filmScorecard.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const storyboardPath = arg("--storyboard", "");
const corpusDir = arg("--corpus", "story-templates");
const libraryPath = arg("--library", "layouts/library.json");
const outPath = arg("--out", "");

if (!storyboardPath) {
  console.error("[gradeComposedFilm] FAILED: --storyboard is required");
  process.exit(1);
}

const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const library = readJson(libraryPath);
const film = scoreFilm(readJson(storyboardPath), { library });

const corpusFiles = fs.existsSync(path.resolve(root, corpusDir))
  ? fs.readdirSync(path.resolve(root, corpusDir)).filter((f) => f.endsWith(".json"))
  : [];
const corpus = corpusBaseline(corpusFiles.map((f) => readJson(path.join(corpusDir, f))), { library });

const ROWS = [
  ["scenes", "scenes"],
  ["distinctEffects", "effects"],
  ["distinctTransitions", "transitions"],
  ["typefaces", "typefaces"],
  ["distinctLayouts", "layouts"],
  ["distinctLooks", "looks"],
  ["looksPerScene", "looks/scene"],
  ["distinctArrangements", "arrangements"],
  ["arrangementsPerCard", "arrangements/card"],
  ["topLookShare", "top look share"],
];

const num = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(3));
console.log(`[gradeComposedFilm] ${path.basename(storyboardPath)} vs ${corpus.recipes} authored recipe(s)\n`);
console.log(`  ${"metric".padEnd(20)}${"film".padStart(8)}${"corpus".padStart(10)}`);
for (const [key, label] of ROWS) {
  // A marker, not a verdict: `scenes` and `topLookShare` have no "more is better" direction,
  // and a shot list is longer than a palette by construction.
  const mark = !HIGHER_IS_BETTER.includes(key) ? " " : film[key] >= corpus[key] ? "+" : "-";
  console.log(`  ${label.padEnd(20)}${num(film[key]).padStart(8)}${num(corpus[key]).padStart(10)}  ${mark}`);
}
const mix = (m) => `single ${(m.single * 100).toFixed(0)}% · card ${(m.card * 100).toFixed(0)}% · montage ${(m.montage * 100).toFixed(0)}%`;
console.log(`\n  shape mix   film: ${mix(film.shapeMix)}\n              corpus: ${mix(corpus.shapeMix)}`);

const below = HIGHER_IS_BETTER.filter((key) => film[key] < corpus[key]);
console.log(below.length
  ? `\n[gradeComposedFilm] below the authored corpus on: ${below.join(", ")}`
  : "\n[gradeComposedFilm] at or above the authored corpus on every vocabulary metric");

if (outPath) {
  const abs = path.resolve(root, outPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify({
    version: 1,
    storyboard: storyboardPath.replace(/\\/g, "/"),
    generatedAt: new Date().toISOString(),
    film,
    corpus,
    below,
  }, null, 2) + "\n");
  console.log(`[gradeComposedFilm] -> ${outPath}`);
}
