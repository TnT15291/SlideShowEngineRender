// Phase F / node 12 — DELIVERABLES.
//
// Bundles a finished render into what the customer actually receives:
//   final.mp4 · preview.mp4 · thumbnail.jpg · project_summary.json
//
// This node DELIVERS, it does not RENDER. If output.path is missing on disk it
// fails loudly and tells you to render first. Folding "render if absent" into a
// packaging command is how a one-second `deliver` silently becomes a 20-minute
// encode — node 10 renders, node 9 orchestrates, node 12 only packages.
//
// Two choices deserve their reasoning, because both are places where it would be
// easy to fake a judgement the pipeline never made:
//
//   • THUMBNAIL. The best frame is the strongest hero photo — but Hero Score is
//     only meaningful when `photo_content.generatedBy` says a real vision model
//     produced it. On `stub` those scores are placeholders, so picking "the
//     highest" would rank noise and look authoritative doing it. Same gate as
//     qaProxy's hero check: stub → fall back to a deterministic rule (the longest
//     hero slide) and record *which* rule fired in `thumbnail.chosenBy`.
//
//   • TIER (director vs Lite). A timeline carries no provenance stamp, and the
//     director layer's fingerprints (curves, overlays) are not reliable enough to
//     reverse-engineer. Guessing here would put a confident wrong word in a
//     customer-facing file, so delivery does not guess: whoever generated the
//     timeline passes `--tier`, and absent that it stays "unknown". renderWithRetry
//     knows its own mode and passes it.
//
// Slide start times come from lib/pacing.mjs `sceneTimes` — the same function the
// generator and QA use — so the thumbnail is sampled from the timeline the engine
// actually rendered, transition overlap included.
//
// Usage: node scripts/deliver.mjs <timeline.json> [--out-dir output/deliver/<name>]
//   [--tier director|lite|unknown] [--analysis-dir analysis]
//   [--preview-height 720] [--preview-seconds 0] [--watermark "text"]
//   [--font fonts/BeVietnamPro-Regular.ttf] [--thumb-time <sec>] [--no-copy]
// Exit: 0 ok · 1 error.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sceneTimes } from "./lib/pacing.mjs";
import { validate } from "./lib/checkSchema.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const die = (msg) => {
  console.error(`[deliver] FAILED: ${msg}`);
  process.exit(1);
};

const tlPath = process.argv[2];
if (!tlPath || tlPath.startsWith("--")) {
  console.error(
    "Usage: node scripts/deliver.mjs <timeline.json> [--out-dir <dir>] [--tier director|lite]\n" +
      "  [--preview-height 720] [--preview-seconds 0] [--watermark \"text\"] [--thumb-time <sec>] [--no-copy]"
  );
  process.exit(1);
}

const tlAbs = path.resolve(root, tlPath);
if (!fs.existsSync(tlAbs)) die(`timeline not found: ${tlPath}`);
const tl = JSON.parse(fs.readFileSync(tlAbs, "utf8"));
const base = path.basename(tlPath).replace(/\.[^.]+$/, "");

const outDir = arg("--out-dir", `output/deliver/${base}`);
const tier = arg("--tier", "unknown");
if (!["director", "lite", "unknown"].includes(tier)) die(`--tier must be director|lite|unknown, got "${tier}"`);
const analysisDir = arg("--analysis-dir", "analysis").replace(/\\/g, "/").replace(/\/$/, "");
const contentPath = arg("--content", `${analysisDir}/photo_content.json`);
const previewHeight = Number(arg("--preview-height", "720"));
const previewSeconds = Number(arg("--preview-seconds", "0"));
const watermark = arg("--watermark", "");
const fontRel = arg("--font", "fonts/BeVietnamPro-Regular.ttf");
const thumbTimeArg = arg("--thumb-time", "");
const noCopy = process.argv.includes("--no-copy");

