// Apply a reusable story template to the current analyzed photos/music and emit
// a render-engine timeline. This is the Smart Lite path: template-driven story,
// no Quoc-Nhi hardcoded narrative.
//
// Usage:
//   node scripts/applyStoryTemplate.mjs --music "music/a thousand years.mp3"
//     [--template story-templates/korean-soft-romance-01.json]
//     [--photos analysis/photos.json]
//     [--brief jobs/demo/brief.json]
//     [--out timeline/korean-soft-romance-demo.json]
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};

const templatePath = arg("--template", "story-templates/korean-soft-romance-01.json");
const photosPath = arg("--photos", "analysis/photos.json");
const musicPath = arg("--music", "music/a thousand years.mp3");
const outPath = arg("--out", "timeline/korean-soft-romance-demo.json");
const briefPath = arg("--brief", "");

const template = JSON.parse(fs.readFileSync(path.resolve(root, templatePath), "utf8"));
const photosDoc = JSON.parse(fs.readFileSync(path.resolve(root, photosPath), "utf8"));
const musicName = path.basename(musicPath).replace(/\.[^.]+$/, "");
const music = JSON.parse(fs.readFileSync(path.resolve(root, `analysis/music/${musicName}.json`), "utf8"));
const brief = briefPath && fs.existsSync(path.resolve(root, briefPath))
  ? JSON.parse(fs.readFileSync(path.resolve(root, briefPath), "utf8"))
  : {};

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
  return text.replace(/\{\{(\w+)\}\}/g, (_, key) => tokens[key] || "");
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

function takeSeq(count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    let chosen = null;
    for (let n = 0; n < photos.length; n++) {
      const p = photos[(seq + n) % photos.length];
      if (!used.has(p.file)) {
        chosen = p;
        seq = (seq + n + 1) % photos.length;
        break;
      }
    }
    chosen ||= photos[seq++ % photos.length];
    used.add(chosen.file);
    out.push(chosen.file);
  }
  return out;
}

function photo(slotName, scene, fallback = {}) {
  const slot = scene.photoSlots.find((s) => s.slot === slotName) || fallback;
  return take(slot, 1);
}

function photosFor(slotName, scene, defaultCount) {
  const slot = scene.photoSlots.find((s) => s.slot === slotName) || { count: defaultCount };
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

const C = template.defaults.palette;
const F = template.defaults.fonts;
const card = template.layoutPresets.soft_card;
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

function sceneById(id) {
  return template.scenes.find((s) => s.id === id);
}

function buildLayerScene(scene) {
  const title = fill(scene.captionPattern);
  const subtitle = fill(scene.subtitlePattern || scene.fallbackSubtitlePattern || "");

  switch (scene.id) {
    case "s01_opening_title": {
      const bg = photo("background", scene);
      const left = photo("portrait_left", scene);
      const right = photo("portrait_right", scene);
      return {
        effect: "layer_scene",
        captions: [],
        layers: [
          pic(bg, 0, 0, 1920, 1080, { motion: "zoom_in" }),
          rect(0, 0, 1920, 1080, "#000000", 0.18),
          pic(left, 210, 280, 520, 560, { frame: card, animation: "slide_up", start: 0.15 }),
          pic(right, 1190, 280, 520, 560, { frame: card, animation: "slide_up", start: 0.25 }),
          rect(0, 815, 1920, 265, C.cream, 0.92, { animation: "fade", start: 0.35 }),
          txt(title, F.title, 260, 850, 1400, 125, 104, C.brown, "center", { animation: "fade", start: 0.5 }),
          txt(subtitle, F.body, 260, 975, 1400, 55, 34, C.brown, "center", { animation: "fade", start: 0.75 }),
        ],
      };
    }
    case "s02_first_chapter":
    case "s05_soft_portraits":
    case "s06_family_blessing": {
      const main = photo(scene.id === "s06_family_blessing" ? "family_hero" : "hero", scene, { orient: "portrait" });
      const support = scene.id === "s05_soft_portraits"
        ? [photo("left", scene), photo("right", scene)]
        : photosFor(scene.id === "s06_family_blessing" ? "family_support" : "supporting", scene, 2);
      return {
        effect: "layer_scene",
        captions: [],
        layers: [
          rect(0, 0, 1920, 1080, C.cream, 1),
          pic(main, 120, 120, 720, 820, { motion: "zoom_in", frame: card, animation: "slide_right", start: 0.1 }),
          pic(support[0], 1010, 135, 700, 330, { frame: card, animation: "slide_left", start: 0.25 }),
          pic(support[1], 1010, 515, 700, 330, { frame: card, animation: "slide_left", start: 0.38 }),
          txt(title, F.heading, 930, 875, 880, 130, 42, C.brown, "center", { lineSpacing: 14, animation: "fade", start: 0.65 }),
        ],
      };
    }
    case "s09_ending": {
      const bg = photo("background", scene);
      return {
        effect: "layer_scene",
        captions: [],
        layers: [
          pic(bg, 0, 0, 1920, 1080, { motion: "zoom_out" }),
          rect(0, 0, 1920, 1080, C.cream, 0.58),
          txt(title, F.title, 240, 385, 1440, 180, 140, C.brown, "center", { animation: "fade", start: 0.35 }),
          txt(subtitle || tokens.thankYouLine, F.body, 300, 620, 1320, 90, 42, C.brown, "center", { animation: "fade", start: 0.8 }),
        ],
      };
    }
    default:
      throw new Error(`No layer builder for ${scene.id}`);
  }
}

function buildScene(scene) {
  if (scene.effect === "layer_scene") return buildLayerScene(scene);
  if (scene.effect === "memory_wall") {
    return { effect: "memory_wall", images: photosFor("memories", scene, 5), captions: [cap(fill(scene.captionPattern))] };
  }
  if (scene.effect === "collage_grid") {
    return { effect: "collage_grid", images: photosFor("grid", scene, 6), captions: [cap(fill(scene.captionPattern))] };
  }
  if (scene.effect === "film_roll_left") {
    return { effect: "film_roll_left", images: photosFor("film_roll", scene, 8), captions: [cap(fill(scene.captionPattern))] };
  }
  if (scene.effect === "dark_feather") {
    return { effect: "dark_feather", image: photo("hero", scene), captions: [cap(fill(scene.captionPattern), "subtitle")] };
  }
  throw new Error(`Unsupported template effect ${scene.effect}`);
}

let t = 0;
const slides = template.scenes.map((scene, i) => {
  const isLast = i === template.scenes.length - 1;
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
    name: template.id,
    ...template.defaults.project,
  },
  music: [{ path: musicPath, volume: 0.82 }],
  audio: template.defaults.audio,
  color: template.defaults.color,
  overlays: template.defaults.overlays,
  output: { path: "output/korean-soft-romance-demo.mp4" },
  slides,
};

fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(timeline, null, 2) + "\n");
console.log(`Wrote ${outPath}: ${slides.length} scenes, ~${Math.round(t)}s, photos used ${used.size}/${photos.length}.`);
