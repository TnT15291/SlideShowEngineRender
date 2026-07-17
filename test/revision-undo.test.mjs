// Undo is "stop asking for this, then re-derive" — never "apply the inverse". An inverse
// is a fiction here: the operations do not commute (move one duration and every later
// start time shifts), and applyToTimeline's patches are destructive in place.
//
// Two things had to be true before undo could exist at all, and both are load-bearing:
//
//   1. A rebuild must be repeatable, or undo lands the customer somewhere NEW rather than
//      somewhere they had been (lib/textCache.mjs).
//   2. Supersession must be RE-DERIVED, not trusted. appendRound only ever SETS
//      supersededBy, so it is a one-way door, and undo has to walk back through it.
//
// The second one is the trap these tests exist for. See the chain test.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { appendRound, undoRound, active, recomputeSupersession } from "../scripts/lib/directives.mjs";
import { root } from "../scripts/lib/project.mjs";

const node = process.execPath;

const eff = (target, quote) => ({
  quote, kind: "effect", op: "set", scope: { global: true },
  target, strength: "must", confidence: 1,
});

/** r0 floating_card_gallery -> r1 polaroid -> r2 circle_focus, each replacing the last. */
function chain() {
  let ledger = { version: 1, directives: [], unmapped: [] };
  ledger = appendRound(ledger, [eff("floating_card_gallery", "ảnh nổi trên nền kem")], 0);
  ledger = appendRound(ledger, [eff("polaroid", "cả phim dùng polaroid")], 1);
  ledger = appendRound(ledger, [eff("circle_focus", "đổi lại, tiêu điểm tròn")], 2);
  return ledger;
}

test("undoing the newest round puts back what it had replaced", () => {
  const { ledger, undone, restored } = undoRound(chain(), 2, 3);

  assert.deepEqual(undone.map((d) => d.target), ["circle_focus"]);
  // The half nobody expects: withdrawing "circle focus" does not leave the film with no
  // effect, it hands back polaroid — an order from a round everyone has stopped thinking
  // about. A customer who is not told this will call it a bug.
  assert.deepEqual(restored.map((d) => d.target), ["polaroid"], "the order it replaced did not come back");
  assert.deepEqual(active(ledger).map((d) => d.target), ["polaroid"]);
});

test("undoing the MIDDLE of a chain does not resurrect a contradiction", () => {
  // THE TRAP. A naive undo restores "whatever round 1 superseded" — which un-supersedes
  // floating_card_gallery and leaves it in force ALONGSIDE circle_focus: two orders on one
  // key, and whichever applies last wins by accident. Supersession must be re-derived.
  const { ledger, undone, restored } = undoRound(chain(), 1, 3);

  assert.deepEqual(undone.map((d) => d.target), ["polaroid"]);
  assert.deepEqual(restored, [], "undoing an already-overridden round changed what is in force");

  const inForce = active(ledger).map((d) => d.target);
  assert.deepEqual(inForce, ["circle_focus"], `two contradictory orders are both in force: ${JSON.stringify(inForce)}`);

  // floating_card_gallery stays superseded — but now by round 2, the round that actually
  // replaces it, not by the withdrawn round 1.
  const fcg = ledger.directives.find((d) => d.target === "floating_card_gallery");
  assert.equal(fcg.supersededBy, 2);
});

test("a withdrawn order is marked, not deleted — the receipt must still be able to tell the story", () => {
  const { ledger } = undoRound(chain(), 2, 3);
  const gone = ledger.directives.find((d) => d.target === "circle_focus");

  assert.ok(gone, "the withdrawn directive was deleted from the ledger");
  assert.equal(gone.undoneBy, 3);
  assert.equal(gone.quote, "đổi lại, tiêu điểm tròn", "the customer's own words were lost");
});

test("an undo round holds no orders, so it cannot itself be undone", () => {
  const once = undoRound(chain(), 2, 3);
  const twice = undoRound(once.ledger, 3, 4);

  assert.deepEqual(twice.undone, [], "undo went backwards through an undo — there is no redo by design");
  assert.deepEqual(active(twice.ledger).map((d) => d.target), ["polaroid"], "a no-op undo moved the film");
});

test("re-derived supersession reproduces appendRound exactly when nothing is undone", () => {
  // If these two rules ever disagree, an undo silently re-writes history that was not
  // undone. They are the same rule; this pins that they stay the same rule.
  const built = chain();
  const derived = recomputeSupersession(built.directives);

  assert.deepEqual(
    derived.map((d) => [d.target, d.supersededBy ?? null]),
    built.directives.map((d) => [d.target, d.supersededBy ?? null])
  );
});

