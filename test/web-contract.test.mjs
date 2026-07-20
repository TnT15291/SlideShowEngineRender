import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validate } from "../scripts/lib/checkSchema.mjs";
import { inspectCaptionLanguage } from "../scripts/lib/captionLanguage.mjs";
import { normalizeWebJobRequest } from "../scripts/lib/webJobRequest.mjs";

const schema = JSON.parse(fs.readFileSync("schema/web-job-request.schema.json", "utf8"));
const valid = { webLanguage: "vi", sequenceMode: "editorial", tier: "template", prompt: "Ngày cưới", photos: [{ file: "001.jpg", uploadIndex: 0 }] };

test("web job contract requires the UI language and explicit photo order", () => {
  assert.deepEqual(validate(schema, valid), []);
  assert.deepEqual(validate(schema, { ...valid, language: "en" }), []);
  assert.ok(validate(schema, { ...valid, webLanguage: "fr" }).length);
  assert.ok(validate(schema, { ...valid, language: "fr" }).length);
  assert.ok(validate(schema, { ...valid, photos: [{ file: "001.jpg" }] }).length);
  assert.ok(validate(schema, { ...valid, sequenceMode: "filename" }).length);
});

test("video language selection overrides the web language and otherwise falls back to it", () => {
  assert.equal(normalizeWebJobRequest({ ...valid, webLanguage: "vi", language: "en" }).language, "en");
  assert.equal(normalizeWebJobRequest({ ...valid, webLanguage: "en" }).language, "en");
  assert.equal(normalizeWebJobRequest({ ...valid, webLanguage: "vi" }).language, "vi");
  assert.throws(() => normalizeWebJobRequest({ ...valid, webLanguage: "fr" }), /webLanguage/);
});

test("caption language QA detects clear mismatches without flagging names", () => {
  assert.equal(inspectCaptionLanguage(["Ngày cưới của chúng ta", "Cảm ơn bạn"], "vi").flagged, 0);
  assert.equal(inspectCaptionLanguage(["Our wedding day", "Together with love forever"], "en").flagged, 0);
  assert.equal(inspectCaptionLanguage(["Ngày cưới của chúng ta", "Hạnh phúc bên nhau"], "en").flagged, 1);
  assert.equal(inspectCaptionLanguage(["Our wedding day and our love forever"], "vi").flagged, 1);
  assert.equal(inspectCaptionLanguage(["Những lời chúc từ người thân yêu", "Our wedding day and our love forever"], "vi").flagged, 1);
  assert.equal(inspectCaptionLanguage(["Những lời chúc từ những người thân yêu nhất", "WELCOME TO THE PARTY", "FIRST DANCE"], "vi").flagged, 0);
  assert.equal(inspectCaptionLanguage(["An & Bình"], "en").flagged, 0);
});

test("qaProxy emits caption_language for mismatched viewer text", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "caption-language-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const timeline = path.join(dir, "timeline.json");
  const report = path.join(dir, "report.json");
  fs.writeFileSync(timeline, JSON.stringify({ language: "en", languageEnforced: true, project: { name: "test", width: 1920, height: 1080, fps: 30 },
    output: { path: path.join(dir, "missing.mp4") }, slides: [{ id: "closing", duration: 4, effect: "layer_scene",
      transition: { type: "none", duration: 0 }, captions: [], layers: [{ type: "text", text: "Ngày cưới của chúng ta", x: 300, y: 300, width: 1000, height: 200, size: 50 }] }] }));
  const run = spawnSync(process.execPath, ["scripts/qaProxy.mjs", timeline, "--out", report], { encoding: "utf8" });
  assert.equal(run.status, 0, run.stderr);
  const qa = JSON.parse(fs.readFileSync(report, "utf8"));
  assert.ok(qa.problems.some((problem) => problem.check === "caption_language"));
});
