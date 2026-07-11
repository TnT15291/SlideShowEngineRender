// Apply a reusable story template to the current analyzed photos/music and emit
// a render-engine timeline. This is the Smart Lite path: template-driven story,
// no hardcoded narrative.
//
// Geometry is NOT computed here. Every layer_scene scene names a layout in
// layouts/library.json; this script only resolves photoSlots -> image paths,
// fills {{tokens}} into the layout's text slots, picks durations from music
// energy, then emits valid timeline JSON. Adding a new template = writing a new
// JSON recipe (which layouts, in what order, with what copy) -- no code change.
//
// Usage:
//   node scripts/applyStoryTemplate.mjs --music "music/a thousand years.mp3"
//     [--template story-templates/warm-film-01.json]
//     [--photos analysis/photos.json]
//     [--library layouts/library.json]
//     [--brief jobs/demo/brief.json]
//     [--out timeline/<template-id>.json]
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const templatePath = arg("--template", "story-templates/warm-film-01.json");
const photosPath = arg("--photos", "analysis/photos.json");
const musicPath = arg("--music", "music/a thousand years.mp3");
const libraryPath = arg("--library", "layouts/library.json");
const briefPath = arg("--brief", "");
// A project run redirects these so two customers on the same recipe never share a
// music analysis, an output file or a project name. Defaults are the old root paths.
const analysisDir = arg("--analysis-dir", "analysis").replace(/\\/g, "/").replace(/\/$/, "");

const template = JSON.parse(fs.readFileSync(path.resolve(root, templatePath), "utf8"));
const library = JSON.parse(fs.readFileSync(path.resolve(root, libraryPath), "utf8"));
const photosDoc = JSON.parse(fs.readFileSync(path.resolve(root, photosPath), "utf8"));
const musicName = path.basename(musicPath).replace(/\.[^.]+$/, "");
const music = JSON.parse(fs.readFileSync(path.resolve(root, `${analysisDir}/music/${musicName}.json`), "utf8"));
const videoOut = arg("--output", `output/${template.id}.mp4`);
const projectName = arg("--name", template.id);
const qualityOverride = arg("--quality", "");
const brief = briefPath && fs.existsSync(path.resolve(root, briefPath))
  ? JSON.parse(fs.readFileSync(path.resolve(root, briefPath), "utf8"))
  : {};

const outPath = arg("--out", `timeline/${template.id}.json`);

const tokens = {
  bride: brief.bride || "Bride",
  groom: brief.groom || "Groom",
  date: brief.date || "Our Wedding Day",
  location: brief.location || "Together",
  meetingPlace: brief.meetingPlace || "",
  yearsTogether: brief.yearsTogether || "",
  thankYouLine: brief.thankYouLine || "Thank you for being part of our story",
};

function fill(text = "") {
  return String(text).replace(/\{\{(\w+)\}\}/g, (_, key) => tokens[key] || "");
}

const photos = photosDoc.photos || [];
if (photos.length === 0) throw new Error(`${photosPath} has no photos`);

const byFile = new Map(photos.map((p) => [p.file, p]));
const used = new Set();
const byQuality = [...photos].sort((a, b) =>
  (b.qualityNorm ?? 0) - (a.qualityNorm ?? 0) ||
  (b.sharpness ?? 0) - (a.sharpness ?? 0)
);
let seq = 0;

function scorePhoto(p, slot) {
  let score = (p.qualityNorm ?? 0) * 10 + (p.sharpness ?? 0) * 0.02;
  if (slot.orient && slot.orient !== "any" && p.orient === slot.orient) score += 5;
  if ((p.meanLuma ?? 128) < (template.timelineRules?.photoSelection?.darkPhotoMaxMeanLuma ?? 75)) score -= 5;
  return score;
}

function take(slot = {}, count = 1) {
  const picked = [];
  for (let i = 0; i < count; i++) {
    const candidates = byQuality
      .filter((p) => !used.has(p.file))
      .filter((p) => !slot.orient || slot.orient === "any" || p.orient === slot.orient)
      .sort((a, b) => scorePhoto(b, slot) - scorePhoto(a, slot));
    const fallback = byQuality.find((p) => !used.has(p.file)) || photos[seq++ % photos.length];
    const chosen = candidates[0] || fallback;
    used.add(chosen.file);
    picked.push(chosen.file);
  }
  return count === 1 ? picked[0] : picked;
}

function photo(slotName, scene, fallback = {}) {
  const slot = (scene.photoSlots || []).find((s) => s.slot === slotName) || fallback;
  return take(slot, 1);
}

function photosFor(slotName, scene, defaultCount) {
  const slot = (scene.photoSlots || []).find((s) => s.slot === slotName) || { count: defaultCount };
  return take(slot, slot.count || defaultCount);
}

