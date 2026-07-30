import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { chunkXfadeInputs, externalizeFilterComplex } from "./renderFinal";

test("large xfade graphs are written to a script instead of the Windows command line", (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), "xfade-script-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const script = path.join(temp, "xfade-filter.txt");
  const graph = Array.from({ length: 222 }, (_, index) =>
    `[v${index}][${index + 1}]xfade=transition=fade:duration=1:offset=${index + 1}[v${index + 1}]`
  ).join(";");
  const args = ["-y", "-i", "one.mp4", "-filter_complex", graph, "-map", "[vout]", "out.mp4"];

  const result = externalizeFilterComplex(args, script);

  assert.equal(result.includes("-filter_complex"), false);
  assert.equal(result[result.indexOf("-filter_complex_script") + 1], script);
  assert.equal(readFileSync(script, "utf8"), graph);
  assert.ok(result.join(" ").length < args.join(" ").length / 10);
});

test("large xfade jobs are split into decoder-safe batches", () => {
  const inputs = Array.from({ length: 223 }, (_, index) => index);

  const batches = chunkXfadeInputs(inputs);

  assert.equal(batches.length, 14);
  assert.deepEqual(batches.map((batch) => batch.length), [
    16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 16, 15,
  ]);
  assert.deepEqual(batches.flat(), inputs);
});

test("xfade batches reject unsafe input limits", () => {
  assert.throws(() => chunkXfadeInputs([1, 2], 1), /at least 2/);
});
