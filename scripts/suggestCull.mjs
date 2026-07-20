// When a customer sends far more photos than their song can hold, the fit advisor offers a
// "cull" option. This script turns that option into a concrete, REVIEWABLE list: which photos
// to drop, and WHY each one — never a silent deletion. It only SUGGESTS. Applying the cull
// (writing photos.selected.json) is a separate, consented step; the album's selection policy
// defaults to keep_all precisely so nothing is thrown away without a person saying so.
//
//   node scripts/suggestCull.mjs --photos analysis/photos.json --keep 50
//     [--brief brief.json] [--out analysis/cull_suggestion.json]
//
// Zero AI calls. The ranking uses only the deterministic signals analyzePhotos already wrote:
//   1. near-duplicates that are not their group's representative  → droppable first
//   2. then lowest qualityNorm
// Locked, never dropped: must-use photos, the opening and closing picks, and the sole
// representative of any duplicate group (dropping the rep would lose that moment entirely).
import fs from "node:fs";
import path from "node:path";
import { validate } from "./lib/checkSchema.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const die = (msg) => { console.error(`[suggestCull] FAILED: ${msg}`); process.exit(1); };
const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const exists = (p) => p && fs.existsSync(path.resolve(root, p));
const base = (f) => String(f).split("/").pop();

const photosPath = arg("--photos", "analysis/photos.json");
const briefPath = arg("--brief", "");
const keep = Number(arg("--keep", "0"));
const outPath = arg("--out", "analysis/cull_suggestion.json");

if (!exists(photosPath)) die(`photos not found: ${photosPath}`);
if (!Number.isFinite(keep) || keep < 1) die(`--keep must be a positive count (photos to KEEP), got "${arg("--keep", "0")}"`);

const raw = readJson(photosPath);
const photos = (Array.isArray(raw) ? raw : raw.photos ?? []).slice();
if (!photos.length) die(`${photosPath} has no photos`);
const brief = exists(briefPath) ? readJson(briefPath) : {};

if (keep >= photos.length) {
  console.log(`[suggestCull] keep=${keep} >= ${photos.length} photos — nothing to cull.`);
  writeOut({ keep, sourceCount: photos.length, drop: [], locked: [], note: "album already fits; no cull needed" });
}

// --- what may never be dropped -------------------------------------------------
const mustUse = new Set(brief.mustUsePhotos || []);
const argmax = (key) => photos.reduce((best, p) => ((p[key] ?? -1) > (best?.[key] ?? -1) ? p : best), null);
const opening = argmax("openingScore");
const closing = argmax("closingScore");
// A duplicate group's single representative carries that moment; only its siblings are droppable.
const repOf = new Set(photos.filter((p) => p.duplicateGroup && p.duplicateRepresentative).map((p) => p.file));
const groupRep = new Map(); // group -> representative filename, for the reason string
for (const p of photos) if (p.duplicateGroup && p.duplicateRepresentative) groupRep.set(p.duplicateGroup, p.file);

const locked = new Map(); // file -> reason it is locked
for (const p of photos) {
  if (mustUse.has(p.file)) locked.set(p.file, "khách chỉ định giữ (must-use)");
  else if (opening && p.file === opening.file) locked.set(p.file, "ảnh mở đầu (điểm opening cao nhất)");
  else if (closing && p.file === closing.file) locked.set(p.file, "ảnh kết (điểm closing cao nhất)");
  // Keep the best photo of every near-duplicate cluster: drop the siblings, never the one
  // that carries the moment. Without this a group's rep could later be culled for low
  // quality after its siblings were already dropped, losing the moment entirely.
  else if (repOf.has(p.file)) locked.set(p.file, "ảnh đại diện của cụm trùng (giữ tấm tốt nhất)");
}

// --- rank the droppable photos, worst first -----------------------------------
const droppable = photos.filter((p) => !locked.has(p.file));
const isRedundantDup = (p) => p.duplicateGroup && !p.duplicateRepresentative;
const dropScore = (p) => (isRedundantDup(p) ? 0 : 1) + (p.qualityNorm ?? 0.5); // dups sort ahead of everything
const reasonFor = (p) => {
  if (isRedundantDup(p)) {
    const rep = groupRep.get(p.duplicateGroup);
    return `trùng với ${rep ? base(rep) : "một ảnh khác"}${Number.isFinite(p.duplicateDistance) ? ` (khác biệt ${p.duplicateDistance})` : ""}`;
  }
  const pct = Math.round((p.qualityNorm ?? 0) * 100);
  return `độ nét thấp (nhóm ${pct}% chất lượng)`;
};

const ranked = droppable
  .map((p) => ({ p, score: dropScore(p) }))
  .sort((a, b) => a.score - b.score || (a.p.qualityNorm ?? 0) - (b.p.qualityNorm ?? 0));

const toDrop = photos.length - keep;
const drop = ranked.slice(0, toDrop).map(({ p }) => ({
  file: p.file,
  reason: reasonFor(p),
  qualityNorm: p.qualityNorm ?? null,
  ...(p.duplicateGroup ? { duplicateGroup: p.duplicateGroup } : {}),
}));

// Honesty when the cull cannot reach the target without touching locked photos.
const shortfall = Math.max(0, toDrop - drop.length);

writeOut({
  keep,
  sourceCount: photos.length,
  drop,
  locked: [...locked].map(([file, reason]) => ({ file, reason })),
  ...(shortfall ? { shortfall, note: `${shortfall} more would have to be dropped to reach ${keep}, but only locked photos remain — keeping them` } : {}),
});

function writeOut(doc) {
  const out = { generatedBy: "cull-advisor", generatedAt: new Date().toISOString(), ...doc };
  const errors = validate(readJson("schema/cull-suggestion.schema.json"), out);
  if (errors.length) {
    console.error("[suggestCull] cull_suggestion failed schema:");
    for (const e of errors.slice(0, 20)) console.error("  - " + e);
    process.exit(1);
  }
  const absOut = path.resolve(root, outPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, JSON.stringify(out, null, 2) + "\n");
  const dupN = (doc.drop || []).filter((d) => d.duplicateGroup).length;
  console.log(
    `[suggestCull] keep ${doc.keep}/${doc.sourceCount}, suggest dropping ${(doc.drop || []).length} ` +
    `(${dupN} near-duplicates, ${(doc.drop || []).length - dupN} low-quality); ${doc.locked?.length || 0} locked` +
    (doc.shortfall ? `; ${doc.shortfall} short of target (only locked photos remain)` : "") +
    `\n  -> ${outPath}  (suggestion only — nothing dropped until you approve)`,
  );
  process.exit(0);
}