function pic(file, x, y, width, height, extra = {}) {
  const p = byFile.get(file) || {};
  return {
    type: "image",
    path: file,
    x, y, width, height,
    fit: "cover",
    focusX: p.focusX ?? 0.5,
    focusY: p.focusY ?? 0.45,
    ...extra,
  };
}

const rect = (x, y, width, height, color, opacity, extra = {}) =>
  ({ type: "rect", x, y, width, height, color, opacity, ...extra });
const txt = (text, font, x, y, width, height, size, color, align = "center", extra = {}) =>
  ({ type: "text", text, font, x, y, width, height, size, color, align, wrap: true, ...extra });
const cap = (text, role = "caption") => ({
  text,
  role,
  position: "bottom_center",
  start: 0.6,
  duration: 3.8,
  color: "white",
  shadow: true,
  animation: "fade",
});

function energyAt(t) {
  const env = music.envelope || [];
  return env.length ? env[Math.min(env.length - 1, Math.round(t / 0.5))] ?? 0.5 : 0.5;
}

function durationFor(role, t) {
  const d = template.timelineRules.durationStrategy;
  const e = energyAt(t);
  if (role === "calm") return d.calmSceneSec;
  if (role === "build") return Math.max(d.buildSceneSec, d.baseSceneSec - e);
  if (role === "montage") return d.montageSec;
  if (role === "closing") return d.closingSec;
  return d.baseSceneSec;
}

function transitionFor(role, isLast) {
  const t = template.timelineRules.transitionStrategy;
  if (isLast) return t.final;
  return t[role] || t.default;
}

function scenePhotoCount(scene) {
  if (scene.effect === "video_background") return 0;
  if (scene.effect === "layer_scene") {
    const layout = (library.layouts || []).find((l) => l.id === scene.layout);
    return layout?.photoSlots?.length || 0;
  }
  return (scene.photoSlots || []).reduce((sum, slot) => sum + (slot.count || 1), 0);
}

function expandScenes() {
  const base = template.scenes.map((scene) => ({ ...scene }));
  const repeatable = base.filter((scene) => scene.repeatable);
  if (repeatable.length === 0) return base;

  const closingIndex = base.findIndex((scene) => scene.durationRole === "closing");
  const insertAt = closingIndex >= 0 ? closingIndex : base.length;
  const fixedDuration = base.reduce((sum, scene) => sum + durationFor(scene.durationRole, sum), 0);
  const fixedPhotos = base.reduce((sum, scene) => sum + scenePhotoCount(scene), 0);
  const targetDuration = Number(music.duration) || fixedDuration;
  let duration = fixedDuration;
  let photoCount = fixedPhotos;
  let round = 1;
  const extra = [];

  while (duration < targetDuration && photoCount < photos.length) {
    let added = false;
    for (const scene of repeatable) {
      const photoNeed = scenePhotoCount(scene);
      if (photoNeed > 0 && photoCount + photoNeed > photos.length) continue;
      const copyDuration = durationFor(scene.durationRole, duration);
      if (duration + copyDuration / 2 > targetDuration) continue;
      extra.push({ ...scene, id: `${scene.id}_r${round}` });
      duration += copyDuration;
      photoCount += photoNeed;
      added = true;
    }
    if (!added) break;
    round++;
  }

  return [...base.slice(0, insertAt), ...extra, ...base.slice(insertAt)];
}

// ---------- library-driven layer_scene builder ----------
// The story-template scene names a layout id; the layout owns all pixel
// geometry. The scene only refines photo selection per slot (orient/quality/
// motion/frame) and supplies copy keyed by the layout's text-slot ids.

const themeRef = template.libraryTheme || "white_weddings";
const libTheme = () => (library.designTokens?.themes || {})[themeRef] || {};

function resolveColor(spec) {
  if (typeof spec !== "string") return "#000000";
  if (spec.startsWith("theme.")) {
    const th = libTheme();
    return th.palette?.[spec.slice(6)] || th.background || "#000000";
  }
  return spec;
}

function resolveFont(role) {
  const th = libTheme();
  return th.fonts?.[role]
    || template.defaults?.fonts?.[role]
    || template.defaults?.fonts?.body
    || "fonts/BeVietnamPro-Regular.ttf";
}

function resolveFrame(name) {
  if (!name) return undefined;
  if (typeof name === "object") return name;
  return template.layoutPresets?.[name] || library.designTokens?.framePreset?.[name] || undefined;
}

function hexLuma(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return 255; // named colors: assume light
  const v = parseInt(m[1], 16);
  return 0.2126 * ((v >> 16) & 255) + 0.7152 * ((v >> 8) & 255) + 0.0722 * (v & 255);
}

