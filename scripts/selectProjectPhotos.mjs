import fs from "node:fs";
import path from "node:path";
import { arg, loadProject } from "./lib/project.mjs";

const project = loadProject(arg("--project"));
const read = (rel) => JSON.parse(fs.readFileSync(project.abs(rel), "utf8"));
const analysisDir = project.manifest.analysisDir;
const photosDoc = read(`${analysisDir}/photos.json`);
const contentRel = `${analysisDir}/photo_content.json`;
const content = fs.existsSync(project.abs(contentRel)) ? read(contentRel) : { photos: [] };
const policy = read(project.manifest.selectionPolicy || "analysis/selection_policy.json");
const semantic = new Map((content.photos || []).map((p) => [p.file, p]));

function categoriesFor(photo) {
  const tags = semantic.get(photo.file)?.tags || [];
  return new Set(tags.map((tag) => tag === "guest" ? "guests" : tag));
}
function strong(photo) {
  const ai = semantic.get(photo.file);
  const semanticOk = content.generatedBy === "stub" || !ai || (ai.heroScore ?? 0.5) >= 0.35 || (ai.storyImportance ?? 0.5) >= 0.45;
  return photo.qualityNorm >= 0.35 && semanticOk;
}

let selected;
if (policy.mode === "keep_all") selected = [...photosDoc.photos];
else if (policy.mode === "best_only") selected = photosDoc.photos.filter(strong);
else {
  const keep = new Set(policy.keepCategories || []);
  const optimize = new Set(policy.optimizeCategories || []);
  selected = photosDoc.photos.filter((photo) => {
    const cats = categoriesFor(photo);
    if ([...cats].some((c) => keep.has(c))) return true;
    if ([...cats].some((c) => optimize.has(c))) return strong(photo);
    return true; // unspecified categories are preserved
  });
}
if (!selected.length) selected = [...photosDoc.photos].sort((a, b) => b.qualityNorm - a.qualityNorm).slice(0, 1);

const selectedFiles = new Set(selected.map((p) => p.file));
const result = {
  dir: photosDoc.dir,
  count: selected.length,
  sourceCount: photosDoc.photos.length,
  policy: policy.mode,
  removed: photosDoc.photos.filter((p) => !selectedFiles.has(p.file)).map((p) => p.file),
  photos: selected,
};
if (policy.mode === "keep_all" && result.count !== result.sourceCount) throw new Error("keep_all invariant violated");
const rel = project.manifest.selectedPhotos || "analysis/photos.selected.json";
const out = project.abs(rel);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(`Wrote ${project.rel(rel)}: kept ${result.count}/${result.sourceCount}, mode=${policy.mode}.`);