// --- end to end -----------------------------------------------------------------------
function project(name) {
  const dir = fs.mkdtempSync(path.join(root, `tmp-${name}-`));
  fs.mkdirSync(path.join(dir, "input"));
  fs.mkdirSync(path.join(dir, "music"));
  fs.mkdirSync(path.join(dir, "analysis"));
  fs.mkdirSync(path.join(dir, "timeline"));
  fs.writeFileSync(path.join(dir, "prompt.txt"), "A story\n");
  fs.writeFileSync(path.join(dir, "music", "track.mp3"), "fixture");
  // A finished timeline, because that is what a revision revises. Its captions are the
  // customer's words, and they are the thing at stake in the floor test below.
  fs.writeFileSync(path.join(dir, "timeline", "timeline.json"), JSON.stringify({
    slides: [
      { image: "a.jpg", effect: "slow_zoom_in", duration: 5, captions: [{ text: "Mãi mãi bên nhau", role: "caption" }] },
      { image: "b.jpg", effect: "slow_zoom_in", duration: 5, captions: [{ text: "Quốc & Nhi", role: "caption" }] },
    ],
  }, null, 2));
  fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({
    version: 1, id: name, name,
    promptFile: "prompt.txt", inputDir: "input", music: ["music/track.mp3"],
    analysisDir: "analysis", timeline: "timeline/timeline.json",
    output: "output/final.mp4", quality: "share",
  }));
  return { dir, rel: path.relative(root, dir).replace(/\\/g, "/") };
}

function revise(rel, args) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.DEEPSEEK_API_KEY; // the rules compile it: deterministic, no network
    const c = spawn(node, ["scripts/reviseProject.mjs", "--project", rel, ...args], { cwd: root, env });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (status) => resolve({ status, out }));
  });
}

test("an undo NEVER takes the timeline patch path, however narrow it looks", async () => {
  const { dir, rel } = project("undo-floor");
  const timeline = () => JSON.parse(fs.readFileSync(path.join(dir, "timeline", "timeline.json"), "utf8"));
  try {
    // A caption forbid is a `timeline` radius change: patch the finished timeline, re-render.
    const applied = await revise(rel, ["--request", "Đừng để chữ trên ảnh nữa"]);
    assert.equal(applied.status, 0, applied.out);
    assert.match(applied.out, /blast radius = timeline/, "precondition: this must be a timeline-radius change");

    // The patch is DESTRUCTIVE IN PLACE. This is the fact the floor exists for.
    assert.deepEqual(timeline().slides.map((s) => s.captions), [[], []], "precondition: the words are gone from the timeline");

    // So undoing it cannot be a timeline patch: dropping the directive does not put the
    // words back, because the artefact no longer holds them — only the storyboard does.
    // Routing an undo through `render` would re-render the stripped timeline and report
    // success while the customer's text stayed deleted.
    const undone = await revise(rel, ["--undo", "1"]);
    assert.equal(undone.status, 0, undone.out);
    assert.match(undone.out, /blast radius = build/, "an undo was routed through the irreversible patch path");
    assert.match(undone.out, /re-entering at: build/);
    assert.doesNotMatch(undone.out, /re-entering at: render/);

    // And it must not have "helpfully" patched the timeline on the way past: the words come
    // back from a rebuild, not from this node.
    assert.deepEqual(timeline().slides.map((s) => s.captions), [[], []]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("--undo --preview writes nothing", async () => {
  const { dir, rel } = project("undo-preview");
  try {
    await revise(rel, ["--request", "Cho cả phim dùng polaroid"]);
    const ledgerPath = path.join(dir, "directives.json");
    const before = fs.readFileSync(ledgerPath, "utf8");

    const r = await revise(rel, ["--undo", "1", "--preview"]);
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /UNDO round 1/);
    assert.match(r.out, /PREVIEW — nothing was written/);

    assert.equal(fs.readFileSync(ledgerPath, "utf8"), before, "--preview mutated the ledger it was previewing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an undo is not charged to the revision budget", async () => {
  const { dir, rel } = project("undo-budget");
  try {
    await revise(rel, ["--request", "Cho cả phim dùng polaroid"]);
    await revise(rel, ["--request", "Đổi lại, cả phim tiêu điểm tròn"]);

    // Round 3 would exceed --max-rounds 2 for a REQUEST...
    const blocked = await revise(rel, ["--request", "Cho phim hoài niệm", "--max-rounds", "2"]);
    assert.equal(blocked.status, 5, "precondition: the budget must bite here");

    // ...but "you have used all your revisions, so you must keep the montage that ate your
    // vows" is not a deal anyone would sign. The cap exists so a job ships, not to trap a
    // customer inside a change they regret. Applies still consume rounds, so it still binds.
    const undone = await revise(rel, ["--undo", "2", "--max-rounds", "2"]);
    assert.equal(undone.status, 0, undone.out);
    assert.match(undone.out, /UNDO round 2/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
