import fs from "node:fs";
import path from "node:path";
import { buildLiteQualityReport } from "./lib/liteQualityReport.mjs";

const arg = (flag, fallback = "") => {
  const index = process.argv.indexOf(flag);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const timelinePath = arg("--timeline");
if (!timelinePath) throw new Error("Usage: node scripts/reportLiteQuality.mjs --timeline <timeline.json> [--photos photos.json] [--proxy report.json] [--qa-loop report.json] [--out report.json]");
const read = (file, fallback = {}) => file && fs.existsSync(path.resolve(file))
  ? JSON.parse(fs.readFileSync(path.resolve(file), "utf8")) : fallback;
const timeline = read(timelinePath);
const photosDoc = read(arg("--photos"), { photos: [] });
const proxy = read(arg("--proxy"));
const qaLoop = read(arg("--qa-loop"));
const report = buildLiteQualityReport({ timeline, photos: photosDoc.photos || photosDoc, proxy, qaLoop });
const out = arg("--out");
if (out) {
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(path.resolve(out), JSON.stringify(report, null, 2) + "\n");
  console.log(`[reportLiteQuality] ${out}`);
} else {
  console.log(JSON.stringify(report, null, 2));
}
