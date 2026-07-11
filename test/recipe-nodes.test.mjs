// Adversarial guardrail tests for the two tier-2 AI nodes.
//
// The claim these nodes make is that a bad model response can only produce clumsy
// wording — never a broken render, never a recipe that does not exist, never a
// file path or a duration. That claim is only worth anything if a hostile response
// is actually fired at them, so this drives both nodes against a mock DeepSeek
// server that returns deliberately malformed JSON.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const node = process.execPath;

/** A mock DeepSeek that returns whatever object the test hands it. */
async function withMock(reply, fn) {
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(url);
  } finally {
    server.close();
  }
}

/** Must be async: the mock server lives in THIS process, so a blocking spawnSync
 *  would deadlock — the child's request could never be served. */
function run(args, baseUrl) {
  return new Promise((resolve) => {
    const child = spawn(node, args, {
      cwd: root,
      env: { ...process.env, DEEPSEEK_API_KEY: "test-key", DEEPSEEK_BASE_URL: baseUrl },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "recipe-nodes-"));

test("pickRecipe refuses a recipe that does not exist", async () => {
  const dir = tmp();
  const out = path.join(dir, "choice.json");
  const prompt = path.join(dir, "prompt.txt");
  fs.writeFileSync(prompt, "Đám cưới ấm áp, mộc mạc, nhiều ảnh gia đình.");

  await withMock(
    { recipeId: "super-luxury-9000", themeId: "neon_cyberpunk", reason: "trust me" },
    async (url) => {
      const r = await run(
        ["scripts/pickRecipe.mjs", "--prompt", prompt, "--photos", "analysis/photos.json", "--out", out],
        url
      );
      assert.equal(r.status, 0, r.stderr);
    }
  );

  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  // A hallucinated id is not a choice. It must fall back to the deterministic rule
  // and SAY that it did, rather than render a recipe that is not on disk.
  assert.ok(doc.consideredIds.includes(doc.recipeId), `picked ${doc.recipeId}, not on the menu`);
  assert.equal(doc.generatedBy, "stub");
  assert.match(doc.reason, /unknown recipe id/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("pickRecipe keeps a real recipe but drops an invented theme", async () => {
  const dir = tmp();
  const out = path.join(dir, "choice.json");
  const prompt = path.join(dir, "prompt.txt");
  fs.writeFileSync(prompt, "Điện ảnh, trầm.");

  await withMock({ recipeId: "warm-film-01", themeId: "not_a_theme", reason: "warm suits them" }, async (url) => {
    const r = await run(
      ["scripts/pickRecipe.mjs", "--prompt", prompt, "--photos", "analysis/photos.json", "--out", out],
      url
    );
    assert.equal(r.status, 0, r.stderr);
  });

  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.equal(doc.recipeId, "warm-film-01");
  // An undefined theme would render with missing colour tokens, so it falls back
  // to the recipe's own theme rather than being passed through.
  assert.equal(doc.themeId, "warm_film");
  assert.notEqual(doc.generatedBy, "stub");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("writeRecipeCopy accepts only declared slots, and only strings", async () => {
  const dir = tmp();
  const out = path.join(dir, "copy.json");
  const prompt = path.join(dir, "prompt.txt");
  fs.writeFileSync(prompt, "Đám cưới ở quê.");

  const recipe = JSON.parse(fs.readFileSync("story-templates/warm-film-01.json", "utf8"));
  const realScene = recipe.scenes.find((s) => s.text && Object.keys(s.text).length);
  const realSlot = Object.keys(realScene.text)[0];

  await withMock(
    {
      scenes: {
        // legitimate: a scene and slot the recipe declares
        [realScene.id]: {
          [realSlot]: "Ngày mình về chung một nhà",
          not_a_slot: "chữ vào một chỗ không tồn tại",
        },
        // invented scene — the layout has nowhere to put this
        s99_fabricated: { heading: "Cảnh tôi tự bịa" },
        // the model trying to hand back geometry / a file / a duration
        [realScene.id + "_x"]: { heading: { value: "x", x: 0, y: 0, font: "evil.ttf" } },
      },
      // fields outside the contract are simply never read
      effect: "mask_reveal",
      output: { path: "/etc/passwd" },
      duration: 999,
    },
    async (url) => {
      const r = await run(
        [
          "scripts/writeRecipeCopy.mjs",
          "--recipe", "story-templates/warm-film-01.json",
          "--prompt", prompt,
          "--out", out,
        ],
        url
      );
      assert.equal(r.status, 0, r.stderr);
    }
  );

  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  const text = JSON.stringify(doc);

  assert.equal(doc.scenes[realScene.id][realSlot], "Ngày mình về chung một nhà");
  assert.equal(doc.rewritten, 1, "only the one real slot should be rewritten");

  // Nothing the recipe does not declare may appear anywhere in the copy map.
  assert.ok(!("s99_fabricated" in doc.scenes), "invented scene leaked through");
  assert.ok(!("not_a_slot" in doc.scenes[realScene.id]), "invented slot leaked through");
  assert.ok(!text.includes("evil.ttf"), "a font path leaked through");
  assert.ok(!text.includes("/etc/passwd"), "a file path leaked through");
  assert.ok(!text.includes("mask_reveal"), "an effect leaked through");

  // Every surviving value is a plain string: no object can carry geometry in.
  for (const slotMap of Object.values(doc.scenes)) {
    for (const value of Object.values(slotMap)) assert.equal(typeof value, "string");
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test("writeRecipeCopy caps a runaway line instead of letting it into the frame", async () => {
  const dir = tmp();
  const out = path.join(dir, "copy.json");
  const recipe = JSON.parse(fs.readFileSync("story-templates/warm-film-01.json", "utf8"));
  const realScene = recipe.scenes.find((s) => s.text && Object.keys(s.text).length);
  const realSlot = Object.keys(realScene.text)[0];

  await withMock({ scenes: { [realScene.id]: { [realSlot]: "quá dài ".repeat(200) } } }, async (url) => {
    const r = await run(
      ["scripts/writeRecipeCopy.mjs", "--recipe", "story-templates/warm-film-01.json", "--out", out, "--max-chars", "60"],
      url
    );
    assert.equal(r.status, 0, r.stderr);
  });

  const doc = JSON.parse(fs.readFileSync(out, "utf8"));
  assert.ok(doc.scenes[realScene.id][realSlot].length <= 60, "line was not capped");
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a limited vision run may not masquerade as the complete set, in any project", () => {
  // The sample guard used to compare against the ROOT photo_content.json only, so
  // a project path with the same filename slipped past it — a 24-photo sample
  // sitting where the pipeline reads 82.
  const r = spawnSync(
    node,
    [
      "scripts/analyzePhotoContent.mjs",
      "--photos", "analysis/photos.json",
      "--limit", "5",
      "--out", "projects/anything/analysis/photo_content.json",
    ],
    { cwd: root, encoding: "utf8" }
  );
  assert.notEqual(r.status, 0, "a partial run was allowed to write the complete-set filename");
  assert.match(r.stderr, /complete set/);
});

test("vision writes its answer beside the photos it judged, not into the root", async () => {
  // `--photos projects/x/analysis/photos.json` with no --out used to write the
  // ROOT analysis/photo_content.json: one job's semantic data landing where every
  // other job reads its own.
  const dir = tmp();
  const analysis = path.join(dir, "analysis");
  fs.mkdirSync(analysis);
  const photos = path.join(analysis, "photos.json");
  fs.writeFileSync(
    photos,
    JSON.stringify({ photos: [{ file: "input/001.jpg", orient: "landscape", w: 100, h: 60, qualityNorm: 0.5 }] })
  );

  const r = await run(["scripts/analyzePhotoContent.mjs", "--photos", photos, "--dry-run"], "http://127.0.0.1:1");
  assert.equal(r.status, 0, r.stderr);
  // The dry run states where it WOULD write. That path must be inside this job.
  const target = r.stdout.match(/would write\s+(.+)/)?.[1]?.trim();
  assert.ok(target, `no "would write" line in output:\n${r.stdout}`);
  assert.ok(
    target.replace(/\\/g, "/").includes(path.basename(dir)),
    `vision would write to "${target}" — outside the job that owns the photos`
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a music-paced tier refuses a project with no music, instead of borrowing a track", () => {
  // applyStoryTemplate/generateStoryClipV2/renderWithRetry each defaulted --music
  // to one specific customer's song. runProject passes `--music ""` when a project
  // has none, and an empty string reads as "flag absent" — so the run silently
  // scored that other customer's track and read the ROOT analysis for it.
  const dir = tmp();
  fs.mkdirSync(path.join(dir, "input"));
  fs.writeFileSync(path.join(dir, "input", "a.jpg"), "x");
  fs.writeFileSync(path.join(dir, "prompt.txt"), "test");
  fs.writeFileSync(
    path.join(dir, "project.json"),
    JSON.stringify({
      version: 1, id: "no-music", name: "No music", promptFile: "prompt.txt",
      inputDir: "input", music: [], analysisDir: "analysis",
      timeline: "timeline/timeline.json", output: "output/final.mp4",
      quality: "draft", tier: "premium",
    })
  );

  const r = spawnSync(node, ["scripts/runProject.mjs", "--project", dir], { cwd: root, encoding: "utf8" });
  assert.notEqual(r.status, 0, "a premium run with no music was allowed to proceed");
  assert.match(r.stderr + r.stdout, /music/i);

  // And the generators themselves refuse rather than reaching for a default.
  const g = spawnSync(node, ["scripts/generateStoryClipV2.mjs", "--music", ""], { cwd: root, encoding: "utf8" });
  assert.notEqual(g.status, 0, "generateStoryClipV2 accepted an empty --music");
  assert.match(g.stderr, /--music is required/);

  fs.rmSync(dir, { recursive: true, force: true });
});
