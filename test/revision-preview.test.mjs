// A revision preview has exactly one job: tell the customer what they are about to lose,
// BEFORE they lose it.
//
// reviseProject already printed the compiled directives, which looks like a preview and
// is not one — it restates the REQUEST, never the CONSEQUENCE. The consequence is brutal
// and was entirely silent: applyToStoryboard deletes a retargeted scene's layout and text,
// and a montage splices its neighbours out of existence. One sentence — "dùng lật trang
// phim" — and the dedication the customer wrote is gone from a film they have not seen yet.
//
// So these tests are written against the LOSSES, not against the diff's shape.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { previewChange, diffStoryboard, formatDiff, photoDemandFrom } from "../scripts/lib/revisionDiff.mjs";
import { recallNet } from "../scripts/lib/briefRules.mjs";
import { root } from "../scripts/lib/project.mjs";

const node = process.execPath;

/** A recipe shaped like the real ones: a title card, designed text cards, plain photos. */
const recipe = () => ({
  id: "test-recipe",
  timelineRules: { transitionStrategy: { default: { type: "dissolve", duration: 0.8 } } },
  scenes: [
    { id: "s01_title", effect: "layer_scene", layout: "hero_title_card", text: { title: "Quốc & Nhi" }, durationSec: 5 },
    { id: "s02_bride", effect: "layer_scene", layout: "text_left_photo_right", text: { label: "CÔ DÂU", name: "{{bride}}" }, durationSec: 5 },
    { id: "s03_vow", effect: "layer_scene", layout: "quote_card", text: { quote: "Mãi mãi bên nhau" }, durationSec: 5 },
    { id: "s04_photo", effect: "slow_zoom_in", photoSlots: [{ slot: "hero", count: 1 }], durationSec: 5 },
    { id: "s05_closing", effect: "layer_scene", layout: "closing_card", text: { thanks: "Cảm ơn" }, durationSec: 5 },
  ],
});

const library = {
  layouts: [
    { id: "hero_title_card", photoSlots: [{ id: "bg" }] },
    { id: "text_left_photo_right", photoSlots: [{ id: "right" }] },
    { id: "quote_card", photoSlots: [{ id: "bg" }] },
    { id: "closing_card", photoSlots: [{ id: "bg" }] },
  ],
};

const directive = (over) => ({
  id: "d1", round: 1, source: "test", quote: "test", kind: "effect", op: "set",
  scope: { global: true }, target: "polaroid", strength: "must", confidence: 1, ...over,
});

const preview = (after, before = []) =>
  previewChange({
    storyboard: recipe(),
    before,
    after,
    availablePhotos: 20,
    photoDemand: photoDemandFrom(library),
  });

test("a retarget reports the layout AND the words it deletes — quoted, not counted", () => {
  const diff = preview([directive({ target: "polaroid" })]);

  const bride = diff.changed.find((c) => c.id === "s02_bride");
  assert.ok(bride, "the sweep hit s02_bride but the preview did not mention it");
  assert.deepEqual(bride.effect, { from: "layer_scene", to: "polaroid" });
  assert.equal(bride.lostLayout, "text_left_photo_right");
  assert.deepEqual(bride.lostText, ["CÔ DÂU", "{{bride}}"], "the customer's words vanished without being named");

  const vow = diff.changed.find((c) => c.id === "s03_vow");
  assert.deepEqual(vow.lostText, ["Mãi mãi bên nhau"]);

  assert.equal(diff.destructive, true);
  // "3 scenes changed" is a statistic. The dedication is the actual loss, so it must be
  // readable in the text a human is shown, not merely present in the object.
  assert.match(formatDiff(diff).join("\n"), /LOSES THE WORDS: "Mãi mãi bên nhau"/);
});

test("the title and closing cards are never swept — and the preview says so by omission", () => {
  const diff = preview([directive({ target: "polaroid" })]);
  const touched = [...diff.changed.map((c) => c.id), ...diff.removed.map((r) => r.id)];

  assert.ok(!touched.includes("s01_title"), "the couple's names were swept off the title card");
  assert.ok(!touched.includes("s05_closing"), "the closing card was swept");
});

test("a montage reports the scenes it EATS, not just the one it becomes", () => {
  const diff = preview([directive({ target: "film_roll_up" })]);

  const gone = diff.removed.map((r) => r.id);
  assert.ok(gone.length > 0, "a montage absorbed its neighbours and the preview stayed quiet");

  // The absorbed scenes carried words. Losing a scene is survivable; losing the vow
  // without being told is the thing that ends trust.
  const words = diff.removed.flatMap((r) => r.text);
  assert.ok(words.includes("Mãi mãi bên nhau"), `the vow was eaten silently (removed: ${JSON.stringify(gone)})`);
  assert.equal(diff.destructive, true);
  assert.match(formatDiff(diff).join("\n"), /REMOVED — absorbed into the montage/);
});

