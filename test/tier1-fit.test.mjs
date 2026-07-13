// Does a Tier-1 recipe actually make a film the length of the song?
//
// THIS TEST IS EXPECTED TO FAIL TODAY. That is what it is for.
//
// The Tier-1 suite already had a scaling test — and it passed while the recipe shipped
// 72 seconds of film against a 203-second track. It passed because it asserted the
// MECHANISM (a scene got repeated, repeats stayed under the cap, the closing card is
// last) and never once asserted the OUTCOME. Its own fixture covers 82% of its own
// track and nobody noticed for as long as it has existed. A test that watches the
// machinery turn while the product comes out wrong is worse than no test: it spends
// the credibility of a green suite on the exact thing that is broken.
//
// So this one measures the only thing the customer can hear. They picked a song. Does
// the film last as long as the song?
//
// Fixed today (scripts/applyStoryTemplate.mjs): the recipe path now REFUSES to write a
// timeline that abandons the track, instead of exiting 0 on one. Not fixed today: the
// recipe path still counts its scenes by hand, from an absolute table of seconds, so it
// cannot stretch to a job it was not hand-tuned for. Premium does not have this bug —
// composeStoryboard solves the shot count against the photo budget, and it fits the very
// same 23-photo / 203s job to 99%. Teaching the recipe path that same budget is the fix,
// and it is a redesign, not a patch. Until it lands, this test is the bug: visible,
// measured, and impossible to forget.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = process.cwd();
const RECIPES = fs.readdirSync(path.join(root, "story-templates"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => `story-templates/${f}`);

// Two REAL shapes of job, not two convenient ones.
//   photo-rich — a full shoot against a short track.
//   photo-poor — the "chọn 20 ảnh đẹp nhất" product against a whole song. This is a
//                product we SELL, and it is the one the recipe path fails hardest.
const JOBS = [
  { name: "photo-rich (60 photos / 150s track)", photos: 60, music: 150 },
  { name: "photo-poor (23 photos / 203s track)", photos: 23, music: 203 },
];

const FIT_TOLERANCE = 0.1;

/** Build a recipe's timeline for a given job. --accept-misfit so we get the artifact
 *  back and can MEASURE the gap, rather than only learning that there was one. */
function buildTimeline(recipe, job, temp) {
  const musicName = `tier1-fit-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const analysisDir = path.join(temp, "analysis");
  fs.mkdirSync(path.join(analysisDir, "music"), { recursive: true });

  const photos = Array.from({ length: job.photos }, (_, i) => ({
    file: `input/${String(i + 1).padStart(3, "0")}.jpg`,
    orient: i % 2 ? "portrait" : "landscape",
    qualityNorm: 0.9 - i / 1000,
    sharpness: 30,
    meanLuma: 128,
  }));
  const photosPath = path.join(temp, `photos-${musicName}.json`);
  const outPath = path.join(temp, `tl-${musicName}.json`);
  fs.writeFileSync(photosPath, JSON.stringify({ photos }));
  const beatSeconds = 0.5;
  const phrases = Array.from({ length: Math.ceil(job.music / 8) + 1 }, (_, i) => ({ index: i, time: Math.min(job.music, i * 8), kind: "phrase" }));
  fs.writeFileSync(path.join(analysisDir, "music", `${musicName}.json`), JSON.stringify({
    analysisVersion: 2, duration: job.music, envelope: [],
    beatGrid: { beatSeconds, phase: 0, source: "test" }, phrases,
  }));

  const r = spawnSync(process.execPath, [
    "scripts/applyStoryTemplate.mjs",
    "--template", recipe,
    "--photos", photosPath,
    "--music", `music/${musicName}.mp3`,
    "--analysis-dir", analysisDir,
    "--out", outPath,
  ], { cwd: root, encoding: "utf8" });

  if (r.status !== 0) return { error: (r.stderr || r.stdout || "").trim().split("\n").find((l) => /Error/.test(l)) || `exit ${r.status}` };

  const tl = JSON.parse(fs.readFileSync(outPath, "utf8"));
  const film = tl.slides.reduce((n, s) => n + s.duration, 0)
    - tl.slides.reduce((n, s) => n + (s.transition?.duration || 0), 0);
  const edit = tl.recipeDecisions.musicEdit;
  const target = edit?.duration || job.music;
  return { film, target, mode: edit?.mode || "full_song", scenes: tl.slides.length, coverage: film / target };
}

test("every Tier-1 recipe fits its full song or intentional highlight", (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "tier1-fit-"));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));

  const rows = [];
  for (const job of JOBS) {
    for (const recipe of RECIPES) {
      const got = buildTimeline(recipe, job, temp);
      rows.push({ job: job.name, recipe: path.basename(recipe), ...got });
    }
  }

  const bad = rows.filter((r) => r.error || Math.abs(r.coverage - 1) > FIT_TOLERANCE);
  const table = rows.map((r) =>
    `    ${r.job.padEnd(34)} ${r.recipe.padEnd(24)} ` +
    (r.error ? `ERROR: ${r.error}` : `${r.film.toFixed(0)}s / ${r.target.toFixed(0)}s ${r.mode} in ${String(r.scenes).padStart(2)} scenes = ${(r.coverage * 100).toFixed(0)}%`)
  ).join("\n");

  assert.equal(
    bad.length, 0,
    `${bad.length}/${rows.length} recipe+job combinations do not fill the track ` +
    `(tolerance ±${FIT_TOLERANCE * 100}%):\n${table}\n\n` +
    `  The recipe path picks scene durations from an absolute table (base 5.5s, calm 7s,\n` +
    `  montage 12s) scaled only 0.86–1.12x, and repeats whole scenes until it runs out of\n` +
    `  photos or hits the repeat cap. Neither loop is aware of how long the song is.\n` +
    `  composeStoryboard fits the same 23-photo/203s job to 99% by solving the shot count\n` +
    `  from the photo budget. Give the recipe path that budget and this test goes green.`
  );
});
