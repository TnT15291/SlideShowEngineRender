import fs from "node:fs";
import path from "node:path";
import { validate } from "./checkSchema.mjs";

export const root = process.cwd();

export function arg(flag, fallback = undefined) {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function slug(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function loadProject(projectArg) {
  if (!projectArg) throw new Error("Missing --project <directory>");
  const dir = path.resolve(root, projectArg);
  const manifestPath = path.join(dir, "project.json");
  if (!fs.existsSync(manifestPath)) throw new Error(`Project manifest not found: ${manifestPath}`);
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid project manifest JSON: ${manifestPath}: ${error.message}`);
  }

  const schema = JSON.parse(fs.readFileSync(path.join(root, "schema", "project.schema.json"), "utf8"));
  const errors = validate(schema, manifest);
  if (errors.length) {
    throw new Error(`Invalid project manifest: ${manifestPath}\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }

  const project = {
    dir,
    relDir: path.relative(root, dir).replace(/\\/g, "/"),
    manifest,
    abs: (p) => path.resolve(dir, p),
    rel: (p) => path.relative(root, path.resolve(dir, p)).replace(/\\/g, "/"),
  };
  preflightProject(project);
  return project;
}

function preflightProject(project) {
  const paths = [
    ["inputDir", project.manifest.inputDir, "directory"],
    ...(project.manifest.promptFile ? [["promptFile", project.manifest.promptFile, "file"]] : []),
    ...project.manifest.music.map((value, index) => [`music[${index}]`, value, "file"]),
  ];

  for (const [field, value, kind] of paths) {
    const target = ensureInsideProject(project, project.abs(value));
    if (!fs.existsSync(target)) throw new Error(`Project preflight failed: ${field} does not exist: ${target}`);
    const stat = fs.statSync(target);
    if (kind === "file" ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error(`Project preflight failed: ${field} must be a ${kind}: ${target}`);
    }
  }

  for (const field of ["analysisDir", "selectionPolicy", "selectedPhotos", "story", "timeline", "output"]) {
    if (project.manifest[field]) ensureInsideProject(project, project.abs(project.manifest[field]));
  }
}

export function ensureInsideProject(project, target) {
  const abs = path.resolve(target);
  const rel = path.relative(project.dir, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error(`Path escapes project: ${abs}`);
  return abs;
}