test("a transition change is visible and is NOT destructive — the warning must stay rare", () => {
  const diff = preview([directive({ kind: "transition", target: "crossfade" })]);

  assert.deepEqual(diff.transition.default, { from: "dissolve", to: "crossfade" });
  assert.equal(diff.destructive, false, "crying wolf on a harmless change teaches people to skip the warning");
  assert.equal(diff.any, true);
});

test("the diff is against what is ALREADY in force, not against the original recipe", () => {
  const already = [directive({ id: "r1.1", target: "polaroid" })];
  // Round 2 changes its mind. The layout and words were already gone in round 1, so this
  // round did not destroy them — reporting them again would be billing the customer twice
  // for the same loss.
  const diff = preview([...already, directive({ id: "r2.1", target: "circle_focus" })], already);

  const bride = diff.changed.find((c) => c.id === "s02_bride");
  assert.deepEqual(bride.effect, { from: "polaroid", to: "circle_focus" });
  assert.deepEqual(bride.lostText, [], "words already lost in an earlier round were re-reported as a new loss");
  assert.equal(diff.destructive, false);
});

test("a request that changes nothing is reported as changing nothing", () => {
  const same = diffStoryboard(recipe(), recipe());
  assert.equal(same.any, false);
  assert.deepEqual(formatDiff(same), []);
});

// --- the recall net -------------------------------------------------------------------
// reviseProject computed its rule hits and then dropped them whenever a key was present,
// so the node where most of the customer's direction arrives had no net under the model.
// Caught live: "Dùng hiệu ứng lật trang phim" compiled to transition=smooth_left while the
// rule for lật trang -> film_roll_up sat right there, evaluated and unused.
test("a rule hit the model walked past is merged back in", () => {
  const modelSaid = [directive({ kind: "transition", target: "smooth_left", scope: { global: true } })];
  const missed = recallNet("Dùng hiệu ứng lật trang phim cho cả phim", modelSaid, "revision-rule");

  assert.equal(missed.length, 1, "the customer asked for a page-flip effect and it vanished");
  assert.equal(missed[0].kind, "effect");
  assert.equal(missed[0].target, "film_roll_up");
  assert.equal(missed[0].source, "revision-rule", "a rule-recovered order must be traceable to the rule");
});

test("the net does not overrule a judgement the model actually made", () => {
  // The model DID notice the customer was talking about colour and picked a different
  // curve. It read the whole sentence; a regex read one clause. Its answer stands.
  const modelSaid = [directive({ kind: "color", target: "lighter", scope: { global: true } })];
  const missed = recallNet("Cho phim hoài niệm một chút", modelSaid, "revision-rule");

  assert.equal(missed.filter((d) => d.kind === "color").length, 0, "the net second-guessed a judgement call");
});

// --- the safety property --------------------------------------------------------------
test("--preview writes nothing at all", async () => {
  const dir = fs.mkdtempSync(path.join(root, "tmp-preview-test-"));
  const rel = path.relative(root, dir);
  try {
    fs.mkdirSync(path.join(dir, "input"));
    fs.mkdirSync(path.join(dir, "music"));
    fs.mkdirSync(path.join(dir, "analysis"));
    fs.writeFileSync(path.join(dir, "prompt.txt"), "A story\n");
    fs.writeFileSync(path.join(dir, "music", "track.mp3"), "fixture");
    fs.writeFileSync(path.join(dir, "recipe.json"), JSON.stringify(recipe()));
    fs.writeFileSync(path.join(dir, "project.json"), JSON.stringify({
      version: 1, id: "preview-test", name: "Preview test",
      promptFile: "prompt.txt", inputDir: "input", music: ["music/track.mp3"],
      analysisDir: "analysis", timeline: "timeline/timeline.json",
      output: "output/final.mp4", quality: "share",
      recipe: `${rel.replace(/\\/g, "/")}/recipe.json`,
    }));

    const before = fs.readdirSync(dir).sort();
    const r = await new Promise((resolve) => {
      // No key: the rules compile the request, so this test never touches the network.
      const env = { ...process.env };
      delete env.DEEPSEEK_API_KEY;
      const c = spawn(node, [
        "scripts/reviseProject.mjs", "--project", rel,
        "--request", "Cho cả phim dùng polaroid", "--preview",
      ], { cwd: root, env });
      let out = "";
      c.stdout.on("data", (d) => (out += d));
      c.stderr.on("data", (d) => (out += d));
      c.on("close", (status) => resolve({ status, out }));
    });

    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /PREVIEW — nothing was written/);
    assert.match(r.out, /LOSES THE WORDS/, "the preview ran but named no loss");
    assert.match(r.out, /THIS DESTROYS WORK/);

    assert.deepEqual(fs.readdirSync(dir).sort(), before, "--preview created a file");
    assert.ok(!fs.existsSync(path.join(dir, "directives.json")), "--preview wrote the ledger it was previewing");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
