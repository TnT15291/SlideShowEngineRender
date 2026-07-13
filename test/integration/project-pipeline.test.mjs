import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import ffmpegStatic from "ffmpeg-static";

const root = process.cwd();
const node = process.execPath;

function available(command) {
  return spawnSync(command, ["-version"], { encoding: "utf8" }).status === 0;
}

const ffmpeg = available("ffmpeg") ? "ffmpeg" : ffmpegStatic;
const ffprobe = available("ffprobe")
  ? "ffprobe"
  : ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_, extension = "") => `ffprobe${extension}`);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    ...options,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(" ")} failed (exit ${result.status}):\n${result.stdout || ""}\n${result.stderr || result.error?.message || ""}`,
  );
  return result;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

test("project pipeline dry-runs, renders, resumes, QAs and delivers", { timeout: 120_000 }, (t) => {
  assert.ok(ffmpeg, "FFmpeg is required for the integration test");
  assert.ok(available(ffprobe), "ffprobe is required for the integration test and delivery");

  const id = `pipeline-integration-${process.pid}-${Date.now()}`;
  const rootLoopPath = path.join(root, "analysis", "qa", "timeline.loop.json");
  const rootLoopExisted = fs.existsSync(rootLoopPath);
  const projectRel = `projects/${id}`;
  const projectDir = path.join(root, projectRel);
  t.after(() => fs.rmSync(projectDir, { recursive: true, force: true }));

  run(node, [
    "scripts/createProject.mjs",
    "--id", id,
    "--name", "Pipeline Integration Test",
    "--prompt", "A deterministic four-season story.",
    "--quality", "draft",
  ]);

  const images = [
    ["01-spring.jpg", "0xB84A62", "1280x720", "drawbox=x=80:y=80:w=1120:h=560:color=0xF4D6DC:t=24"],
    ["02-summer.jpg", "0xD99A3D", "720x1280", "drawbox=x=70:y=120:w=580:h=1040:color=0xFFF0C2:t=22"],
    ["03-autumn.jpg", "0x3E776A", "1280x720", "drawbox=x=120:y=90:w=1040:h=540:color=0xB8D8C8:t=26"],
    ["04-winter.jpg", "0x445A82", "720x1280", "drawbox=x=85:y=140:w=550:h=1000:color=0xCAD7EE:t=24"],
  ];
  for (const [name, color, size, detail] of images) {
    run(ffmpeg, [
      "-v", "error", "-y", "-f", "lavfi", "-i", `color=c=${color}:s=${size},${detail}`,
      "-frames:v", "1", path.join(projectDir, "input", name),
    ]);
  }

  const musicPath = path.join(projectDir, "music", "smoke.mp3");
  run(ffmpeg, [
    "-v", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:sample_rate=48000:duration=18",
    "-af", "volume=0.1,afade=t=in:st=0:d=1,afade=t=out:st=16:d=2",
    "-c:a", "libmp3lame", "-b:a", "128k", musicPath,
  ]);

  const projectJson = path.join(projectDir, "project.json");
  const project = readJson(projectJson);
  project.music = ["music/smoke.mp3"];
  fs.writeFileSync(projectJson, JSON.stringify(project, null, 2) + "\n");

  const env = {
    ...process.env,
    OPENAI_API_KEY: "",
    VISION_API_KEY: "",
    DEEPSEEK_API_KEY: "",
    FFMPEG_PATH: ffmpeg,
  };

  run(node, ["scripts/runProject.mjs", "--project", projectRel, "--dry-run"], { env });
  const timelinePath = path.join(projectDir, "timeline", "timeline.json");
  assert.ok(fs.existsSync(timelinePath));
  const timeline = readJson(timelinePath);
  assert.equal(timeline.slides.length, 4);
  assert.equal(timeline.output.path, `${projectRel}/output/final.mp4`);
  run(node, ["scripts/lib/checkSchema.mjs", "schema/timeline.schema.json", path.relative(root, timelinePath)]);

  run(node, ["scripts/runProject.mjs", "--project", projectRel], { env });
  const videoPath = path.join(projectDir, "output", "final.mp4");
  assert.ok(fs.statSync(videoPath).size > 0);

  const qaDir = path.join(projectDir, "analysis", "qa");
  const qa = readJson(path.join(qaDir, "timeline.json"));
  assert.equal(qa.flagged, 0);
  assert.equal(qa.scenes, 4);
  assert.ok(fs.existsSync(path.join(qaDir, "timeline.proxy.json")));

  const metadata = JSON.parse(run(ffprobe, [
    "-v", "error",
    "-show_entries", "stream=codec_name,width,height,r_frame_rate",
    "-show_entries", "format=duration,size",
    "-of", "json", videoPath,
  ]).stdout);
  const videoStream = metadata.streams.find((stream) => stream.codec_name === "h264");
  const audioStream = metadata.streams.find((stream) => stream.codec_name === "aac");
  assert.ok(videoStream);
  assert.ok(audioStream);
  assert.equal(videoStream.width, 1920);
  assert.equal(videoStream.height, 1080);
  assert.equal(videoStream.r_frame_rate, "30/1");
  assert.ok(Number(metadata.format.duration) >= 17.5 && Number(metadata.format.duration) <= 18.5);

  const jobPath = path.join(projectDir, "analysis", "job-manifest.json");
  const firstJob = readJson(jobPath);
  assert.equal(firstJob.status, "completed");
  assert.equal(firstJob.phases.render.status, "completed");
  assert.equal(firstJob.phases.qa.status, "completed");
  assert.equal(firstJob.phases.deliver.status, "skipped");

  const videoMtime = fs.statSync(videoPath).mtimeMs;
  run(node, ["scripts/runProject.mjs", "--project", projectRel, "--resume"], { env });
  assert.equal(fs.statSync(videoPath).mtimeMs, videoMtime);
  const resumedJob = readJson(jobPath);
  for (const phase of ["analyze", "plan", "build", "render", "qa"]) {
    assert.equal(resumedJob.phases[phase].status, "skipped");
    assert.match(resumedJob.phases[phase].reason, /^resume:/);
  }

  run(node, ["scripts/runProject.mjs", "--project", projectRel, "--resume", "--deliver"], { env });
  const deliveryDir = path.join(projectDir, "output", "deliver");
  for (const file of ["final.mp4", "preview.mp4", "thumbnail.jpg", "project_summary.json", "approval-receipt.json"]) {
    assert.ok(fs.statSync(path.join(deliveryDir, file)).size > 0, `${file} is missing or empty`);
  }
  const summary = readJson(path.join(deliveryDir, "project_summary.json"));
  assert.equal(summary.tier, "lite");
  assert.equal(summary.qa.verdict, "ok");
  assert.equal(summary.provenance.photoContent, "stub");

  const proxyPath = path.join(qaDir, "timeline.proxy.json");
  fs.rmSync(proxyPath);
  const exceptionDelivery = path.join(projectDir, "output", "deliver-without-qa");
  run(node, [
    "scripts/deliver.mjs", path.relative(root, timelinePath),
    "--analysis-dir", path.relative(root, path.join(projectDir, "analysis")),
    "--out-dir", path.relative(root, exceptionDelivery),
    "--tier", "lite", "--preview-height", "16", "--allow-qa-flags",
  ], { env });
  const exceptionQa = readJson(path.join(exceptionDelivery, "qa-report.json"));
  assert.equal(exceptionQa.verdict, "unknown");
  assert.match(exceptionQa.reason, /no .*timeline\.proxy\.json/);

  run(node, [
    "scripts/qaLoop.mjs",
    "--timeline", path.relative(root, timelinePath),
    "--analysis-dir", path.relative(root, path.join(projectDir, "analysis")),
    "--skip-render",
  ], { env });
  assert.ok(fs.existsSync(path.join(qaDir, "timeline.loop.json")));
  assert.equal(fs.existsSync(rootLoopPath), rootLoopExisted);
});
