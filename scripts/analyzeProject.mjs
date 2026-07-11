import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { arg, loadProject, root } from "./lib/project.mjs";

const project = loadProject(arg("--project"));
const node = process.execPath;
function run(args, label) {
  console.log(`[analyzeProject] ${label}`);
  const r = spawnSync(node, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status || 1);
}

const photos = project.rel(`${project.manifest.analysisDir}/photos.json`);
const content = project.rel(`${project.manifest.analysisDir}/photo_content.json`);
run([
  "scripts/analyzePhotos.mjs",
  "--dir", project.rel(project.manifest.inputDir),
  "--out", photos,
  "--file-prefix", project.rel(project.manifest.inputDir),
], "photos");
run(["scripts/analyzePhotoContent.mjs", "--photos", photos, "--out", content], "photo content");

for (const track of project.manifest.music || []) {
  const musicPath = project.rel(track);
  const out = project.rel(`${project.manifest.analysisDir}/music/${path.parse(track).name}.json`);
  fs.mkdirSync(path.dirname(path.resolve(root, out)), { recursive: true });
  run(["scripts/analyzeMusic.mjs", musicPath, "--out", out], `music ${track}`);
}
