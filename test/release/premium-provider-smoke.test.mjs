import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("Premium story options use the real DeepSeek provider", { timeout: 60_000 }, (t) => {
  assert.ok(process.env.DEEPSEEK_API_KEY, "DEEPSEEK_API_KEY must be configured for the Premium provider gate");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "premium-provider-smoke-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const content = path.join(dir, "photo_content.json");
  const output = path.join(dir, "story_options.json");
  fs.writeFileSync(content, JSON.stringify({ photos: [
    { file: "smoke.jpg", tags: ["couple"], emotion: "joy", orient: "landscape", heroScore: 0.9 },
  ] }));

  const run = spawnSync(process.execPath, [
    "scripts/generateStoryOptions.mjs", "--content", content,
    "--brief", "A warm, concise wedding film.", "--out", output,
  ], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, TEXT_CACHE: "off" } });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const result = JSON.parse(fs.readFileSync(output, "utf8"));
  assert.match(result.generatedBy, /^text:deepseek\//);
  assert.equal(result.options.length, 4);
});
