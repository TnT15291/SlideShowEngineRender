import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseTimestamp, probeMedia, silentWav, wavDuration } from "../scripts/lib/mediaTools.mjs";
import { chunkCue, cuesForSegment, wrapCue } from "../scripts/lib/subtitles.mjs";
import {
  alignCutsToPauses,
  coalesceShortWindows,
  renderedDuration,
  splitWindow,
  transitionFor,
} from "../scripts/lib/narratedTimeline.mjs";

test("media helpers parse timestamps and create exact 48 kHz silence", () => {
  assert.equal(parseTimestamp("00:01:02.5"), 62.5);
  assert.equal(parseTimestamp("7.25"), 7.25);
  assert.throws(() => parseTimestamp("1:2"), /Invalid timestamp/);
  const wav = silentWav(0.8);
  assert.ok(Math.abs(wavDuration(wav) - 0.8) < 0.00001);
});

test("short narration windows merge with the next beat", () => {
  const result = coalesceShortWindows([
    { start: 0, end: 1.2, beats: [{ id: "b1" }] },
    { start: 1.2, end: 5, beats: [{ id: "b2" }] },
    { start: 5, end: 8, beats: [{ id: "b3" }] },
  ]);
  assert.deepEqual(result.map((item) => item.beats.map((beat) => beat.id)), [["b1", "b2"], ["b3"]]);
  assert.equal(result[0].end - result[0].start, 5);
});

test("merging keeps absorbing until the window clears the two-second floor", () => {
  const result = coalesceShortWindows([
    { start: 0, end: 0.6, beats: [{ id: "b1" }] },
    { start: 0.6, end: 1.2, beats: [{ id: "b2" }] },
    { start: 1.2, end: 1.8, beats: [{ id: "b3" }] },
    { start: 1.8, end: 6, beats: [{ id: "b4" }] },
  ]);
  assert.ok(result.every((window) => window.end - window.start >= 2), JSON.stringify(result));
  assert.deepEqual(result.map((item) => item.beats.map((beat) => beat.id)), [["b1", "b2", "b3", "b4"]]);
});

test("a trailing short window folds back into its predecessor", () => {
  const result = coalesceShortWindows([
    { start: 0, end: 5, beats: [{ id: "b1" }] },
    { start: 5, end: 5.4, beats: [{ id: "b2" }] },
  ]);
  assert.equal(result.length, 1);
  assert.equal(result[0].end, 5.4);
  assert.throws(() => coalesceShortWindows([{ start: 0, end: 1, beats: [{ id: "b1" }] }]), /two-second minimum/);
});

test("cuts move off the first word of the next line and into the pause", () => {
  // Line one speaks 0→4, pause to 5; line two starts at 5. A 0.6s crossfade
  // left on the boundary would dissolve across "…" of the new sentence.
  const groups = alignCutsToPauses([
    { start: 0, end: 5, speechEnd: 4, beats: [{ id: "b1", section: "a" }] },
    { start: 5, end: 12, speechEnd: 11, beats: [{ id: "b2", section: "a" }] },
  ]);
  assert.equal(groups[0].end, 4.4, "dissolve should finish as the next line begins");
  assert.equal(groups[1].start, 4.4);
  // Total span is preserved, so the film still covers the whole narration.
  assert.equal(groups.at(-1).end - groups[0].start, 12);
});

test("aligning never cuts into speech or below the slide floor", () => {
  // Pause (0.2s) shorter than the 1.0s section dissolve: clamp at speech end.
  const short = alignCutsToPauses([
    { start: 0, end: 5, speechEnd: 4.8, beats: [{ id: "b1", section: "a" }] },
    { start: 5, end: 9, speechEnd: 8, beats: [{ id: "b2", section: "b" }] },
  ]);
  assert.equal(short[0].end, 4.8);
  // A 2.1s window may only give back 0.1s before it breaks the engine minimum.
  const tight = alignCutsToPauses([
    { start: 0, end: 2.1, speechEnd: 1.0, beats: [{ id: "b1", section: "a" }] },
    { start: 2.1, end: 6, speechEnd: 5, beats: [{ id: "b2", section: "a" }] },
  ]);
  assert.equal(tight[0].end, 2);
});

test("long narration windows split below the slide cap", () => {
  const parts = splitWindow({ start: 10, end: 75, beats: [{ id: "b1" }] });
  assert.equal(parts.length, 3);
  assert.equal(parts[0].start, 10);
  assert.equal(parts.at(-1).end, 75);
  assert.ok(parts.every((part) => part.end - part.start <= 28));
});

test("transition overlap is added back to authored durations", () => {
  const slides = [
    { duration: 10.6, transition: { duration: 0.6 } },
    { duration: 8, transition: { duration: 0 } },
  ];
  assert.equal(renderedDuration(slides), 18);
  assert.deepEqual(
    transitionFor(
      { beats: [{ section: "a" }] },
      { beats: [{ section: "b" }] },
    ),
    { type: "fade_slow", duration: 1 },
  );
});

test("subtitle cues stay readable and keep the beat's window", () => {
  const beat = "Trải qua chặng đường hai mươi mốt năm bền bỉ và kiên cường, phong trào toàn dân bảo vệ an ninh Tổ quốc tại xã Lao Bảo đã từng bước khẳng định vai trò trung tâm của Nhân dân trong sự nghiệp giữ gìn an ninh trật tự.";
  const cues = cuesForSegment({ start: 10, end: 30, text: beat });
  assert.ok(cues.length >= 3, `expected the paragraph to split, got ${cues.length}`);
  assert.equal(cues[0].start, 10);
  assert.equal(cues.at(-1).end, 30);
  for (const cue of cues) {
    assert.ok(cue.end > cue.start, "cue must advance");
    for (const line of cue.text.split("\n")) {
      assert.ok(line.length <= 48, `line too long (${line.length}): ${line}`);
    }
    assert.ok(cue.text.split("\n").length <= 2, "cue must fit two lines");
  }
  assert.deepEqual(cues.map((cue) => cue.text.replace(/\n/g, " ")).join(" "), beat);
  assert.equal(chunkCue("   ").length, 0);
  assert.equal(wrapCue("ngắn"), "ngắn");
});