function themeInk() {
  const pal = libTheme().palette || {};
  return pal.text || pal.warm_brown || pal.ink_dark || template.defaults?.palette?.brown || "#2D2D33";
}

// Over a full-bleed photo, text is white unless a LIGHT panel backs it; over a
// dark scrim panel it stays white. On solid theme backgrounds use theme ink.
function defaultTextColor(slot, layout) {
  if (layout.background?.type !== "photo_full_bleed") return themeInk();
  const cx = slot.x + slot.width / 2;
  const cy = slot.y + slot.height / 2;
  const backing = (layout.panels || []).find(
    (p) => cx >= p.x && cx <= p.x + p.width && cy >= p.y && cy <= p.y + p.height
  );
  if (!backing || hexLuma(resolveColor(backing.color)) < 140) return "#FFFFFF";
  return themeInk();
}

const stagger = () => library.designTokens?.motionPresets?.staggerSeconds || {};
function photoStart(idx) {
  const s = stagger();
  return +(((s.photoBase ?? 0.15) + idx * (s.photoStep ?? 0.1))).toFixed(2);
}
function textStart(role) {
  const s = stagger();
  return ["heading", "eyebrow", "display", "names"].includes(role) ? (s.heading ?? 0.2) : (s.body ?? 0.5);
}

function buildLayerSceneFromLayout(scene) {
  const layout = (library.layouts || []).find((l) => l.id === scene.layout);
  if (!layout) throw new Error(`Scene ${scene.id}: unknown layout '${scene.layout}' (not in ${libraryPath})`);
  const canvas = library.meta?.canvas || { width: 1920, height: 1080 };
  const bg = layout.background || { type: "cream" };
  const bgSlotId = bg.type === "photo_full_bleed" ? bg.slot : null;
  const defOf = (id) => (scene.photoSlots || []).find((s) => s.slot === id) || {};
  const layers = [];

  // 1) background: full-bleed photo or a solid theme fill.
  if (bg.type === "photo_full_bleed") {
    const slot = (layout.photoSlots || []).find((s) => s.id === bgSlotId)
      || { x: 0, y: 0, width: canvas.width, height: canvas.height };
    const def = defOf(bgSlotId);
    const file = take({ orient: def.orient }, 1);
    layers.push(pic(file, slot.x, slot.y, slot.width, slot.height, {
      fit: def.fit || slot.fit || "cover",
      ...(def.motion ? { motion: def.motion } : {}),
    }));
  } else {
    const bgColor = bg.type === "cream"
      ? (libTheme().background || "#FBF6ED")
      : resolveColor(bg.color || "#000000");
    layers.push(rect(0, 0, canvas.width, canvas.height, bgColor, 1));
  }

  // 2) panels (scrims / title pills), drawn above the background. Panels with
  //    z:"over_photos" wait until after the photo layers (e.g. a scrim that
  //    must darken foreground photos so text stays legible).
  const allPanels = layout.panels || [];
  for (const p of allPanels.filter((p) => p.z !== "over_photos")) {
    layers.push(rect(p.x, p.y, p.width, p.height, resolveColor(p.color), p.opacity ?? 1));
  }

  // 3) photo slots: the layout drives how many + where; the scene refines
  //    which photo lands in each (orientation, quality, motion, frame).
  let pIdx = 0;
  for (const slot of layout.photoSlots || []) {
    if (slot.id === bgSlotId) continue;
    const def = defOf(slot.id);
    const file = take({ orient: def.orient }, 1);
    const frame = resolveFrame(def.frame || slot.frame);
    const anim = def.animation || slot.suggestedAnimation;
    const animated = anim && anim !== "none";
    layers.push(pic(file, slot.x, slot.y, slot.width, slot.height, {
      fit: def.fit || slot.fit || "cover",
      ...(def.motion ? { motion: def.motion } : {}),
      ...(frame ? { frame } : {}),
      ...(slot.rotation != null ? { rotation: slot.rotation } : {}),
      ...(animated ? { animation: anim, start: photoStart(pIdx) } : {}),
    }));
    pIdx++;
  }

  // 4) panels layered over the photos (text-legibility scrims).
  for (const p of allPanels.filter((p) => p.z === "over_photos")) {
    layers.push(rect(p.x, p.y, p.width, p.height, resolveColor(p.color), p.opacity ?? 1));
  }

  // 5) optional full-frame decor PNG (1920x1080 wedding frame) under the text.
  if (scene.frameOverlay) {
    layers.push({
      type: "image", path: scene.frameOverlay,
      x: 0, y: 0, width: canvas.width, height: canvas.height,
      fit: "stretch",
    });
  }

  // 6) text slots: only render the ones this scene supplies copy for.
  for (const slot of layout.textSlots || []) {
    const raw = scene.text ? scene.text[slot.id] : undefined;
    const obj = raw && typeof raw === "object" ? raw : null;
    const value = fill(obj ? obj.value : raw);
    if (!value) continue;
    const role = obj?.fontRole || slot.fontRole || "body";
    layers.push(txt(
      value,
      resolveFont(role),
      slot.x, slot.y, slot.width, slot.height,
      obj?.sizePx || slot.sizePx || 40,
      obj?.color || slot.color || defaultTextColor(slot, layout),
      slot.align || "left",
      {
        ...(slot.lineSpacing ? { lineSpacing: slot.lineSpacing } : {}),
        animation: "fade",
        start: textStart(slot.role),
      }
    ));
  }

  return { effect: "layer_scene", captions: [], layers };
}

