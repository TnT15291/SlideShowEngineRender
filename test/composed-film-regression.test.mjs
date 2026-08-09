// A RATCHET ON THE FILMS THE COMPOSER MAKES.
//
// Everything else in this repo tests a function. This tests the PRODUCT: three synthetic
// jobs across the range the composer actually has to cover — a photo-poor album on a short
// track, an ordinary one, and a rich album on a long track — composed end to end, put
// through the gate, and scored. The recorded numbers are floors, not snapshots: making a
// film richer is always allowed, making it thinner has to be a decision somebody typed.
//
// Why floors rather than exact equality. The composer is pacing arithmetic against a song;
// a change to the energy curve moves every scene count by one and would fail two dozen
// exact assertions for no defect at all. What must never happen quietly is a film coming
// out with fewer effects, fewer transitions, fewer compositions or more repetition than the
// one before it — which is exactly what happened when the old composer shipped a film with
// one effect and three layouts and nothing noticed for months.
//
// Subprocess, like test/lite-tier.test.mjs, because composeStoryboard is an executable that
// reads a job directory. No pixels: the composer reads photo RECORDS and a music analysis,
// so a fixture is two JSON files.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { evaluateComposedFilm } from "../scripts/lib/rules/composedFilm.mjs";
import { scoreFilm } from "../scripts/lib/filmScorecard.mjs";

const root = process.cwd();
const node = process.execPath;
const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));

/** Photo records as analyzePhotos writes them. The composer reads `file` and
 *  `duplicateGroup` and nothing else — the pixels matter to applyStoryTemplate, not here. */
const photos = (count) => ({
  count,
  photos: Array.from({ length: count }, (_, i) => ({
    file: `input/IMG_${String(i + 1).padStart(4, "0")}.jpg`,
    width: i % 3 === 0 ? 1365 : 2048,
    height: i % 3 === 0 ? 2048 : 1365,
    sharpness: 40 + (i % 7) * 8,
  })),
});

/** A track with a real phrase grid and an energy shape, so pacing has something to answer
 *  to. Flat music would produce flat scenes and flatter the fixture. */
const music = (duration, sectionCount = Math.max(2, Math.round(duration / 45))) => ({
  analysisVersion: 2,
  duration,
  bpmEstimate: 96,
  beatGrid: { beatSeconds: 0.625 },
  sections: Array.from({ length: sectionCount }, (_, i) => ({
    kind: i % 2 ? "build" : "calm",
    start: (duration / sectionCount) * i,
    end: (duration / sectionCount) * (i + 1),
  })),
  phrases: Array.from({ length: Math.floor(duration / 8) }, (_, index) => ({ index, time: index * 8 })),
  downbeats: Array.from({ length: Math.floor(duration / 2.5) }, (_, index) => ({ index, time: index * 2.5 })),
  energy: { mean: 0.53 },
  // `envelope` — a flat array on a 0.5s grid, which is what analyzeMusic writes and the ONLY
  // shape makeEnergy reads. This fixture spelled it `energyEnvelope`, so every scene in every
  // regression job was paced against the fallback constant 0.5: no beat was ever a peak, no
  // beat was ever calm, and the numbers below were measuring a composer that had been handed
  // silence with a duration.
  envelope: Array.from({ length: Math.round(duration / 0.5) }, (_, i) => {
    const t = (i * 0.5) / duration;
    // Two swells with a lull between them, so calm and peak beats both exist.
    return +(0.25 + 0.65 * Math.abs(Math.sin(t * Math.PI * 2))).toFixed(3);
  }),
});

/** Acts, because every real job has them — premium from its story plan, lite from its story
 *  adapter. Composing with `--plan none` was testing a shape no customer is ever sold: with
 *  no act boundaries the film never asks for a `chapter` transition, and the fixture scored
 *  a vocabulary two cuts smaller than the same album gets in production. */
const plan = { segments: ["opening", "portraits", "ceremony", "celebration"].map((id) => ({ id })) };

