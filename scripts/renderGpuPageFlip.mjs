import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const arg = (name, fallback = "") => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};

const from = arg("--from");
const to = arg("--to");
const out = arg("--out", "temp/gpu-page-flip.mp4");

if (!from || !to) {
  console.error("Usage: node scripts/renderGpuPageFlip.mjs --from photo-a.jpg --to photo-b.jpg [--out output.mp4]");
  process.exit(1);
}

for (const file of [from, to]) {
  if (!fs.existsSync(file)) throw new Error(`Image not found: ${file}`);
}

const publicDir = path.resolve("public/gpu-effects");
fs.mkdirSync(publicDir, { recursive: true });
fs.copyFileSync(from, path.join(publicDir, "page-a.jpg"));
fs.copyFileSync(to, path.join(publicDir, "page-b.jpg"));
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });

const remotionCli = path.resolve("node_modules/@remotion/cli/remotion-cli.js");
const result = spawnSync(process.execPath, [
  remotionCli,
  "render",
  "gpu-effects/index.ts",
  "PageFlipDemo",
  out,
  "--codec=h264",
], { stdio: "inherit" });

process.exit(result.status ?? 1);
