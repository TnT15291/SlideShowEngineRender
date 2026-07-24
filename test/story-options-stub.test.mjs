// Node 3's no-key STUB used to return the same four house archetypes in the same
// fixed order every time — options[0] ("Luxury Wedding Film") was recommended for
// every couple regardless of what was actually in their photos. Each archetype
// already carries a `fitReason` describing which photo profile it suits; the fix
// makes that reason computable and ranks by it, so a no-key run is still grounded
// in this job's photos rather than a house default. See scripts/generateStoryOptions.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function runStub(photos) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "story-options-stub-"));
  try {
    const content = path.join(dir, "photo_content.json");
    const out = path.join(dir, "story_options.json");
    fs.writeFileSync(content, JSON.stringify({ photos }));
    const run = spawnSync(process.execPath, [
      "scripts/generateStoryOptions.mjs", "--content", content, "--out", out,
    ], { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, DEEPSEEK_API_KEY: "" } });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    return JSON.parse(fs.readFileSync(out, "utf8"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const repeat = (tags, orient, n, heroScore = 0.3) =>
  Array.from({ length: n }, (_, i) => ({ file: `f${i}_${tags.join("-")}.jpg`, tags, orient, heroScore }));

test("a hero-heavy set recommends Luxury Wedding Film, not the house default", () => {
  const photos = repeat(["portrait"], "landscape", 10, 0.9);
  const result = runStub(photos);
  assert.equal(result.options.find((o) => o.id === result.recommended).title, "Luxury Wedding Film");
});

test("a group/candid-heavy set recommends Family & Friends", () => {
  const photos = [...repeat(["group"], "landscape", 8), ...repeat(["candid"], "landscape", 8), ...repeat(["family"], "landscape", 4)];
  const result = runStub(photos);
  assert.equal(result.options.find((o) => o.id === result.recommended).title, "Family & Friends");
});

test("a set spanning getting-ready through party recommends A Day To Remember", () => {
  const photos = [
    ...repeat(["getting_ready"], "landscape", 3), ...repeat(["ceremony"], "landscape", 3),
    ...repeat(["reception"], "landscape", 3), ...repeat(["party"], "landscape", 3),
  ];
  const result = runStub(photos);
  assert.equal(result.options.find((o) => o.id === result.recommended).title, "A Day To Remember");
});

test("a portrait-couple, portrait-orientation set recommends Korean Romance", () => {
  const photos = repeat(["portrait", "couple"], "portrait", 12);
  const result = runStub(photos);
  assert.equal(result.options.find((o) => o.id === result.recommended).title, "Korean Romance");
});

test("all four archetypes are always present regardless of ranking", () => {
  const result = runStub(repeat(["portrait", "couple"], "portrait", 12));
  const titles = result.options.map((o) => o.title).sort();
  assert.deepEqual(titles, ["A Day To Remember", "Family & Friends", "Korean Romance", "Luxury Wedding Film"].sort());
});

test("a flat/empty profile falls back to the original house order, not an error", () => {
  const result = runStub([{ file: "f0.jpg", tags: [], orient: "landscape", heroScore: 0 }]);
  assert.equal(result.options.find((o) => o.id === result.recommended).title, "Luxury Wedding Film");
});
