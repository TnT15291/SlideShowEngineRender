// The fit advisor's entry point. Reads photo count + music duration, classifies how the
// album and the song relate, and writes fit_plan.json — the DESCRIPTIVE contract a UI reads
// to show the customer their options. It decides nothing: the decision and who made it live
// in fit_decision.json (scripts/decideFit.mjs). Runs in every tier; it is pure arithmetic,
// zero AI calls, so it never makes a cheap tier expensive.
//
//   node scripts/assessFit.mjs --music-analysis analysis/music/<track>.json
//     [--photos analysis/photos.json] [--brief brief.json] [--directives directives.json]
//     [--extra-tracks 0] [--out analysis/fit_plan.json]
//
// Only USABLE photos count: a caller that has pruned missing/unreadable files should pass
// the pruned list, because a fit computed against files that will not render is a lie.
import fs from "node:fs";
import path from "node:path";
import { assessFit } from "./lib/fitPlan.mjs";
import { validate } from "./lib/checkSchema.mjs";
import { loadLedger, active } from "./lib/directives.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const die = (msg) => { console.error(`[assessFit] FAILED: ${msg}`); process.exit(1); };
const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const exists = (p) => p && fs.existsSync(path.resolve(root, p));

const musicJsonPath = arg("--music-analysis", "");
const photosPath = arg("--photos", "analysis/photos.json");
const briefPath = arg("--brief", "");
const directivesPath = arg("--directives", "");
const extraTracks = Number(arg("--extra-tracks", "0")) || 0;
const outPath = arg("--out", "analysis/fit_plan.json");

if (!musicJsonPath) die("--music-analysis is required (analysis/music/<track>.json)");
if (!exists(musicJsonPath)) die(`music analysis not found: ${musicJsonPath} — run analyzeMusic first`);
if (!exists(photosPath)) die(`photos not found: ${photosPath}`);

const music = readJson(musicJsonPath);
const brief = exists(briefPath) ? readJson(briefPath) : {};
const orders = exists(directivesPath) ? active(loadLedger(path.resolve(root, directivesPath))) : [];
const excluded = new Set(brief.excludePhotos || []);
const raw = readJson(photosPath);
const photos = (Array.isArray(raw) ? raw : raw.photos ?? []).filter((p) => !excluded.has(p.file));
if (!photos.length) die(`${photosPath} has no photos`);

const plan = assessFit({ music, photos, orders, brief, extraTracks });

const out = {
  generatedBy: "fit-advisor",
  generatedAt: new Date().toISOString(),
  regime: plan.regime,
  preAnswered: plan.preAnswered,
  evidence: plan.evidence,
  options: plan.options,
};

const errors = validate(readJson("schema/fit-plan.schema.json"), out);
if (errors.length) {
  console.error("[assessFit] fit_plan failed schema:");
  for (const e of errors.slice(0, 20)) console.error("  - " + e);
  process.exit(1);
}

const absOut = path.resolve(root, outPath);
fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(absOut, JSON.stringify(out, null, 2) + "\n");

const opts = plan.options.map((o) => `${o.recommended ? "→ " : "  "}${o.label}`).join("\n  ");
console.log(
  `[assessFit] ${plan.regime} — ${plan.evidence.photoCount} photos / ${plan.evidence.musicDuration}s ` +
  `(${plan.evidence.secondsPerPhoto ?? "∞"}s each; band ${plan.evidence.feasibleBand.min}–${plan.evidence.feasibleBand.max})` +
  (plan.preAnswered ? "\n  (the prompt already answered this — no question)" : "") +
  (opts ? `\n  ${opts}` : "\n  balanced — no question") +
  `\n  -> ${outPath}`,
);
