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
run(["-f", "lavfi", "-i", "color=c=0x8b3a3a:s=640x360", "-frames:v", "1", "input/001.jpg"]);
run(["-f", "lavfi", "-i", "color=c=0x315b7d:s=360x640", "-frames:v", "1", "input/002.jpg"]);
for (let index = 3; index <= 130; index++) {
  fs.copyFileSync(index % 2 ? "input/001.jpg" : "input/002.jpg", `input/${String(index).padStart(3, "0")}.jpg`);
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
