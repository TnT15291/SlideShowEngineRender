import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

test("Premium storyboard planning uses the combined playlist duration", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "premium-playlist-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const analysisDir = path.join(temp, "analysis");
  fs.mkdirSync(path.join(analysisDir, "music"), { recursive: true });
  const music = (duration) => ({
    analysisVersion: 2,
    duration,
    bpmEstimate: 120,
    beatGrid: { beatSeconds: 0.5 },
    envelope: Array.from({ length: Math.ceil(duration / 2) }, (_, index) => ({ time: index * 2, rms: 0.5 })),
    phrases: Array.from({ length: Math.ceil(duration / 8) + 1 }, (_, index) => ({ index, time: Math.min(duration, index * 8) })),
    downbeats: Array.from({ length: Math.ceil(duration / 4) }, (_, index) => ({ index, time: index * 4 })),
    sections: [{ start: 0, end: duration, kind: "calm" }],
  });
  fs.writeFileSync(path.join(analysisDir, "music", "one.json"), JSON.stringify(music(60)));
  fs.writeFileSync(path.join(analysisDir, "music", "two.json"), JSON.stringify(music(40)));
  const photos = Array.from({ length: 50 }, (_, index) => ({
    file: `input/${index}.jpg`, orient: index % 2 ? "portrait" : "landscape",
    qualityNorm: 0.9, sharpness: 30, meanLuma: 128,
  }));
  const photosPath = path.join(temp, "photos.json");
  const outPath = path.join(temp, "storyboard.json");
  fs.writeFileSync(photosPath, JSON.stringify({ photos }));

  const result = spawnSync(process.execPath, [
    "scripts/composeStoryboard.mjs",
    "--photos", photosPath,
    "--music", "music/one.mp3",
    "--extra-music", "music/two.mp3",
    "--analysis-dir", analysisDir,
    "--plan", "none",
    "--director", "none",
    "--out", outPath,
  ], { cwd: root, encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const storyboard = JSON.parse(fs.readFileSync(outPath, "utf8"));
  assert.equal(storyboard.musicEdit.mode, "playlist");
  assert.equal(storyboard.musicEdit.duration, 98);
  assert.match(storyboard.source.notes, /98s track/);
});
