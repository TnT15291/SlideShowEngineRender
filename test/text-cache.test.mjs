// The text nodes are memoised for CORRECTNESS, not for the pennies.
//
// The revision loop rests on one claim: the film is a deterministic function of
// (photos, music, recipe, directive ledger). That is what lets undo be "drop a
// directive and re-derive" instead of "apply the inverse operation" — which could
// never work here, because these operations do not commute (move one duration and
// every later start time shifts; qaLoop already carries an anti-oscillation rule for
// exactly this).
//
// Re-deriving only means something if it is repeatable. Every text node runs at
// temperature > 0, so the same ledger answered differently on every pass: a customer
// undoes a colour change and finds their captions silently rewritten. So the mock
// here answers DIFFERENTLY every single time — the way a real model does. If the
// cache works, the customer never sees that; if it does not, these tests see it.
import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --- a mock DeepSeek that never gives the same answer twice -----------------
let requests = 0;
let status = 200;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    requests++;
    if (status !== 200) {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "mock failure" }));
      return;
    }
    // A different caption every call — the coin flip this module exists to pin down.
    const content = JSON.stringify({ caption: `take-${requests}` });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ choices: [{ message: { content } }] }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));

// The client reads its config at import time, so the env must be set BEFORE it loads.
process.env.DEEPSEEK_API_KEY = "test-key";
process.env.DEEPSEEK_BASE_URL = `http://127.0.0.1:${server.address().port}`;
const { callDeepSeekJSON } = await import("../scripts/lib/deepseek.mjs");

const dirs = [];
function jobDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "text-cache-"));
  dirs.push(d);
  return d;
}
const ask = (over = {}) =>
  callDeepSeekJSON({ system: "vocabulary: a, b, c", user: "write a caption", label: "test", ...over });

test.after(() => {
  server.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

test("the same question, re-derived, gives the SAME answer — not a fresh coin flip", async () => {
  process.env.TEXT_CACHE_DIR = jobDir();
  requests = 0;

  const first = await ask();
  const second = await ask();

  assert.equal(requests, 1, "the second re-derivation asked the model again");
  assert.deepEqual(second, first, "the same ledger produced a different film — undo would not land where the customer left");
  assert.equal(first.caption, "take-1");
});

test("without the cache the answer drifts — which is the bug, and it is real", async () => {
  delete process.env.TEXT_CACHE_DIR; // no dir = no caching = today's behaviour
  requests = 0;

  const first = await ask();
  const second = await ask();

  assert.equal(requests, 2);
  assert.notDeepEqual(second, first, "the mock is supposed to drift; if it does not, the other tests prove nothing");
});

test("a changed input invalidates itself — no version counter to forget", async () => {
  process.env.TEXT_CACHE_DIR = jobDir();
  requests = 0;

  await ask();
  await ask({ user: "write a DIFFERENT caption" }); // the story/recipe/photo set changed
  await ask({ system: "vocabulary: a, b, c, d" }); // the engine vocabulary grew
  await ask({ temperature: 0.9 });

  assert.equal(requests, 4, "a changed request was served a stale answer");

  // ...and each of those is now itself remembered.
  await ask({ user: "write a DIFFERENT caption" });
  assert.equal(requests, 4);
});

test("one job never answers another job's prompt", async () => {
  const a = jobDir();
  const b = jobDir();
  requests = 0;

  process.env.TEXT_CACHE_DIR = a;
  const inA = await ask();

  process.env.TEXT_CACHE_DIR = b;
  const inB = await ask();

  assert.equal(requests, 2, "job B was served job A's answer — the root-state bug, again");
  assert.notDeepEqual(inB, inA);
  assert.ok(fs.existsSync(path.join(a, "text_cache.json")));
  assert.ok(fs.existsSync(path.join(b, "text_cache.json")));
});

test("a failure is never remembered — an outage must not become permanent", async () => {
  const dir = jobDir();
  process.env.TEXT_CACHE_DIR = dir;
  requests = 0;

  status = 500;
  await assert.rejects(() => ask(), /DeepSeek HTTP 500/);
  status = 200;

  const cache = path.join(dir, "text_cache.json");
  const entries = fs.existsSync(cache) ? Object.keys(JSON.parse(fs.readFileSync(cache, "utf8")).entries) : [];
  assert.equal(entries.length, 0, "a failed call was cached; the outage is now baked into the project");

  const after = await ask();
  assert.ok(after.caption, "the node could not recover once the provider came back");
});

test("a corrupt cache degrades to asking, never to crashing", async () => {
  const dir = jobDir();
  process.env.TEXT_CACHE_DIR = dir;
  requests = 0;

  fs.writeFileSync(path.join(dir, "text_cache.json"), "{ this is not json");
  const answer = await ask();

  assert.equal(requests, 1);
  assert.ok(answer.caption, "a corrupt cache file took the run down with it");
});