if (!Number.isFinite(previewHeight) || previewHeight < 16) die(`--preview-height must be a number >= 16`);
if (!Number.isFinite(previewSeconds) || previewSeconds < 0) die(`--preview-seconds must be a number >= 0`);

const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_, e) => "ffprobe" + (e || ""));

// --- the rendered video is an INPUT here, never something we produce ---------
const finalRel = tl.output?.path;
if (!finalRel) die(`${tlPath} has no output.path — nothing to deliver`);
const finalAbs = path.resolve(root, finalRel);
if (!fs.existsSync(finalAbs)) {
  die(
    `rendered video not found: ${finalRel}\n` +
      `  node 12 packages, it does not render. Produce it first:\n` +
      `    node scripts/renderWithRetry.mjs --out ${tlPath}`
  );
}

// --- helpers ----------------------------------------------------------------
function run(bin, args, label) {
  const r = spawnSync(bin, args, { cwd: root, encoding: "utf8", maxBuffer: 1 << 26 });
  if (r.error) die(`${label}: cannot run ${bin} (${r.error.message}). Is FFMPEG_PATH correct?`);
  if (r.status !== 0) die(`${label}: exit ${r.status}\n${(r.stderr || "").trim().slice(0, 400)}`);
  return r.stdout || "";
}

/** Probe a video: duration, dimensions, fps, bitrate, size. */
function probe(file, label) {
  const out = run(
    ffprobe,
    ["-v", "error", "-select_streams", "v:0",
     "-show_entries", "stream=width,height,r_frame_rate:format=duration,bit_rate,size",
     "-of", "json", file],
    `probe ${label}`
  );
  const j = JSON.parse(out);
  const s = j.streams?.[0];
  const f = j.format || {};
  if (!s?.width || !s?.height) die(`probe ${label}: no video stream dimensions`);
  const [num, den] = String(s.r_frame_rate || "0/1").split("/").map(Number);
  const duration = Number(f.duration);
  const info = {
    width: s.width,
    height: s.height,
    fps: den ? +(num / den).toFixed(3) : 0,
    durationSec: Number.isFinite(duration) ? +duration.toFixed(3) : 0,
    sizeBytes: Number(f.size) || fs.statSync(path.resolve(root, file)).size,
  };
  // ffprobe reports bit_rate as "N/A" for some containers. Omit the KEY rather
  // than setting it undefined: checkSchema tests `k in data`, so a present-but-
  // undefined key is walked against `type: number` and fails.
  const br = Number(f.bit_rate);
  if (Number.isFinite(br)) info.bitrateKbps = Math.round(br / 1000);
  return info;
}

const readJson = (rel) => {
  const abs = path.resolve(root, rel);
  return fs.existsSync(abs) ? JSON.parse(fs.readFileSync(abs, "utf8")) : null;
};
const sizeOf = (rel) => fs.statSync(path.resolve(root, rel)).size;
const rel = (...p) => path.join(...p).replace(/\\/g, "/");

/** Escape a string for use inside a drawtext `text='...'` filter option. */
const escText = (s) => s.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");

fs.mkdirSync(path.resolve(root, outDir), { recursive: true });

const video = probe(finalRel, "final.mp4");

// --- thumbnail: choose a frame, and say out loud which rule chose it ---------
// "Hero slot" is the same notion qaProxy uses: the image layer that MOVES.
const times = sceneTimes(tl.slides);
const lastIdx = tl.slides.length - 1;
const heroSlots = [];
tl.slides.forEach((slide, si) => {
  (slide.layers || []).forEach((l) => {
    if (l.type === "image" && l.motion && l.path)
      // Bookend slides are the title card and the outro card: they carry text and a
      // heavy fade/overlay, and the ending is deliberately the LONGEST slide. So a
      // naive "longest hero slide" fallback picks the one washed-out frame in the
      // film, every time. Mark them and prefer the interior.
      heroSlots.push({ si, path: l.path, dur: slide.duration, bookend: si === 0 || si === lastIdx });
  });
});

