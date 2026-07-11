// The vision node is the only one whose cost scales with the photo set, and it is
// deterministic: the same image, judged by the same model with the same prompt and
// the same vocabulary, gives the same answer. Asking twice is money set on fire.
//
// It happened. One 23-photo project was analysed seven times in a single session —
// 14 requests where 2 would have done — because every `runProject` run re-ran the
// analyze phase and nothing remembered the answer.
//
// The provider cannot help: the API is stateless and will re-bill a photo it saw a
// minute ago. So recognition has to happen here, before the request exists.
//
// The subtle half is what the key must contain. When the tag vocabulary grew from
// 22 words to 29, the same photo's answer changed completely. A cache keyed on the
// image ALONE would have served the old, poorer answer and silently undone the fix
// — the worst class of bug in this codebase. The key is the photo AS JUDGED BY a
// model, a prompt and a vocabulary.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const node = process.execPath;

/** A mock vision provider that counts how many photos it was actually asked about. */
async function withVision(fn) {
  const seen = { requests: 0, photos: 0 };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.requests++;
      const sent = JSON.parse(body);
      // Recover the photo indices the node put in the prompt ("Photo 3:").
      const text = JSON.stringify(sent);
      const indices = [...text.matchAll(/Photo (\d+):/g)].map((m) => Number(m[1]));
      seen.photos += indices.length;
      const results = indices.map((index) => ({
        index,
        tags: ["couple", "selfie"],
        emotion: "playful",
        heroScore: 0.5,
        emotionScore: 0.5,
        storyImportance: 0.5,
      }));
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ results }) } }] }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    return await fn(url, seen);
  } finally {
    server.close();
  }
}

function analyze(dir, url, extra = []) {
  return new Promise((resolve) => {
    const child = spawn(
      node,
      ["scripts/analyzePhotoContent.mjs", "--photos", path.join(dir, "analysis", "photos.json"), ...extra],
      {
        cwd: root,
        env: {
          ...process.env,
          VISION_API_KEY: "test-key",
          OPENAI_API_KEY: "test-key",
          VISION_BASE_URL: url,
          VISION_MODEL: "gpt-4o", // a non-reasoning id keeps the request body simple
        },
      }
    );
    let out = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (out += c));
    child.on("close", (status) => resolve({ status, out }));
  });
}

/** A project directory with `n` distinct real photos taken from the repo's input set. */
function project(n) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vision-cache-"));
  fs.mkdirSync(path.join(dir, "analysis"), { recursive: true });
  fs.mkdirSync(path.join(dir, "input"), { recursive: true });

  const sources = fs.readdirSync("input").filter((f) => /\.jpe?g$/i.test(f)).slice(0, n);
  const photos = sources.map((f, i) => {
    fs.copyFileSync(path.join("input", f), path.join(dir, "input", f));
    return {
      file: path.relative(root, path.join(dir, "input", f)).replace(/\\/g, "/"),
      orient: "landscape",
      w: 100, h: 60, qualityNorm: 0.5,
    };
  });
  fs.writeFileSync(path.join(dir, "analysis", "photos.json"), JSON.stringify({ photos }));
  return { dir, cache: path.join(dir, "analysis", "photo_content.cache.json") };
}

test("a photo already judged is never sent again", async () => {
  const { dir, cache } = project(3);

  await withVision(async (url, seen) => {
    const first = await analyze(dir, url);
    assert.equal(first.status, 0, first.out);
    assert.equal(seen.photos, 3, "the first run must judge all three");
    assert.ok(fs.existsSync(cache), "nothing was remembered");

    const second = await analyze(dir, url);
    assert.equal(second.status, 0, second.out);
    assert.equal(seen.photos, 3, "the second run re-billed photos it had already judged");
    assert.match(second.out, /cache: 3 already judged/);
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

test("changing the vocabulary invalidates every entry — the old answer is not reused", async () => {
  const { dir, cache } = project(2);

  await withVision(async (url, seen) => {
    await analyze(dir, url);
    assert.equal(seen.photos, 2);

    // Simulate the vocabulary (or the model, or the prompt) changing under the
    // cache. This is not a stale entry to refresh — it is a different question.
    const doc = JSON.parse(fs.readFileSync(cache, "utf8"));
    doc.fingerprint = "a-different-question";
    fs.writeFileSync(cache, JSON.stringify(doc));

    const after = await analyze(dir, url);
    assert.equal(after.status, 0, after.out);
    assert.equal(seen.photos, 4, "a changed vocabulary must force a re-judge, not serve the old answer");
    assert.match(after.out, /cache invalidated/);
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

test("identity is the file's bytes, not its name", async () => {
  const { dir } = project(2);
  const photos = JSON.parse(fs.readFileSync(path.join(dir, "analysis", "photos.json"), "utf8")).photos;

  // A photograph the cache has never seen, to put behind an already-cached name.
  const unseen = fs.readdirSync("input").filter((f) => /\.jpe?g$/i.test(f))[5];

  await withVision(async (url, seen) => {
    await analyze(dir, url);
    assert.equal(seen.photos, 2);

    const same = await analyze(dir, url);
    assert.equal(seen.photos, 2, "identical bytes must hit the cache");
    assert.match(same.out, /cache: 2 already judged/);

    // Same filename, DIFFERENT photograph — a re-export, a swap, another customer's
    // 002.jpg. Serving the cached answer here would hang one photo's tags on
    // another's pixels, which is exactly what a filename key invites.
    fs.copyFileSync(path.join("input", unseen), path.resolve(root, photos[0].file));

    const after = await analyze(dir, url);
    assert.equal(after.status, 0, after.out);
    assert.equal(seen.photos, 3, "a changed photo behind an unchanged name was served from cache");
    assert.match(after.out, /cache: 1 already judged.*1 to send/);
  });

  fs.rmSync(dir, { recursive: true, force: true });
});

test("--dry-run costs what it says: cached photos are not counted as requests", async () => {
  const { dir } = project(3);

  await withVision(async (url, seen) => {
    await analyze(dir, url);
    const before = seen.requests;

    const dry = await analyze(dir, url, ["--dry-run"]);
    assert.equal(dry.status, 0, dry.out);
    assert.equal(seen.requests, before, "a dry run sent a request");
    assert.match(dry.out, /requests\s+0/, "the dry run still quoted a cost for photos it already knows");
    assert.match(dry.out, /not sent, not billed/);
  });

  fs.rmSync(dir, { recursive: true, force: true });
});
