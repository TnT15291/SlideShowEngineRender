import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { makePreviewCut } from "./lib/previewCut.mjs";
import { compareRegression } from "./lib/regressionFrames.mjs";

const root = process.cwd(), node = process.execPath;
const arg = (flag, def = "") => { const i = process.argv.indexOf(flag); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const dryRun = process.argv.includes("--dry-run"), strict = process.argv.includes("--strict"), update = process.argv.includes("--update-baseline");
const duration = Math.max(12, Math.min(25, Number(arg("--duration", "15")) || 15));
const photos = arg("--photos", "analysis/photos.json"), music = arg("--music", "music/a thousand years.mp3");
const analysisDir = arg("--analysis-dir", "analysis"), musicJson = `${analysisDir}/music/${path.parse(music).name}.json`;
const allRecipes = fs.readdirSync(path.resolve(root, "story-templates")).filter((f) => f.endsWith(".json")).map((f) => `story-templates/${f}`);
const recipeFilter = arg("--recipes", "").split(",").filter(Boolean);
const recipes = recipeFilter.length ? allRecipes.filter((p) => recipeFilter.some((id) => p.includes(id))) : allRecipes;
const pacings = arg("--pacing", "gentle,balanced,lively").split(",").filter((p) => ["gentle", "balanced", "lively"].includes(p));
if (!recipes.length || !pacings.length) throw new Error("No recipes or pacing variants selected");
for (const p of [photos, music, musicJson]) if (!fs.existsSync(path.resolve(root, p))) throw new Error(`Missing regression input: ${p}`);
const outDir = arg("--out-dir", "analysis/regression-gallery"), baselinePath = arg("--baseline", "test/baselines/tier1-regression.json");
fs.mkdirSync(path.resolve(root, outDir), { recursive: true });
const prompt = `${outDir}/prompt.txt`; fs.writeFileSync(path.resolve(root, prompt), "Warm, cinematic, balanced wedding regression fixture.\n");
let baseline = null; try { baseline = JSON.parse(fs.readFileSync(path.resolve(root, baselinePath), "utf8")); } catch {}
function run(args, label) { const r = spawnSync(node, args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 }); if (r.status !== 0) throw new Error(`${label}: ${r.stderr || r.stdout}`); }
// The deterministic QA gate, run as a MEASURE (never throws): this is the check the real
// `runProject --tier template --strict` path applies, and the frame-hash suite alone never
// exercised it — which is how a library geometry drift could flag text_safe_area on 7 of 8
// recipes and still ship a "green" gallery. Blocking = any finding qaLoop cannot auto-repair
// (text_safe_area, closing_card, caption_integrity…); repairable findings (pacing/hero/crop)
// carry a `fix` and converge inside qaLoop, so they are reported but do not fail the gallery.
function qaGate(timeline, dir) {
  const out = path.resolve(root, `${dir}/qa.proxy.json`);
  spawnSync(node, ["scripts/qaProxy.mjs", path.resolve(root, timeline), "--analysis-dir", analysisDir, "--out", out],
    { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  let proxy = null; try { proxy = JSON.parse(fs.readFileSync(out, "utf8")); } catch {}
  const problems = proxy?.problems || [];
  return {
    verdict: proxy?.verdict ?? "error",
    blocking: problems.filter((p) => !p.fix).map((p) => `${p.id}:${p.check}`),
    repairable: problems.filter((p) => p.fix).map((p) => `${p.id}:${p.check}`),
  };
}
function frameHash(video, sec) {
  const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
  const r = spawnSync(ffmpeg, ["-v", "error", "-ss", String(sec), "-i", path.resolve(root, video), "-frames:v", "1", "-vf", "scale=9:8,format=gray", "-f", "rawvideo", "-"], { maxBuffer: 1 << 20 });
  if (r.status !== 0 || r.stdout.length < 72) throw new Error(`frame hash failed: ${r.stderr}`);
  let bits = 0n; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits = (bits << 1n) | (r.stdout[y * 9 + x] > r.stdout[y * 9 + x + 1] ? 1n : 0n);
  return bits.toString(16).padStart(16, "0");
}
const entries = [];
for (const recipePath of recipes) for (const pacing of pacings) {
  const recipe = JSON.parse(fs.readFileSync(path.resolve(root, recipePath), "utf8")), id = `${recipe.id}--${pacing}`, dir = `${outDir}/${id}`;
  fs.mkdirSync(path.resolve(root, dir), { recursive: true });
  const direction = `${dir}/direction.json`, fullTl = `${dir}/full.json`, timelinePath = `${dir}/timeline.json`, video = `${dir}/preview.mp4`, contact = `${dir}/contact.jpg`;
  // Do not let pre-flight QA sample a preview left by an older timeline.
  fs.rmSync(path.resolve(root, video), { force: true });
  run(["scripts/chooseTier1Direction.mjs", "--recipe", recipePath, "--prompt", prompt, "--photos", photos, "--music", musicJson, "--pacing", pacing, "--out", direction], `direction ${id}`);
  run(["scripts/applyStoryTemplate.mjs", "--template", recipePath, "--photos", photos, "--music", music, "--analysis-dir", analysisDir, "--direction", direction,
    "--out", fullTl, "--output", video, "--name", id, "--quality", "draft", "--prompt", prompt], `timeline ${id}`);
  run(["scripts/qaLoop.mjs", "--timeline", fullTl, "--analysis-dir", `${dir}/analysis`, "--photos", photos,
    "--content", `${analysisDir}/photo_content.json`, "--music", musicJson, "--tier", "template",
    "--max-revisions", "3", "--skip-render"], `pre-flight QA ${id}`);
  const full = JSON.parse(fs.readFileSync(path.resolve(root, fullTl), "utf8")), cut = makePreviewCut(full, { duration, output: video });
  fs.writeFileSync(path.resolve(root, timelinePath), JSON.stringify(cut, null, 2) + "\n"); run(["scripts/fitTextInTimeline.mjs", timelinePath], `fit ${id}`);
  const qa = qaGate(fullTl, dir); // gate the full film, not the trimmed preview cut
  run(["--import", "tsx", "src/index.ts", "--timeline", timelinePath, ...(dryRun ? ["--dry-run"] : [])], `render ${id}`);
  const signature = cut.slides.map((s) => `${s.editorialBeat}:${s.effect}:${(s.layers || []).length}`).join("|");
  const frames = dryRun ? [] : ["hook", "peak", "closing"].map((beat) => { const slide = cut.slides.find((s) => s.editorialBeat === beat) || cut.slides[0]; let t = 0; for (const s of cut.slides) { if (s === slide) break; t += s.duration - (s.transition?.duration || 0); } return { beat, at: +(t + slide.duration / 2).toFixed(2), hash: frameHash(video, t + slide.duration / 2) }; });
  if (!dryRun) run(["scripts/generateContactSheet.mjs", timelinePath, "--analysis-dir", analysisDir, "--out", contact, "--json", `${dir}/contact.json`], `contact ${id}`);
  const current = { id, recipeId: recipe.id, pacing, signature, qa, frames, timeline: timelinePath, video: dryRun ? null : video, contact: dryRun ? null : contact };
  current.comparison = dryRun ? { verdict: "validated" } : compareRegression(current, baseline?.entries?.find((e) => e.id === id)); entries.push(current);
}
const qaFailures = entries.filter((e) => e.qa.blocking.length);
const report = { version: 1, generatedAt: new Date().toISOString(), dryRun, inputs: { photos, music }, entries,
  summary: {
    ...Object.fromEntries(["pass", "review", "changed", "new", "validated"].map((v) => [v, entries.filter((e) => e.comparison.verdict === v).length])),
    qaBlocked: qaFailures.length,
  } };
if (qaFailures.length) { console.error(`QA gate: ${qaFailures.length} variant(s) have blocking findings:`);
  for (const e of qaFailures) console.error(`  ${e.id}: ${e.qa.blocking.join(", ")}`); }
fs.writeFileSync(path.resolve(root, `${outDir}/gallery.json`), JSON.stringify(report, null, 2) + "\n");
const cards = entries.map((e) => `<article class="${e.qa.blocking.length ? "changed" : e.comparison.verdict}"><h2>${e.recipeId}</h2><p>${e.pacing} · <b>${e.comparison.verdict}</b></p><p class="qa">QA: ${e.qa.blocking.length ? `<b>blocked</b> — ${e.qa.blocking.join(", ")}` : `${e.qa.verdict}${e.qa.repairable.length ? ` (auto-repairs: ${e.qa.repairable.join(", ")})` : ""}`}</p>${e.contact ? `<img src="${path.basename(path.dirname(e.contact))}/contact.jpg">` : "<p>Dry-run validated</p>"}</article>`).join("");
fs.writeFileSync(path.resolve(root, `${outDir}/index.html`), `<!doctype html><meta charset="utf-8"><title>Tier 1 Regression Gallery</title><style>body{font:14px system-ui;background:#eee9e1;margin:24px}main{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}article{background:white;padding:14px;border-radius:12px;border-top:6px solid #777}article.pass{border-color:#2e7d32}article.review,article.new{border-color:#f9a825}article.changed{border-color:#c62828}img{width:100%}p.qa{font-size:12px;color:#555}</style><h1>Tier 1 Regression Gallery</h1><main>${cards}</main>`, "utf8");
if (update && !dryRun) { fs.mkdirSync(path.dirname(path.resolve(root, baselinePath)), { recursive: true }); fs.writeFileSync(path.resolve(root, baselinePath), JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), entries: entries.map(({ comparison, ...e }) => e) }, null, 2) + "\n"); }
console.log(`Regression gallery: ${entries.length} variants -> ${outDir} ${JSON.stringify(report.summary)}`);
// The QA gate fails --strict even on a dry run: text_safe_area/closing_card are provable from
// the timeline alone, so a geometry regression must break CI without waiting for a render.
if (strict && (qaFailures.length || entries.some((e) => ["changed", "new"].includes(e.comparison.verdict)))) process.exit(1);