const content = readJson(contentPath);
const photoContentBy = content?.generatedBy ?? "missing";
const thumb = {};

if (thumbTimeArg !== "") {
  const t = Number(thumbTimeArg);
  if (!Number.isFinite(t) || t < 0) die(`--thumb-time must be a number >= 0`);
  thumb.timeSec = t;
  thumb.chosenBy = "explicit";
  thumb.reason = `--thumb-time ${t}`;
} else if (content && content.generatedBy !== "stub" && heroSlots.length) {
  const pool = new Map(content.photos.map((p) => [p.file, p]));
  const scored = heroSlots
    .map((h) => ({ ...h, heroScore: pool.get(h.path)?.heroScore }))
    .filter((h) => typeof h.heroScore === "number");
  // Hero Score rates the PHOTO; the thumbnail is a frame of the RENDER. A great
  // photo on the ending slide still yields a faded frame under the outro text, so
  // the bookend exclusion applies here too.
  const interior = scored.filter((h) => !h.bookend);
  const pickFrom = interior.length ? interior : scored;
  if (pickFrom.length) {
    const best = pickFrom.reduce((a, b) => (b.heroScore > a.heroScore ? b : a));
    thumb.timeSec = times[best.si].mid;
    thumb.chosenBy = "heroScore";
    thumb.sourcePhoto = best.path;
    thumb.reason =
      `${best.path} has the highest Hero Score (${best.heroScore}) of ${pickFrom.length} ` +
      `${interior.length ? "interior " : ""}hero slot(s), scored by ${photoContentBy}` +
      (interior.length ? "" : " — only bookend slots were scored, expect text/fade in the frame");
  }
}
if (thumb.chosenBy === undefined) {
  // Either no real scores, or none of the hero photos are in photo_content.
  const why =
    photoContentBy === "stub"
      ? `photo_content.generatedBy=stub — Hero Scores are placeholders, not judgements (set OPENAI_API_KEY and re-run analyzePhotoContent)`
      : content
        ? `no hero slot has a Hero Score in ${contentPath}`
        : `${contentPath} not found`;
  const interior = heroSlots.filter((h) => !h.bookend);
  const pickFrom = interior.length ? interior : heroSlots;
  if (pickFrom.length) {
    const best = pickFrom.reduce((a, b) => (b.dur > a.dur ? b : a));
    thumb.timeSec = times[best.si].mid;
    thumb.chosenBy = "longest-hero-slide";
    thumb.sourcePhoto = best.path;
    thumb.reason =
      `${why}; fell back to the longest ${interior.length ? "interior " : ""}hero slide ` +
      `(${tl.slides[best.si].id}, ${best.dur}s)` +
      (interior.length ? "" : " — every hero slot is a bookend card, expect text/fade in the frame");
  } else {
    thumb.timeSec = +(video.durationSec / 2).toFixed(3);
    thumb.chosenBy = "midpoint";
    thumb.reason = `${why}; no moving-image (hero) layer in any slide, sampled the video midpoint`;
  }
}
// A slide mid can land past the video end if the timeline and the render drifted.
thumb.timeSec = Math.max(0, Math.min(thumb.timeSec, Math.max(0, video.durationSec - 0.05)));

const thumbRel = rel(outDir, "thumbnail.jpg");
run(ffmpeg, ["-v", "error", "-y", "-ss", thumb.timeSec.toFixed(2), "-i", finalRel,
  "-frames:v", "1", "-q:v", "2", thumbRel], "thumbnail");
thumb.path = thumbRel;

