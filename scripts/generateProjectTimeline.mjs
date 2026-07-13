import fs from "node:fs";
import path from "node:path";
import { arg, loadProject } from "./lib/project.mjs";
import { loadLedger, active, applyToTimeline } from "./lib/directives.mjs";

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
const slides = [];
let photoCursor = 0;

function caption(text, role = "caption") {
  return { text, role, position: role === "title" ? "center" : "bottom_center", start: 0.5, duration: 3.5, font, color: "white", shadow: true, animation: "fade" };
}
function nextPhoto(preferred = []) {
  const preferredPhoto = preferred.map((file) => photos.find((p) => p.file === file)).find(Boolean);
  return preferredPhoto || photos[photoCursor++ % photos.length];
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
    const photo = nextPhoto(beat.preferredPhotos);
    const effect = photo.orient === "portrait" ? "portrait_blur_background" : singleEffects[i % singleEffects.length];
    const text = i === 0 ? story.title : i === sceneCount - 1 ? story.closing : showText ? `${beat.heading} — ${beat.body}` : "";
    slides.push({ id, image: photo.file, duration: 5, effect, transition, captions: text ? [caption(text, i === 0 ? "title" : "caption")] : [] });
  }
}

slides.at(-1).transition = { type: "none", duration: 0 };
const overlap = slides.slice(0, -1).reduce((sum, slide) => sum + slide.transition.duration, 0);
const exactSceneDuration = (targetDuration + overlap) / slides.length;
if (exactSceneDuration < 2 || exactSceneDuration > 30) throw new Error(`Cannot fit ${targetDuration}s into ${slides.length} valid scenes`);
for (const slide of slides) slide.duration = +exactSceneDuration.toFixed(3);

const timeline = {
  project: { name: project.manifest.id, width: 1920, height: 1080, fps: 30, quality: project.manifest.quality || "share" },
  music: musicRel ? [{ path: project.rel(musicRel), volume: 0.85 }] : [],
  audio: { fade_in: 2, fade_out: 3, crossfade: 2 },
  output: { path: project.rel(project.manifest.output) },
  color: { temperature: 5700, saturation: 1.04, contrast: 1.02, glow: 0.1 },
  metadata: { storyTemplate: project.rel(project.manifest.story || "analysis/story-template.generated.json"), targetDuration },
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
if (orders.length) console.log(`  directives: ${appliedIds.length}/${orders.length} applied by the lite generator`);
