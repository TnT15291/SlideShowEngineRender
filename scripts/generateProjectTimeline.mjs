import fs from "node:fs";
import path from "node:path";
import { arg, loadProject } from "./lib/project.mjs";
import { loadLedger, active, applyToTimeline } from "./lib/directives.mjs";
import { retimeSlidesToMusic } from "./lib/musicRetime.mjs";
import { validateMusicAnalysis } from "./lib/musicAnalysis.mjs";
import { bucketPeople } from "./lib/diversityPlanner.mjs";

const project = loadProject(arg("--project"));
const read = (p) => JSON.parse(fs.readFileSync(project.abs(p), "utf8"));
const selectedRel = project.manifest.selectedPhotos || "analysis/photos.selected.json";
const photosDoc = read(fs.existsSync(project.abs(selectedRel)) ? selectedRel : `${project.manifest.analysisDir}/photos.json`);
const story = read(project.manifest.story || "analysis/story-template.generated.json");
const photos = [...photosDoc.photos];
if (!photos.length) throw new Error("Project has no analyzed photos");

const musicRel = (project.manifest.music || [])[0];
let music = null;
if (musicRel) {
  const p = `${project.manifest.analysisDir}/music/${path.parse(musicRel).name}.json`;
  if (fs.existsSync(project.abs(p))) music = read(p);
}

const transitions = ["crossfade", "dissolve", "smooth_left", "smooth_right"];
const singleEffects = ["slow_zoom_in", "kenburns_tl", "slow_zoom_out", "kenburns_br", "pan_left", "pan_right"];
const font = "fonts/BeVietnamPro-Regular.ttf";
const beats = story.beats || [];
const targetDuration = music?.duration || Math.max(15, photos.length * 5);
const transitionDuration = 0.7;
// About 5.5 visible seconds per scene. Reuse is allowed only when the song is
// longer than the available photo set can cover once.
const sceneCount = Math.max(beats.length + 1, Math.ceil((targetDuration - transitionDuration) / 5.5));
let slides = [];
let photoCursor = 0;

// Bookends get the photo the analyzer scored for that job, not whatever the round-robin
// cursor happens to land on. photos.json already carries openingScore/closingScore
// (the same fields the premium tier's hero-check reuses) — Lite just never read them.
const scored = (photo, key) => Number(photo?.[key] ?? photo?.heroScore ?? 0);
const bestBy = (pool, key) => [...pool].sort((a, b) => scored(b, key) - scored(a, key))[0];
const openingPhoto = bestBy(photos, "openingScore");
const closingCandidates = photos.filter((p) => p.file !== openingPhoto.file);
const closingPhoto = bestBy(closingCandidates.length ? closingCandidates : photos, "closingScore");

// Reserved bookends only leave the general cycle when the pool can spare them —
// a tiny album still needs every photo available for the body of the film.
const reserved = photos.length > 2 ? new Set([openingPhoto.file, closingPhoto.file]) : new Set();
const cyclePool = photos.filter((p) => !reserved.has(p.file));
const pool = cyclePool.length ? cyclePool : photos;
let lastPicked = null;

function caption(text, role = "caption") {
  return { text, role, position: role === "title" ? "center" : "bottom_center", start: 0.5, duration: 3.5, font, color: "white", shadow: true, animation: "fade" };
}
// Same signals as the template tier's diversityPlanner (orientation + people-count
// bucket), scaled down to Lite's flat photo list: no "requests"/"slots" to solve
// against, just a short lookahead swap so two same-shaped photos are less likely to
// land on neighbouring scenes. "unknown" people counts never testify as a match.
function samePattern(a, b) {
  if (!a || !b || a.orient !== b.orient) return false;
  const bucketA = bucketPeople(a.subjectCount);
  return bucketA !== "unknown" && bucketA === bucketPeople(b.subjectCount);
}
function conflictsWith(a, b) {
  if (!a || !b) return false;
  if (a.file === b.file) return true;
  if (a.duplicateGroup && a.duplicateGroup === b.duplicateGroup) return true;
  return samePattern(a, b);
}
function preferredPhoto(preferred, avoid = null) {
  return preferred.map((file) => photos.find((p) => p.file === file && !conflictsWith(p, avoid))).find(Boolean);
}
function nextPhoto(preferred = []) {
  const chosen = preferredPhoto(preferred, lastPicked);
  if (chosen) return (lastPicked = chosen);
  const i = photoCursor % pool.length;
  if (conflictsWith(pool[i], lastPicked)) {
    const window = Math.min(pool.length - 1, 4);
    for (let step = 1; step <= window; step++) {
      const j = (i + step) % pool.length;
      if (!conflictsWith(pool[j], lastPicked)) {
        [pool[i], pool[j]] = [pool[j], pool[i]];
        break;
      }
    }
  }
  photoCursor++;
  if (conflictsWith(pool[i], lastPicked)) {
    const fallback = photos.find((photo) => !conflictsWith(photo, lastPicked));
    if (fallback) return (lastPicked = fallback);
  }
  return (lastPicked = pool[i]);
}