test("narrated timeline builder produces an engine-valid dry run", () => {
  const root = process.cwd();
  const parent = path.join(root, "temp");
  fs.mkdirSync(parent, { recursive: true });
  const projectDir = fs.mkdtempSync(path.join(parent, "narrated-smoke-"));
  try {
    for (const dir of ["photos", "analysis", "script", "voice/lines", "timeline", "output", "logs", "temp"]) {
      fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
      version: 1,
      id: "narrated-smoke",
      name: "Narrated smoke",
      inputDir: "photos",
      music: [],
      analysisDir: "analysis",
      timeline: "timeline/antt-lao-bao.json",
      output: "output/final.mp4",
      quality: "draft",
    }));
    fs.writeFileSync(path.join(projectDir, "script", "script.json"), JSON.stringify({
      reviewStatus: "approved",
      project: { name: "Narrated smoke", quality: "draft", output: "output/final.mp4" },
      voice: { provider: "vieneu", voice: "Phạm Tuyên", speed: 0, leadingSilence: 0.8, defaultPause: 0.45 },
      music: [],
      beats: [{
        id: "b001",
        section: "opening",
        narration: "Đây là lời đọc kiểm thử.",
        visual: { kind: "title", title: "KIỂM THỬ", subtitle: "Lao Bảo" },
      }],
    }));
    fs.writeFileSync(path.join(projectDir, "voice", "lines", "b001.wav"), silentWav(3.75));
    const relativeProject = path.relative(root, projectDir);
    const stitch = spawnSync(process.execPath, ["scripts/synthesizeNarration.mjs", "--project", relativeProject, "--stitch-only"], {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, FFMPEG_PATH: "" },
    });
    assert.equal(stitch.status, 0, stitch.stderr || stitch.stdout);
    const narration = JSON.parse(fs.readFileSync(path.join(projectDir, "voice", "narration.json"), "utf8"));
    assert.ok(Math.abs(narration.totalDuration - 5) < 0.1);
    const build = spawnSync(process.execPath, ["scripts/buildNarratedTimeline.mjs", "--project", relativeProject], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(build.status, 0, build.stderr || build.stdout);
    const subtitles = spawnSync(process.execPath, ["scripts/exportNarrationSrt.mjs", "--project", relativeProject], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(subtitles.status, 0, subtitles.stderr || subtitles.stdout);
    assert.match(fs.readFileSync(path.join(projectDir, "output", "final.srt"), "utf8"), /00:00:00,800 --> 00:00:04,550/);
    const render = spawnSync(
      process.execPath,
      ["--import", "tsx", "src/index.ts", "--timeline", path.join(relativeProject, "timeline/antt-lao-bao.json"), "--job-dir", relativeProject, "--dry-run"],
      { cwd: root, encoding: "utf8" },
    );
    assert.equal(render.status, 0, render.stderr || render.stdout);
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test("footage preparation pads portrait video and strips audio", async () => {
  const root = process.cwd();
  const localFfmpeg = path.join(root, "node_modules", "ffmpeg-static", process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg");
  const parent = path.join(root, "temp");
  fs.mkdirSync(parent, { recursive: true });
  const projectDir = fs.mkdtempSync(path.join(parent, "footage-smoke-"));
  try {
    for (const dir of ["photos", "analysis", "footage/raw", "footage/clips"]) {
      fs.mkdirSync(path.join(projectDir, dir), { recursive: true });
    }
    fs.writeFileSync(path.join(projectDir, "project.json"), JSON.stringify({
      version: 1,
      id: "footage-smoke",
      name: "Footage smoke",
      inputDir: "photos",
      music: [],
      analysisDir: "analysis",
      timeline: "timeline/timeline.json",
      output: "output/final.mp4",
      quality: "draft",
    }));
    const source = path.join(projectDir, "footage", "raw", "portrait.mp4");
    const make = spawnSync(localFfmpeg, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "color=c=blue:s=360x640:r=60:d=3",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
      "-shortest", "-c:v", "libx264", "-c:a", "aac", source,
    ], { cwd: root, encoding: "utf8" });
    assert.equal(make.status, 0, make.error?.message || make.stderr);
    const relativeProject = path.relative(root, projectDir);
    const prepare = spawnSync(process.execPath, [
      "scripts/prepareFootage.mjs", "--project", relativeProject,
      "--in", "footage/raw/portrait.mp4", "--start", "0.25", "--duration", "2",
      "--out", "footage/clips/portrait.mp4", "--label", "Portrait fixture",
    ], { cwd: root, encoding: "utf8", env: { ...process.env, FFMPEG_PATH: localFfmpeg } });
    assert.equal(prepare.status, 0, prepare.stderr || prepare.stdout);
    const output = path.join(projectDir, "footage", "clips", "portrait.mp4");
    const media = await probeMedia(output, localFfmpeg);
    assert.deepEqual([media.width, media.height, Math.round(media.fps)], [1920, 1080, 30]);
    assert.equal(media.hasAudio, false);
    const catalog = JSON.parse(fs.readFileSync(path.join(projectDir, "footage", "footage.json"), "utf8"));
    assert.equal(catalog.clips[0].orient, "portrait");
  } finally {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
