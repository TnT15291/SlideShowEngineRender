// Copy an analysed project into a throwaway Lite project that differs from the original in
// exactly the fields you name.
//
// Both the per-profile gallery and the canary need this, and they need it to behave
// IDENTICALLY: the gallery compares three builds of one album, the canary compares one build
// across many albums, and a difference in how the input was staged would land in both sets of
// numbers as if it were a difference in the film.
//
// Only the small JSON gets copied. `photos.json` carries repo-root-relative `file` paths and
// the generators never open the pixels, so the staged project points at the original album's
// photographs without duplicating a single one — an 84-photo album stages in milliseconds.
// `input/` and `music/` still have to EXIST because loadProject()'s preflight stats them.
import fs from "node:fs";
import path from "node:path";

export const STAGE_ROOT = "temp/lite-staging";

/**
 * @param {string} sourceDir  absolute path to the source project
 * @param {object} options
 * @param {string} options.workDir     absolute path to stage into (wiped first)
 * @param {object} [options.overrides] project.json fields to override
 * @param {string[]} [options.keepPhotos] if given, only these photo `file` values survive
 * @returns {{ dir: string, photos: object[] }}
 */
export function stageLiteProject(sourceDir, { workDir, overrides = {}, keepPhotos = null } = {}) {
  const manifest = JSON.parse(fs.readFileSync(path.join(sourceDir, "project.json"), "utf8"));
  const analysisDir = manifest.analysisDir || "analysis";
  const storyRel = manifest.story || `${analysisDir}/story-template.generated.json`;
  const sourceAbs = (relative) => path.resolve(sourceDir, relative);

  for (const required of [`${analysisDir}/photos.json`, storyRel]) {
    if (!fs.existsSync(sourceAbs(required))) {
      throw new Error(`Not an analysed project: missing ${required} in ${sourceDir}`);
    }
  }

  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(workDir, "input"), { recursive: true });
  fs.mkdirSync(path.join(workDir, "music"), { recursive: true });

  const copyInto = (relative) => {
    const from = sourceAbs(relative);
    if (!fs.existsSync(from)) return false;
    const to = path.join(workDir, relative);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    return true;
  };

  const photosDoc = JSON.parse(fs.readFileSync(sourceAbs(`${analysisDir}/photos.json`), "utf8"));
  const all = photosDoc.photos || [];
  const photos = keepPhotos ? all.filter((photo) => keepPhotos.includes(photo.file)) : all;
  fs.mkdirSync(path.join(workDir, analysisDir), { recursive: true });
  fs.writeFileSync(path.join(workDir, analysisDir, "photos.json"),
    JSON.stringify({ ...photosDoc, photos }, null, 2) + "\n");

  copyInto(storyRel);
  if (manifest.promptFile) copyInto(manifest.promptFile);
  // A photo subset invalidates a stored selection: it can name photographs that no longer
  // exist, and applyStoryTemplate would solve against a pool the album cannot supply.
  if (!keepPhotos && manifest.selectedPhotos && fs.existsSync(sourceAbs(manifest.selectedPhotos))) {
    copyInto(manifest.selectedPhotos);
  }
  const musicAnalysis = sourceAbs(`${analysisDir}/music`);
  if (fs.existsSync(musicAnalysis)) {
    for (const file of fs.readdirSync(musicAnalysis)) {
      if (file.endsWith(".json")) copyInto(`${analysisDir}/music/${file}`);
    }
  }
  for (const track of manifest.music || []) copyInto(track);

  const staged = { ...manifest, timeline: "timeline/timeline.json", output: "output/final.mp4", tier: "lite", ...overrides };
  if (keepPhotos) delete staged.selectedPhotos;
  fs.writeFileSync(path.join(workDir, "project.json"), JSON.stringify(staged, null, 2) + "\n");
  return { dir: workDir, photos };
}
