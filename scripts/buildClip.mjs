// Phase 4 driver: one command that runs the whole adaptive pipeline and a
// closed QA loop.
//   1. ensure photo + music analysis exist (Phase 3)
//   2. generate the timeline (Director v2)
//   3. precise text auto-fit (measure + wrap/shrink so nothing overflows)
//   4. render
//   5. frame QA (brightness / empty) -> report
//   6. if a story scene came out too dark/flat, swap its hero photo for the next
//      best-quality one and re-render ONCE (only with --fix)
//
// Usage: node scripts/buildClip.mjs [--music "music/a thousand years.mp3"] [--fix]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const musicIdx = process.argv.indexOf("--music");
const music = musicIdx >= 0 ? process.argv[musicIdx + 1] : "music/a thousand years.mp3";
const doFix = process.argv.includes("--fix");
const TL = "timeline/quoc-nhi-full-v2.json";

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: root });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
}
const node = process.execPath;
const musicName = path.basename(music).replace(/\.[^.]+$/, "");

// 1. analysis
if (!fs.existsSync(path.join(root, "analysis/photos.json"))) run(node, ["scripts/analyzePhotos.mjs"]);
if (!fs.existsSync(path.join(root, `analysis/music/${musicName}.json`))) run(node, ["scripts/analyzeMusic.mjs", music]);

// 2-3. generate + fit.
// This is the LITE (rule-based) driver, so it forces the generator's hardcoded
// defaults with --director/--plan none — even if the Phase B AI outputs happen
// to exist in analysis/, Lite must stay deterministic and rule-based. The
// director-aware path is the v1 Premium flow (run the Phase B nodes, then let
// generateStoryClipV2 auto-load their outputs).
run(node, ["scripts/generateStoryClipV2.mjs", "--music", music, "--out", TL, "--director", "none", "--plan", "none"]);
run(node, ["scripts/fitTextInTimeline.mjs", TL]);

// 4. render
run(node, ["--import", "tsx", "src/index.ts", "--timeline", TL]);

// 5. QA
run(node, ["scripts/qaClip.mjs", TL]);
const qa = JSON.parse(fs.readFileSync(path.join(root, "analysis/qa/quoc-nhi-full-v2.json"), "utf8"));

// 6. optional auto-fix: swap dark/flat story heroes and re-render once
if (doFix) {
  const fixable = qa.problems.filter((p) => /_dark|flat/.test(p.flags.join(",")) && /^s\d/.test(p.id) && !/injapan|bigday/.test(p.id));
  if (fixable.length) {
    const photos = JSON.parse(fs.readFileSync(path.join(root, "analysis/photos.json"), "utf8")).photos;
    const byQual = [...photos].sort((a, b) => b.qualityNorm - a.qualityNorm);
    const tl = JSON.parse(fs.readFileSync(path.join(root, TL), "utf8"));
    const usedPaths = new Set(tl.slides.flatMap((s) => (s.layers || []).filter((l) => l.type === "image").map((l) => l.path)));
    for (const prob of fixable) {
      const slide = tl.slides.find((s) => s.id === prob.id);
      const hero = (slide.layers || []).find((l) => l.type === "image" && l.motion);
      if (!hero) continue;
      const orient = photos.find((p) => p.file === hero.path)?.orient;
      const repl = byQual.find((p) => p.orient === orient && !usedPaths.has(p.file));
      if (repl) { hero.path = repl.file; hero.focusX = repl.focusX; hero.focusY = repl.focusY; usedPaths.add(repl.file);
        console.log(`Auto-fix: ${prob.id} hero -> ${repl.file} (was dark/flat)`); }
    }
    fs.writeFileSync(path.join(root, TL), JSON.stringify(tl, null, 2));
    run(node, ["--import", "tsx", "src/index.ts", "--timeline", TL]);
    run(node, ["scripts/qaClip.mjs", TL]);
  } else {
    console.log("Auto-fix: no dark/flat story scenes to repair.");
  }
}

console.log(`\nDone. Output: ${JSON.parse(fs.readFileSync(path.join(root, TL), "utf8")).output.path}`);
