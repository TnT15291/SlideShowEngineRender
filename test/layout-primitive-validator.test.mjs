import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { minimumTextSize } from "../scripts/lib/rules/thresholds.mjs";
import { validateLayouts } from "../scripts/validateLayoutPrimitive.mjs";

const root = process.cwd();
const script = path.join(root, "scripts", "validateLayoutPrimitive.mjs");
const run = (input) => spawnSync(process.execPath, [script, input], {
  cwd: root,
  encoding: "utf8",
});

const context = {
  canvas: { width: 100, height: 100 },
  // A fraction of each edge now, not a flat pixel count — 10% of this 100x100 fixture is the
  // 10px the gate fixture was written against.
  textSafeMargin: 0.1,
  framePresets: { card: { radius: 8 } },
};
const reportFor = ({ photo, text, panels } = {}) => validateLayouts([{
  id: "gate_fixture",
  kind: "layer_scene",
  background: { type: "cream" },
  photoSlots: [{
    id: "hero", x: 0, y: 0, width: 60, height: 60, frame: "card",
    ...photo,
  }],
  textSlots: [{
    id: "heading", role: "heading", fontRole: "heading",
    x: 65, y: 10, width: 25, height: 20, sizePx: 68,
    ...text,
  }],
  panels: panels ?? [],
}], context);
const hasGate = (report, severity, gate) => report[severity].some(
  (finding) => finding.gate === gate,
);

test("G1-G8 findings use the intended error and warning severities", () => {
  assert.equal(reportFor().verdict, "pass");
  assert.equal(hasGate(reportFor({ photo: { x: -1 } }), "errors", "G1"), true);
  assert.equal(hasGate(reportFor({ photo: { width: 20, height: 20 } }), "errors", "G2"), true);
  assert.equal(hasGate(reportFor({ photo: { width: 55, height: 55 } }), "errors", "G3"), true);
  assert.equal(hasGate(reportFor({ text: { x: 5 } }), "warnings", "G4"), true);

  const typeScale = reportFor({ text: { sizePx: 57 } });
  assert.equal(hasGate(typeScale, "warnings", "G5"), true);
  assert.equal(typeScale.verdict, "pass", "G5 warning made the layout fail");

  assert.equal(hasGate(reportFor({
    text: { x: 30, y: 10, width: 25, height: 20 },
  }), "errors", "G6"), true);
  assert.equal(hasGate(reportFor({
    photo: { x: 40, y: 0, rotation: -45 },
    text: { x: 10, y: 70 },
  }), "errors", "G7"), true);
  assert.equal(hasGate(reportFor({ photo: { frame: "missing" } }), "errors", "G8"), true);
});

test("G5 uses semantic text roles instead of treating every non-body slot as a headline", () => {
  assert.equal(minimumTextSize({ role: "heading", fontRole: "heading" }), 58);
  assert.equal(minimumTextSize({ role: "body", fontRole: "body" }), 32);
  assert.equal(minimumTextSize({ role: "caption", fontRole: "body" }), 26);
  assert.equal(minimumTextSize({ role: "subheading", fontRole: "heading" }), 26);
  assert.equal(minimumTextSize({ role: "names", fontRole: "script_accent" }), 96);
});

test("layout primitive CLI loads the library and a single-layout candidate", () => {
  const library = JSON.parse(fs.readFileSync(path.join(root, "layouts", "library.json"), "utf8"));
  const libraryRun = run("layouts/library.json");
  assert.equal(libraryRun.status, 0, libraryRun.stderr);
  assert.match(libraryRun.stdout, new RegExp(`Loaded ${library.layouts.length} layout\\(s\\)`));

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-primitive-validator-"));
  try {
    const candidatePath = path.join(tempDir, "candidate.json");
    fs.writeFileSync(candidatePath, JSON.stringify({
      id: "candidate_probe",
      kind: "layer_scene",
      background: { type: "cream" },
      photoSlots: [{ id: "hero", x: 0, y: 0, width: 1920, height: 1080 }],
      textSlots: [],
    }));
    const candidateRun = run(candidatePath);
    assert.equal(candidateRun.status, 0, candidateRun.stderr);
    assert.match(candidateRun.stdout, /Loaded 1 layout\(s\)/);
    assert.match(candidateRun.stdout, /candidate_probe/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("layout primitive CLI rejects an unsupported JSON shape", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-primitive-validator-"));
  try {
    const candidatePath = path.join(tempDir, "invalid.json");
    fs.writeFileSync(candidatePath, JSON.stringify({ meta: { canvas: { width: 1920, height: 1080 } } }));
    const result = run(candidatePath);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /must contain a 'layouts' array or one layout object/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("layout primitive CLI exits 1 when a gate reports an error", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "layout-primitive-validator-"));
  try {
    const candidatePath = path.join(tempDir, "outside-canvas.json");
    fs.writeFileSync(candidatePath, JSON.stringify({
      id: "outside_canvas",
      kind: "layer_scene",
      background: { type: "cream" },
      photoSlots: [{ id: "hero", x: -1, y: 0, width: 1920, height: 1080 }],
      textSlots: [],
    }));
    const result = run(candidatePath);
    assert.equal(result.status, 1);
    assert.match(result.stdout, /FAIL outside_canvas/);
    assert.match(result.stdout, /ERROR G1 \[hero\]/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