for (let i = 0; i < sceneCount; i++) {
  const beatIndex = Math.min(beats.length - 1, Math.floor(i * beats.length / sceneCount));
  const beat = beats[Math.max(0, beatIndex)] || { heading: "", body: "", sceneKind: "single", preferredPhotos: [] };
  const id = `scene_${String(i + 1).padStart(3, "0")}`;
  const transition = { type: transitions[i % transitions.length], duration: transitionDuration };
  const showText = i === 0 || i === sceneCount - 1 || i % Math.max(2, Math.floor(sceneCount / Math.max(1, beats.length))) === 0;
  if (beat.sceneKind === "montage" && i > 0 && i < sceneCount - 1) {
    const count = Math.min(6, Math.max(3, photos.length));
    const images = Array.from({ length: count }, () => nextPhoto(beat.preferredPhotos).file);
    slides.push({ id, images, duration: 5, effect: i % 2 ? "film_roll_up" : "collage_grid", transition, captions: showText ? [caption(`${beat.heading} — ${beat.body}`)] : [] });
  } else {
    // Bookends: the beat's own preference still wins (a story beat that names a file is a
    // more specific signal than the generic hero heuristic), otherwise the analyzer's
    // opening/closing score picks the photo instead of whatever the cursor lands on.
    const closingFallback = !conflictsWith(closingPhoto, lastPicked)
      ? closingPhoto
      : bestBy(photos.filter((p) => !conflictsWith(p, lastPicked)), "closingScore") || closingPhoto;
    const photo = i === 0 ? preferredPhoto(beat.preferredPhotos) || openingPhoto
      : i === sceneCount - 1 ? preferredPhoto(beat.preferredPhotos, lastPicked) || closingFallback
      : nextPhoto(beat.preferredPhotos);
    if (i === 0 || i === sceneCount - 1) lastPicked = photo;
    const effect = photo.orient === "portrait" ? "portrait_blur_background" : singleEffects[i % singleEffects.length];
    const text = i === 0 ? story.title : i === sceneCount - 1 ? story.closing : showText ? `${beat.heading} — ${beat.body}` : "";
    // Carry the analyzer's face-derived focus onto the slide. Without it the renderer
    // cover-crops dead centre, which beheads a portrait photo in a 16:9 frame — heads sit
    // at the top and the top is exactly what a centre crop throws away. The whole face
    // pipeline (YuNet -> faces[] -> focusX/focusY) used to stop in photos.json and reach
    // nothing; this is the line that connects it to the pixels.
    slides.push({
      id, image: photo.file, duration: 5, effect, transition,
      ...(Number.isFinite(photo.focusX) ? { focusX: photo.focusX } : {}),
      ...(Number.isFinite(photo.focusY) ? { focusY: photo.focusY } : {}),
      ...(photo.faceBoxEstimate ? { faceBox: photo.faceBoxEstimate } : {}),
      captions: text ? [caption(text, i === 0 ? "title" : "caption")] : [],
    });
  }
}

slides.at(-1).transition = { type: "none", duration: 0 };
// Prefer phrase/downbeat-aware retiming (same lib the template tier uses) whenever the
// music analysis actually carries that structure. A project with no music, or an older/
// stub analysis missing beatGrid/phrases, falls back to the flat even split — Lite must
// still work without music (see runProject.mjs).
let musicSync = null;
if (music && validateMusicAnalysis(music).ok) {
  const retimed = retimeSlidesToMusic(slides, music);
  slides = retimed.slides;
  musicSync = retimed.sync;
} else {
  const overlap = slides.slice(0, -1).reduce((sum, slide) => sum + slide.transition.duration, 0);
  const exactSceneDuration = (targetDuration + overlap) / slides.length;
  if (exactSceneDuration < 2 || exactSceneDuration > 30) throw new Error(`Cannot fit ${targetDuration}s into ${slides.length} valid scenes`);
  for (const slide of slides) slide.duration = +exactSceneDuration.toFixed(3);
}

const timeline = {
  project: { name: project.manifest.id, width: 1920, height: 1080, fps: 30, quality: project.manifest.quality || "share" },
  music: musicRel ? [{ path: project.rel(musicRel), volume: 0.85 }] : [],
  audio: { fade_in: 2, fade_out: 3, crossfade: 2 },
  output: { path: project.rel(project.manifest.output) },
  color: { temperature: 5700, saturation: 1.04, contrast: 1.02, glow: 0.1 },
  metadata: { storyTemplate: project.rel(project.manifest.story || "analysis/story-template.generated.json"), targetDuration, ...(musicSync ? { musicSync } : {}) },
  slides,
};
// The cheap tier still has to do as it is told. Lite cannot honour everything — it has no
// acts, so an act-scoped order has nowhere to land — but colour, overlays, transitions,
// captions, a whole-film look and the running time it CAN do, and applyToTimeline is the
// one place all three tiers agree on how. What Lite genuinely cannot do, the compliance
// report says out loud rather than passing over in silence.
const ledger = fs.existsSync(project.abs("directives.json")) ? loadLedger(project.rel("directives.json")) : { directives: [] };
const orders = active(ledger);
const appliedIds = orders.length ? applyToTimeline(timeline, orders) : [];

const out = project.abs(project.manifest.timeline);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(timeline, null, 2) + "\n");
const finalOverlap = slides.reduce((n, s) => n + (s.transition?.duration || 0), 0);
const actual = slides.reduce((n, s) => n + s.duration, 0) - finalOverlap;
console.log(`Wrote ${project.rel(project.manifest.timeline)}: ${slides.length} scene(s), ${actual.toFixed(2)}s / target ${targetDuration.toFixed(2)}s.`);
console.log(`  pacing: ${musicSync ? `music-aware (${musicSync.snappedBoundaries} phrase/downbeat snaps)` : "flat split (no usable music analysis)"}`);
if (orders.length) console.log(`  directives: ${appliedIds.length}/${orders.length} applied by the lite generator`);
