// Phase 4 QA: sample one frame per scene from a rendered clip and score it with
// ffmpeg signalstats (brightness / dynamic range) to flag scenes that came out
// too dark, blown out, or flat/empty. Writes a per-scene report + verdicts the
// Director can act on (e.g. swap a dark photo). Montage/quote scenes are graded
// leniently because they are intentionally darker.
//
// Usage: node scripts/qaClip.mjs timeline/quoc-nhi-full-v2.json [--out analysis/qa/<name>.json]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const tlPath = process.argv[2];
if (!tlPath) throw new Error("Usage: node scripts/qaClip.mjs <timeline.json>");
const tl = JSON.parse(fs.readFileSync(path.resolve(root, tlPath), "utf8"));
const video = path.resolve(root, tl.output.path);
if (!fs.existsSync(video)) throw new Error("Rendered video not found: " + tl.output.path + " (render it first)");
const base = path.basename(tlPath).replace(/\.[^.]+$/, "");
const outIdx = process.argv.indexOf("--out");
const outPath = outIdx >= 0 ? process.argv[outIdx + 1] : `analysis/qa/${base}.json`;
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";

// scene start times, accounting for xfade overlap with the NEXT slide
/** Does this slide actually show a photograph? A closing card is cream by design;
 *  measuring its exposure and calling it "too bright" grades the art director, not
 *  the photo. (The old rule asked whether the scene id matched /injapan|bigday/ —
 *  the names of scenes in one couple's film. Once the shot list stopped being
 *  hardcoded, that regex matched nothing and the closing card was flagged on every
 *  single run.) */
const showsPhoto = (s) =>
  Boolean(s.image) ||
  (s.images || []).length > 0 ||
  (s.layers || []).some((l) => l.type === "image");

const scenes = [];
let t = 0;
for (const s of tl.slides) {
  const trans = s.transition?.duration || 0;
  scenes.push({
    id: s.id,
    effect: s.effect,
    photo: showsPhoto(s),
    start: t,
    dur: s.duration,
    mid: t + s.duration / 2,
  });
  t += s.duration - trans;
}

function statsAt(sec) {
  const r = spawnSync(ffmpeg, ["-v", "error", "-ss", String(sec.toFixed(2)), "-i", video,
    "-frames:v", "1", "-vf", "signalstats,metadata=print:file=-", "-f", "null", "-"],
    { encoding: "utf8", maxBuffer: 1 << 24 });
  const txt = (r.stdout || "") + (r.stderr || "");
  const get = (k) => { const m = txt.match(new RegExp(`lavfi\\.signalstats\\.${k}=([\\-0-9.]+)`)); return m ? Number(m[1]) : null; };
  return { yavg: get("YAVG"), ymin: get("YMIN"), ymax: get("YMAX") };
}

const DARK = 42, BRIGHT = 224, FLAT = 38;
const results = scenes.map((sc) => {
  const st = statsAt(sc.mid);
  const range = st.ymax != null && st.ymin != null ? st.ymax - st.ymin : null;

  // A card with no photograph on it has nothing to expose badly. Skip it rather
  // than flag a design decision as a defect — and say so, so a reader of the
  // report can see the check was declined on purpose and not quietly passed.
  if (!sc.photo) {
    return { id: sc.id, effect: sc.effect, at: +sc.mid.toFixed(2), yavg: st.yavg, range, photo: false, verdict: "ok", skipped: "card, not a photograph", flags: [] };
  }

  // Montages and full-bleed frames run darker by design (grain, letterbox, scrim).
  const lenient = sc.effect !== "layer_scene";
  const flags = [];
  if (st.yavg != null && st.yavg < (lenient ? 20 : DARK)) flags.push("too_dark");
  if (st.yavg != null && st.yavg > BRIGHT) flags.push("too_bright");
  if (range != null && range < FLAT) flags.push("flat_or_empty");
  return { id: sc.id, effect: sc.effect, at: +sc.mid.toFixed(2), yavg: st.yavg, range, photo: true, lenient, verdict: flags.length ? "review" : "ok", flags };
});

const problems = results.filter((r) => r.verdict !== "ok");
const report = {
  video: tl.output.path, scenes: results.length,
  passed: results.length - problems.length, flagged: problems.length,
  problems: problems.map((p) => ({ id: p.id, flags: p.flags, yavg: p.yavg, range: p.range })),
  results,
};
fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(report, null, 2));
console.log(`QA ${base}: ${report.passed}/${report.scenes} ok, ${report.flagged} flagged.` +
  (problems.length ? " Review: " + problems.map((p) => `${p.id}[${p.flags.join(",")}]`).join(" ") : ""));