// Emit a caption only when the scene actually supplies copy — recipes that want
// "photos only" montage beats just omit captionPattern.
const capsFor = (pattern, role = "caption") => {
  const t = fill(pattern);
  return t ? [cap(t, role)] : [];
};

// Whole-slide effects that take one photo (slot "hero" in the recipe).
const SINGLE_IMAGE_EFFECTS = new Set([
  "still", "slow_zoom_in", "slow_zoom_out",
  "pan_left", "pan_right", "pan_up", "pan_down",
  "kenburns_tl", "kenburns_tr", "kenburns_bl", "kenburns_br",
  "portrait_blur_background", "polaroid", "circle_focus", "dark_feather",
]);
// The engine only accepts `easing` on zoom/pan/kenburns effects.
const EASING_EFFECTS = new Set([
  "slow_zoom_in", "slow_zoom_out",
  "pan_left", "pan_right", "pan_up", "pan_down",
  "kenburns_tl", "kenburns_tr", "kenburns_bl", "kenburns_br",
]);

function buildScene(scene) {
  if (scene.effect === "layer_scene") return buildLayerSceneFromLayout(scene);
  if (scene.effect === "memory_wall") {
    return { effect: "memory_wall", images: photosFor("memories", scene, 5), captions: capsFor(scene.captionPattern) };
  }
  if (scene.effect === "collage_grid") {
    return { effect: "collage_grid", images: photosFor("grid", scene, 6), captions: capsFor(scene.captionPattern) };
  }
  if (scene.effect === "film_roll_left" || scene.effect === "film_roll_up" || scene.effect === "film_roll_right") {
    return { effect: scene.effect, images: photosFor("film_roll", scene, 8), captions: capsFor(scene.captionPattern) };
  }
  if (scene.effect === "double_exposure") {
    return { effect: "double_exposure", images: photosFor("pair", scene, 2), captions: capsFor(scene.captionPattern) };
  }
  if (scene.effect === "video_background") {
    if (!scene.background) throw new Error(`Scene ${scene.id}: video_background needs a 'background' video path`);
    return { effect: "video_background", background: scene.background, captions: capsFor(scene.captionPattern) };
  }
  if (scene.effect === "mask_reveal") {
    return {
      effect: "mask_reveal",
      image: photo("hero", scene),
      mask: scene.mask || "assets/masks/particle_gather.mp4",
      captions: capsFor(scene.captionPattern),
    };
  }
  if (SINGLE_IMAGE_EFFECTS.has(scene.effect)) {
    const role = scene.effect === "dark_feather" ? "subtitle" : "caption";
    const slide = { effect: scene.effect, image: photo("hero", scene), captions: capsFor(scene.captionPattern, role) };
    if (scene.easing && EASING_EFFECTS.has(scene.effect)) slide.easing = scene.easing;
    return slide;
  }
  throw new Error(`Unsupported template effect ${scene.effect}`);
}

let t = 0;
const expandedScenes = expandScenes();
const slides = expandedScenes.map((scene, i) => {
  const isLast = i === expandedScenes.length - 1;
  const duration = durationFor(scene.durationRole, t);
  const transition = transitionFor(scene.transitionRole, isLast);
  const slide = {
    id: scene.id,
    duration,
    ...buildScene(scene),
    transition,
  };
  t += Math.max(0, duration - transition.duration);
  return slide;
});

const timeline = {
  project: {
    name: projectName,
    ...template.defaults.project,
    ...(qualityOverride ? { quality: qualityOverride } : {}),
  },
  music: [{ path: musicPath, volume: 0.82 }],
  audio: template.defaults.audio,
  color: template.defaults.color,
  overlays: template.defaults.overlays,
  output: { path: videoOut },
  slides,
};

fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(timeline, null, 2) + "\n");
console.log(`Wrote ${outPath}: ${slides.length} scenes, ~${Math.round(t)}s, photos used ${used.size}/${photos.length}.`);