// --- preview: a small, fast-to-send copy. Never upscales. -------------------
const previewRel = rel(outDir, "preview.mp4");
const vf = [];
const scaled = video.height > previewHeight;
if (scaled) vf.push(`scale=-2:${previewHeight}`);
if (watermark) {
  if (!fs.existsSync(path.resolve(root, fontRel))) die(`--watermark needs a font; not found: ${fontRel}`);
  const h = scaled ? previewHeight : video.height;
  vf.push(
    `drawtext=fontfile=${fontRel}:text='${escText(watermark)}':` +
      `fontsize=${Math.max(12, Math.round(h / 28))}:fontcolor=white@0.78:` +
      `box=1:boxcolor=black@0.28:boxborderw=10:x=w-tw-28:y=h-th-28`
  );
}
const pArgs = ["-v", "error", "-y", "-i", finalRel];
if (previewSeconds > 0) pArgs.push("-t", String(previewSeconds));
if (vf.length) pArgs.push("-vf", vf.join(","));
pArgs.push("-c:v", "libx264", "-preset", "veryfast", "-crf", "26", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", previewRel);
run(ffmpeg, pArgs, "preview");

const pProbe = probe(previewRel, "preview.mp4");
const preview = {
  path: previewRel,
  width: pProbe.width,
  height: pProbe.height,
  durationSec: pProbe.durationSec,
  sizeBytes: pProbe.sizeBytes,
  scaled,
};
if (watermark) preview.watermark = watermark;

// --- final.mp4 into the bundle ----------------------------------------------
let finalDelivered = finalRel;
if (!noCopy) {
  finalDelivered = rel(outDir, "final.mp4");
  fs.copyFileSync(finalAbs, path.resolve(root, finalDelivered));
}

// --- summary -----------------------------------------------------------------
const directorDoc = readJson(`${analysisDir}/director_notes.json`);
const planDoc = readJson(`${analysisDir}/story_plan.json`);
const optionsDoc = readJson(`${analysisDir}/story_options.json`);

// These files live in analysis/ for the whole project, not per-render. Their mere
// existence says nothing about whether THIS timeline was built from them — a Lite
// or hand-made timeline sits in the same repo. Only `--tier director` (passed by
// whoever generated it) licenses attributing them to this video; otherwise they
// are named as "present, unattributed" and their contents are NOT attached, so the
// summary can never imply a directorial decision that never touched the render.
const directorApplied = tier === "director";
const found = [];
if (directorDoc) found.push(`${analysisDir}/director_notes.json`);
if (planDoc) found.push(`${analysisDir}/story_plan.json`);
if (optionsDoc) found.push(`${analysisDir}/story_options.json`);
const artifacts = directorApplied ? found : [];

const usedPhotos = [];
for (const s of tl.slides) {
  for (const l of s.layers || []) if (l.type === "image" && l.path) usedPhotos.push(l.path);
  for (const f of s.images || []) usedPhotos.push(f);
}
const captions = tl.slides.reduce((n, s) => n + (s.captions?.length || 0), 0);

const music = (tl.music || []).map((m) => {
  const row = { path: m.path };
  if (typeof m.volume === "number") row.volume = m.volume;
  const mj = readJson(`${analysisDir}/music/${path.basename(m.path).replace(/\.[^.]+$/, "")}.json`);
  if (mj?.bpmEstimate) row.bpmEstimate = mj.bpmEstimate;
  if (mj?.duration) row.durationSec = +Number(mj.duration).toFixed(3);
  return row;
});

// QA verdict is reported, never recomputed — qaProxy owns that measurement.
//
// But a report is only about the timeline it measured. QA reports are keyed by
// timeline BASENAME, and renderWithRetry regenerates the timeline in place on
// every run — so yesterday's `<base>.proxy.json` sits right where today's would,
// describing slides that no longer exist. Shipping its verdict would be the same
// lie as attributing stale director notes: mtime is the evidence, so use it.
const tlMtime = fs.statSync(tlAbs).mtimeMs;
const staleAgainstTimeline = (doc) => {
  const gen = Date.parse(doc?.generatedAt ?? "");
  return !Number.isFinite(gen) || gen < tlMtime;
};

const proxyRel = `${analysisDir}/qa/${base}.proxy.json`;
const proxy = readJson(proxyRel);
const loop = readJson(`${analysisDir}/qa/${base}.loop.json`);
let qa;
if (!proxy) {
  qa = { verdict: "unknown", reason: `no ${proxyRel} — run: node scripts/qaProxy.mjs ${tlPath}` };
} else if (staleAgainstTimeline(proxy)) {
  qa = {
    verdict: "unknown",
    reason:
      `${proxyRel} was generated ${proxy.generatedAt ?? "(no timestamp)"} but ${rel(tlPath)} changed at ` +
      `${new Date(tlMtime).toISOString()} — that verdict measured a different timeline. ` +
      `Re-run: node scripts/qaProxy.mjs ${tlPath}`,
  };
} else {
  qa = {
    verdict: proxy.verdict === "ok" ? "ok" : "review",
    problems: proxy.problems?.length || 0,
    source: proxyRel,
  };
  if (loop?.manualReview && !staleAgainstTimeline(loop)) qa.manualReview = true;
}

// The manifest lists the payload it ships with, not itself — a self-entry would
// need its own size before it is written.
const deliverables = [
  { name: "final.mp4", path: finalDelivered, sizeBytes: sizeOf(finalDelivered) },
  { name: "preview.mp4", path: previewRel, sizeBytes: preview.sizeBytes },
  { name: "thumbnail.jpg", path: thumbRel, sizeBytes: sizeOf(thumbRel) },
];

const summary = {
  project: tl.project?.name || base,
  generatedAt: new Date().toISOString(),
  timeline: rel(tlPath),
  tier,
  provenance: { photoContent: photoContentBy, artifacts },
  video: { path: finalDelivered, ...video },
  content: {
    slides: tl.slides.length,
    photosUsed: usedPhotos.length,
    uniquePhotos: new Set(usedPhotos).size,
    captions,
  },
  thumbnail: thumb,
  preview,
  qa,
  deliverables,
};
if (music.length) summary.music = music;
if (!directorApplied && found.length) {
  summary.provenance.note =
    `tier=${tier} — ${found.length} director artifact(s) exist in analysis/ but are not attributed to this render ` +
    `(pass --tier director if this timeline was generated from them)`;
}
if (directorApplied && directorDoc?.director_notes) summary.director = directorDoc.director_notes;
if (directorApplied && Array.isArray(planDoc?.segments)) {
  summary.storyPlan = planDoc.segments.map((s) => ({
    segment: s.segment,
    emotion: s.emotion,
    pacing: s.pacing,
    emphasis: s.emphasis,
  }));
}

const summaryRel = rel(outDir, "project_summary.json");
// The manifest is a contract like every other node's output — check it here so a
// malformed summary fails at delivery, not in whatever reads it downstream.
const schema = JSON.parse(fs.readFileSync(path.resolve(root, "schema/project-summary.schema.json"), "utf8"));
const errors = validate(schema, summary);
if (errors.length) {
  console.error("[deliver] project_summary failed its own schema:");
  for (const e of errors.slice(0, 20)) console.error("  - " + e);
  process.exit(1);
}
fs.writeFileSync(path.resolve(root, summaryRel), JSON.stringify(summary, null, 2));

const mb = (b) => (b / 1048576).toFixed(1) + "MB";
console.log(
  `[deliver] ${summary.project} → ${outDir}/\n` +
    `  final.mp4          ${mb(deliverables[0].sizeBytes)}  ${video.width}x${video.height} ${video.fps}fps ${video.durationSec}s\n` +
    `  preview.mp4        ${mb(preview.sizeBytes)}  ${preview.width}x${preview.height}${scaled ? "" : " (not upscaled)"}${watermark ? " +watermark" : ""}\n` +
    `  thumbnail.jpg      @${thumb.timeSec}s  (${thumb.chosenBy})\n` +
    `  project_summary.json  tier=${tier}, photoContent=${photoContentBy}, qa=${qa.verdict}`
);
