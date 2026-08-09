import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

test("Lite text fitter handles captions and layer text through one measured policy", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lite-text-fit-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const timelinePath = path.join(dir, "timeline", "timeline.json");
  const reportPath = path.join(dir, "analysis", "text-fit.json");
  fs.mkdirSync(path.dirname(timelinePath), { recursive: true });
  const longVietnamese = "Giữa thành phố đông người, chúng mình đã tìm thấy nhau và cùng viết nên một câu chuyện thật dịu dàng, ấm áp, trọn vẹn qua từng mùa yêu thương.";
  fs.writeFileSync(timelinePath, JSON.stringify({
    language: "vi",
    project: { name: "text-fit", width: 1920, height: 1080, fps: 30, quality: "draft" },
    music: [], audio: { fade_in: 0, fade_out: 0, crossfade: 0 }, color: {}, output: { path: "output.mp4" },
    slides: [{
      id: "scene_001", duration: 6, effect: "layer_scene", transition: { type: "none", duration: 0 },
      captions: [{ text: longVietnamese, role: "caption", position: "bottom_center", start: 0.5, duration: 3.5,
        font: "fonts/BeVietnamPro-Regular.ttf", color: "white", shadow: false, animation: "fade" }],
      layers: [
        { type: "image", path: "photo.jpg", x: 0, y: 0, width: 1920, height: 1080, fit: "cover" },
        { type: "text", text: longVietnamese, font: "fonts/BeVietnamPro-Regular.ttf", size: 64,
          x: 180, y: 200, width: 700, height: 260, color: "#ffffff", fontRole: "body" },
      ],
    }],
  }));
  const result = spawnSync(process.execPath, ["scripts/fitTextInTimeline.mjs", timelinePath, "--out", reportPath],
    { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const timeline = JSON.parse(fs.readFileSync(timelinePath, "utf8"));
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  const caption = timeline.slides[0].captions[0];
  const layer = timeline.slides[0].layers.find((item) => item.type === "text");
  assert.ok(caption.text.split("\n").length <= 3);
  assert.ok(layer.text.split("\n").length <= 3);
  assert.ok(caption.size >= 28);
  assert.equal(caption.shadow, true);
  assert.deepEqual(caption.outline, { color: "#000000", width: 2 });
  assert.ok(timeline.slides[0].layers.some((item) => item.type === "rect" && item.opacity >= 0.25));
  assert.equal(report.blockers.length, 0);
  assert.deepEqual(new Set(report.entries.map((entry) => entry.source)), new Set(["caption", "layer"]));
});
