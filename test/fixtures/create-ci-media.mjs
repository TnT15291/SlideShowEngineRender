import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const run = (args) => {
  const result = spawnSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

fs.mkdirSync("input", { recursive: true });
fs.mkdirSync("music", { recursive: true });
fs.mkdirSync(path.join("analysis", "music"), { recursive: true });
fs.mkdirSync(path.join("assets", "backgrounds"), { recursive: true });
fs.mkdirSync(path.join("assets", "frames", "custom-wedding-frames-20"), { recursive: true });
for (let index = 1; index <= 6; index++) {
  const size = index % 2 ? "640x360" : "360x640";
  run(["-f", "lavfi", "-i", `testsrc2=size=${size}:rate=1`, "-vf", `hue=h=${index * 47}`,
    "-frames:v", "1", `input/${String(index).padStart(3, "0")}.jpg`]);
}
for (let index = 7; index <= 130; index++) {
  const source = String((index % 6) + 1).padStart(3, "0");
  fs.copyFileSync(`input/${source}.jpg`, `input/${String(index).padStart(3, "0")}.jpg`);
}
run(["-f", "lavfi", "-i", "color=c=black:s=640x360:r=30", "-t", "1", "-pix_fmt", "yuv420p",
  "assets/backgrounds/mixkit_wedding_flower_arrangement_calla_lilies_1080.mp4"]);
run(["-f", "lavfi", "-i", "color=c=white@0.1:s=640x360", "-frames:v", "1",
  "assets/frames/custom-wedding-frames-20/wedding_frame_botanical_01.png"]);

const assetRefs = new Set();
const collectAssets = (value) => {
  if (typeof value === "string" && value.startsWith("assets/")) assetRefs.add(value);
  else if (Array.isArray(value)) value.forEach(collectAssets);
  else if (value && typeof value === "object") Object.values(value).forEach(collectAssets);
};
for (const file of fs.readdirSync("story-templates").filter((name) => name.endsWith(".json"))) {
  collectAssets(JSON.parse(fs.readFileSync(path.join("story-templates", file), "utf8")));
}
collectAssets(JSON.parse(fs.readFileSync(path.join("layouts", "library.json"), "utf8")));
for (const asset of assetRefs) {
  if (fs.existsSync(asset)) continue;
  fs.mkdirSync(path.dirname(asset), { recursive: true });
  const source = /\.(mp4|mov|webm)$/i.test(asset)
    ? "assets/backgrounds/mixkit_wedding_flower_arrangement_calla_lilies_1080.mp4"
    : /\.(png|webp)$/i.test(asset)
      ? "assets/frames/custom-wedding-frames-20/wedding_frame_botanical_01.png"
      : "input/001.jpg";
  fs.copyFileSync(source, asset);
}

const tracks = [
  ["River Flows In You", 188.83],
  ["Perfect", 180],
  ["Em Đồng Ý (I Do)", 203],
  ["a thousand years", 285.12],
];
for (const [name, duration] of tracks) {
  run(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo", "-t", "1", `music/${name}.mp3`]);
  const phrases = Array.from({ length: Math.ceil(duration / 8) + 1 }, (_, index) => ({
    index, time: Math.min(duration, index * 8), kind: "phrase",
  }));
  fs.writeFileSync(path.join("analysis", "music", `${name}.json`), JSON.stringify({
    analysisVersion: 2,
    duration,
    envelope: Array.from({ length: Math.ceil(duration * 2) }, (_, index) => 0.35 + (index % 8) * 0.05),
    beatGrid: { beatSeconds: 0.5, phase: 0, source: "ci-fixture" },
    phrases,
    sections: [{ start: 0, end: duration, kind: "normal" }],
  }));
}

const photos = Array.from({ length: 130 }, (_, index) => ({
  file: `input/${String(index + 1).padStart(3, "0")}.jpg`,
  w: index % 2 ? 360 : 640,
  h: index % 2 ? 640 : 360,
  orient: index % 2 ? "portrait" : "landscape",
  sharpness: 30,
  meanLuma: 128,
  qualityNorm: 0.9 - index / 1000,
  focusX: 0.5,
  focusY: 0.45,
}));
fs.writeFileSync(path.join("analysis", "photos.json"), JSON.stringify({ photos }));