function compose({ photoCount, duration, name = "regression-job" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tmp-composed-"));
  fs.mkdirSync(path.join(dir, "music"), { recursive: true });
  fs.writeFileSync(path.join(dir, "photos.json"), JSON.stringify(photos(photoCount)));
  fs.writeFileSync(path.join(dir, "music", "track.json"), JSON.stringify(music(duration)));
  fs.writeFileSync(path.join(dir, "plan.json"), JSON.stringify(plan));
  const rel = (p) => path.relative(root, path.join(dir, p)).replace(/\\/g, "/");
  const out = rel("storyboard.json");

  const composed = spawnSync(node, [
    "scripts/composeStoryboard.mjs",
    "--photos", rel("photos.json"),
    "--music", `${rel("")}/track.mp3`,
    "--analysis-dir", rel(""),
    "--plan", rel("plan.json"), "--director", "none",
    "--music-mode", "full_song",
    "--name", name,
    "--out", out,
  ], { cwd: root, encoding: "utf8" });
  assert.equal(composed.status, 0, composed.stderr || composed.stdout);

  // The gate the real build runs, with the repair, exactly as both tiers invoke it.
  const gated = spawnSync(node, [
    "scripts/lintComposedFilm.mjs", "--storyboard", out, "--repair", "--strict",
  ], { cwd: root, encoding: "utf8" });

  const recipe = JSON.parse(fs.readFileSync(path.join(dir, "storyboard.json"), "utf8"));
  fs.rmSync(dir, { recursive: true, force: true });
  return { recipe, gate: { status: gated.status, out: gated.stdout + gated.stderr } };
}

/**
 * The frozen floors, recorded 2026-08-08 from an actual run of each job (verified stable
 * across repeated runs — the composer is deterministic given its inputs), on the numbers a
 * viewer would notice going down. RAISE these when a change makes films richer; lowering one
 * is a product decision and belongs in the commit message.
 *
 * These jobs run with NO director notes, so they measure the house grammar in
 * lib/storyboard.mjs — the floor of what any composed film gets. A real premium job with
 * director notes scores above them (11 effects against 8), which is the point: this holds
 * the floor, not the ceiling.
 */
const JOBS = [
  {
    name: "photo-poor album on a short track",
    photoCount: 23, duration: 95, // 17 scenes
    floors: {
      distinctEffects: 7, distinctTransitions: 5, typefaces: 3,
      distinctLayouts: 7, distinctArrangements: 5, arrangementsPerCard: 1,
    },
    ceilings: { topLookShare: 0.118 },
  },
  {
    name: "an ordinary album",
    photoCount: 50, duration: 180, // 33 scenes
    floors: {
      distinctEffects: 8, distinctTransitions: 5, typefaces: 3,
      distinctLayouts: 9, distinctArrangements: 7, arrangementsPerCard: 1,
    },
    ceilings: { topLookShare: 0.152 },
  },
  {
    name: "a rich album on a long track",
    photoCount: 85, duration: 245, // 45 scenes
    floors: {
      distinctEffects: 8, distinctTransitions: 5, typefaces: 3,
      distinctLayouts: 13, distinctArrangements: 14, arrangementsPerCard: 1,
    },
    ceilings: { topLookShare: 0.111 },
  },
];

for (const job of JOBS) {
  test(`composed film — ${job.name} — passes the gate and holds its floors`, () => {
    const { recipe, gate } = compose(job);

    assert.equal(gate.status, 0, `the composed-film gate rejected this job:\n${gate.out}`);
    const report = evaluateComposedFilm(recipe, { library });
    assert.equal(report.verdict, "pass", report.errors.map((e) => `${e.check}: ${e.detail}`).join("\n"));

    const card = scoreFilm(recipe, { library });
    for (const [metric, floor] of Object.entries(job.floors)) {
      assert.ok(card[metric] >= floor,
        `${metric} fell to ${card[metric]}; the floor is ${floor}. Raising the bar is fine, lowering it is a decision.`);
    }
    for (const [metric, ceiling] of Object.entries(job.ceilings)) {
      assert.ok(card[metric] <= ceiling,
        `${metric} rose to ${card[metric]}; the ceiling is ${ceiling} — the film is repeating itself more than it used to.`);
    }

    // Every photograph the album offered is spent, whatever else changes.
    assert.equal(recipe.fit.unplacedPhotos ?? 0, 0);

    // And the film wears a face of its own rather than the library's bare primitives.
    assert.ok(Object.keys(recipe.looks ?? {}).length > 0, "no looks were derived for this job");
    assert.ok(recipe.layoutPresets?.job_frame, "no per-job frame preset");
    const dressed = recipe.scenes.filter((s) => s.look).length;
    assert.ok(dressed > 0, "looks were derived but no scene wears one");
  });
}

test("two couples with the same album do not get the same film", () => {
  // The failure this whole layer exists to prevent, stated as a test: before it, every
  // composed film shared one set of photo geometry with every other. Frame and grade are
  // per-job too, but geometry is the one a viewer registers — frame, type and grade do not
  // move a photograph.
  const [a, b] = ["couple-one", "couple-two"].map((name) =>
    compose({ ...JOBS[2], name }).recipe);

  const arrangementsOf = (recipe) => new Set(
    Object.values(recipe.looks ?? {}).map((look) => JSON.stringify(look.layoutOverrides?.photoSlots ?? {})));
  const first = arrangementsOf(a);
  const second = arrangementsOf(b);
  const shared = [...first].filter((key) => second.has(key)).length;
  assert.ok(shared < first.size,
    "two jobs derived identical geometry for every layout — the seed is not reaching the arrangement");

  assert.notDeepEqual(a.layoutPresets.job_frame, b.layoutPresets.job_frame);
  assert.notDeepEqual(a.defaults.color, b.defaults.color);
});

test("the same job composed twice is the same film", () => {
  // The other half of the same contract: a re-run, a resume or a retry must not hand the
  // customer a different edit of the film they already approved.
  const [first, second] = [1, 2].map(() => compose({ ...JOBS[1], name: "same-couple" }).recipe);
  assert.deepEqual(first.looks, second.looks);
  assert.deepEqual(first.layoutPresets, second.layoutPresets);
  assert.deepEqual(first.scenes.map((s) => s.look ?? null), second.scenes.map((s) => s.look ?? null));
});

test("the shot list still answers to the album and the track, not to a fixed table", () => {
  // The defect this whole composer replaced: 16 hardcoded scenes and 113 seconds, whoever
  // the customer was. Three jobs, three different films — and the rich one is not simply the
  // poor one stretched.
  const films = JOBS.map((job) => scoreFilm(compose(job).recipe, { library }));
  const scenes = films.map((f) => f.scenes);
  assert.equal(new Set(scenes).size, films.length, `scene counts collapsed: ${scenes.join(", ")}`);
  assert.ok(films[2].distinctArrangements > films[0].distinctArrangements,
    "a richer album must buy more compositions, not just longer ones");
});
