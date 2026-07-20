import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();

function run(photos, keep, brief) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cull-"));
  const photosPath = path.join(dir, "photos.json");
  const outPath = path.join(dir, "cull.json");
  fs.writeFileSync(photosPath, JSON.stringify({ photos }));
  const args = ["scripts/suggestCull.mjs", "--photos", photosPath, "--keep", String(keep), "--out", outPath];
  if (brief) { const bp = path.join(dir, "brief.json"); fs.writeFileSync(bp, JSON.stringify(brief)); args.push("--brief", bp); }
  const r = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  const out = fs.existsSync(outPath) ? JSON.parse(fs.readFileSync(outPath, "utf8")) : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return { status: r.status, out, stderr: r.stderr };
}

// A pool with: a duplicate pair (rep + sibling), a low-quality photo, strong bookends.
const pool = () => [
  { file: "input/open.jpg", qualityNorm: 0.8, openingScore: 0.99, closingScore: 0.1 },
  { file: "input/close.jpg", qualityNorm: 0.8, openingScore: 0.1, closingScore: 0.99 },
  { file: "input/dup_rep.jpg", qualityNorm: 0.7, duplicateGroup: "dup-1", duplicateRepresentative: true, duplicateDistance: 0 },
  { file: "input/dup_sib.jpg", qualityNorm: 0.7, duplicateGroup: "dup-1", duplicateRepresentative: false, duplicateDistance: 3 },
  { file: "input/weak.jpg", qualityNorm: 0.2 },
  { file: "input/mid.jpg", qualityNorm: 0.6 },
];

test("the cull drops the duplicate sibling before anything else, with a reason naming its twin", () => {
  const { out } = run(pool(), 5); // drop 1 of 6
  assert.equal(out.drop.length, 1);
  assert.equal(out.drop[0].file, "input/dup_sib.jpg");
  assert.match(out.drop[0].reason, /trùng với dup_rep\.jpg/);
});

test("a duplicate group keeps its representative even when culling deeper", () => {
  const { out } = run(pool(), 3); // drop 3 of 6
  const dropped = new Set(out.drop.map((d) => d.file));
  assert.ok(dropped.has("input/dup_sib.jpg"), "the sibling goes");
  assert.ok(!dropped.has("input/dup_rep.jpg"), "the representative stays — the moment survives");
  assert.ok(dropped.has("input/weak.jpg"), "the low-quality singleton goes");
});

test("bookends and must-use photos are locked, never dropped", () => {
  const { out } = run(pool(), 2, { mustUsePhotos: ["input/mid.jpg"] }); // aggressive: keep 2
  const dropped = new Set(out.drop.map((d) => d.file));
  const lockedFiles = new Set(out.locked.map((l) => l.file));
  for (const f of ["input/open.jpg", "input/close.jpg", "input/mid.jpg"]) {
    assert.ok(!dropped.has(f), `${f} must not be dropped`);
    assert.ok(lockedFiles.has(f), `${f} must be listed as locked`);
  }
});

test("when only locked photos remain, the cull stops short and says so instead of dropping them", () => {
  // 4 of 6 are locked (2 bookends + must-use + dup rep); asking to keep 1 cannot be honoured.
  const { out } = run(pool(), 1, { mustUsePhotos: ["input/mid.jpg"] });
  assert.ok(out.shortfall >= 1, "a shortfall is reported");
  assert.ok(out.locked.length >= out.keep, "it keeps the locked photos rather than dropping them to hit the number");
});

test("every dropped photo carries a human-readable reason", () => {
  const { out } = run(pool(), 4);
  for (const d of out.drop) assert.ok(d.reason && d.reason.length > 3, `drop of ${d.file} has no reason`);
});
