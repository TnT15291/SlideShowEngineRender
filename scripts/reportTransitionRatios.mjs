import fs from "node:fs";
import path from "node:path";

const roots = process.argv.slice(2).length ? process.argv.slice(2) : ["projects", "timeline"];
const files = [];
const walk = (directory) => {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (entry.name.endsWith(".json") && (file.includes(`${path.sep}timeline${path.sep}`) || entry.name.includes("timeline"))) files.push(file);
  }
};
roots.forEach(walk);
const ratios = [];
for (const file of files) {
  try {
    const timeline = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const slide of timeline.slides || []) {
      const duration = Number(slide.duration || 0);
      const transition = Number(slide.transition?.duration || 0);
      if (duration > 0 && transition > 0) ratios.push(transition / duration);
    }
  } catch {}
}
ratios.sort((a, b) => a - b);
const percentile = (value) => ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * value))] || 0;
console.log(JSON.stringify({ files: files.length, samples: ratios.length, p50: percentile(0.5), p90: percentile(0.9),
  p95: percentile(0.95), p99: percentile(0.99), max: ratios.at(-1) || 0, recommendedCap: 0.30 }, null, 2));
