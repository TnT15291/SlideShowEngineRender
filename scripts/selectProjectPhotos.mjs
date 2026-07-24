import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { arg, loadProject } from "./lib/project.mjs";

const project = loadProject(arg("--project"));
const read = (rel) => JSON.parse(fs.readFileSync(project.abs(rel), "utf8"));
const analysisDir = project.manifest.analysisDir;
const photosRel = `${analysisDir}/photos.json`;
const photosRaw = fs.readFileSync(project.abs(photosRel), "utf8");
const photosDoc = JSON.parse(photosRaw);
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
let appliedCull = false;
const cullApprovalRel = `${analysisDir}/cull_approval.json`;
if (fs.existsSync(project.abs(cullApprovalRel))) {
  try {
    const approval = read(cullApprovalRel);
    const sourceHash = crypto.createHash("sha256").update(photosRaw).digest("hex");
    if (approval.sourceHash === sourceHash && approval.sourceCount === photosDoc.photos.length && Array.isArray(approval.drop)) {
      const drop = new Set(approval.drop.map((item) => item.file));
      if ([...drop].every((file) => photosDoc.photos.some((photo) => photo.file === file))) {
        selected = photosDoc.photos.filter((photo) => !drop.has(photo.file));
        appliedCull = true;
      }
    } else {
      console.warn("Ignoring stale cull approval; photo analysis has changed.");
    }
  } catch (error) {
    console.warn(`Ignoring invalid cull approval: ${error.message}`);
  }
}
if (!selected.length) selected = [...photosDoc.photos].sort((a, b) => b.qualityNorm - a.qualityNorm).slice(0, 1);

const selectedFiles = new Set(selected.map((p) => p.file));
const result = {
  dir: photosDoc.dir,
  count: selected.length,
  sourceCount: photosDoc.photos.length,
  policy: appliedCull ? "cull_approved" : policy.mode,
  removed: photosDoc.photos.filter((p) => !selectedFiles.has(p.file)).map((p) => p.file),
  photos: selected,
};
if (policy.mode === "keep_all" && !appliedCull && result.count !== result.sourceCount) throw new Error("keep_all invariant violated");
const rel = project.manifest.selectedPhotos || "analysis/photos.selected.json";
const out = project.abs(rel);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
console.log(`Wrote ${project.rel(rel)}: kept ${result.count}/${result.sourceCount}, mode=${policy.mode}.`);
