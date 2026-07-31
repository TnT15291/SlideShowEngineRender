#!/usr/bin/env node
// Build a visual probe timeline for layout primitives, straight from layouts/library.json.
//
// P1.7's gate is "a human looks at each new layout once, before it is wired into a recipe".
// A probe whose coordinates are hand-copied out of the library cannot serve that gate: it
// drifts the moment a layout is edited, and it silently keeps passing. This reads the library
// instead, so the frame you review is the frame the library actually describes.
//
// It also insists on real photographs. Synthetic noise renders every layout "correctly" —
// crop damage, missing depth cues and dead space are all invisible against noise.
//
// Usage:
//   node scripts/renderPrimitiveProbe.mjs --photos <dir> [--out temp/probe.json] [--ids a,b,c]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ACTIVE_PRIMITIVES = [
  "overlap_stack_duo",
  "inset_card_hero",
  "circle_trio_stagger",
  "diagonal_staircase_trio",
  "golden_column_pair",
  "stacked_horizon_trio",
  "offset_portrait_hero",
];

// Sample copy per layout, keyed by text slot role. Long enough to show wrapping.
const SAMPLE_TEXT = {
  heading: "NGÀY CHUNG ĐÔI",
  subheading: "Sài Gòn, mùa thu",
  body: "Chúng mình đã đi một quãng đường dài để đến được ngày hôm nay.",
  caption: "Ảnh: studio",
};

function parseArgs(argv) {
  const args = { out: "temp/probe-primitives-real.json", ids: ACTIVE_PRIMITIVES };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === "--photos") args.photos = argv[++i];
    else if (flag === "--out") args.out = argv[++i];
    else if (flag === "--ids") args.ids = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (!args.photos) {
    console.error("usage: node scripts/renderPrimitiveProbe.mjs --photos <dir> [--out f.json] [--ids a,b]");
    process.exit(2);
  }
  return args;
}

// A layout's own frame reference may be an inline object or the name of a
// designTokens.framePreset. The renderer resolves the same two forms.
function resolveFrame(frame, library) {
  if (!frame) return undefined;
  if (typeof frame === "object") return frame;
  const preset = library.designTokens?.framePreset?.[frame];
  if (!preset) throw new Error(`unknown frame preset '${frame}'`);
  return preset;
}

function resolveColor(color, library) {
  if (typeof color !== "string") return "#8A7355";
  if (!color.startsWith("theme.")) return color;
  const token = color.slice("theme.".length);
  return library.designTokens?.palette?.[token] ?? library.designTokens?.color?.[token] ?? "#8A7355";
}

// Give each slot the photograph whose aspect is nearest to it, the way the solver's
// orientation matching would, and do not reuse one until the pool is exhausted.
// Ranking slots against the whole pool instead would hand three identical wide bands
// the three most portrait photographs — a probe artefact that reads as a layout fault.
function assignPhotos(slots, photos) {
  const chosen = new Map();
  const unused = [...photos];
  for (const slot of slots) {
    const want = slot.width / slot.height;
    const pool = unused.length > 0 ? unused : photos;
    let best = 0;
    for (let i = 1; i < pool.length; i++) {
      const d = Math.abs(Math.log(pool[i].width / pool[i].height / want));
      if (d < Math.abs(Math.log(pool[best].width / pool[best].height / want))) best = i;
    }
    chosen.set(slot.id, pool[best].path);
    if (unused.length > 0) unused.splice(best, 1);
  }
  return chosen;
}

function buildSlide(layout, library, photos, index) {
  const cream = library.designTokens?.palette?.cream ?? "#FBF6ED";
  const layers = [];
  const fullBleedSlot =
    layout.background?.type === "photo_full_bleed" ? layout.background.slot : undefined;

  const photoSlots = layout.photoSlots ?? [];
  const assignment = assignPhotos(photoSlots, photos);

  if (!fullBleedSlot) {
    layers.push({ type: "rect", x: 0, y: 0, width: 1920, height: 1080, color: cream });
  }

  // Panels without z:"over_photos" sit BEHIND the photographs — that is where
  // layerSceneBuilder.mjs puts them, and a matte panel is only a matte if the
  // photo covers it. Emitting them after the photos would render a probe that
  // does not match what a recipe would produce.
  const panels = layout.panels ?? [];
  const pushPanel = (panel) =>
    layers.push({
      type: "rect",
      x: panel.x,
      y: panel.y,
      width: panel.width,
      height: panel.height,
      color: resolveColor(panel.color, library),
      ...(panel.opacity !== undefined ? { opacity: panel.opacity } : {}),
    });
  for (const panel of panels.filter((p) => p.z !== "over_photos")) pushPanel(panel);

  let start = 0.15;
  for (const slot of photoSlots) {
    const frame = resolveFrame(slot.frame, library);
    layers.push({
      id: slot.id,
      type: "image",
      path: assignment.get(slot.id),
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      fit: slot.fit ?? "cover",
      ...(slot.rotation ? { rotation: slot.rotation } : {}),
      ...(frame ? { frame } : {}),
      animation: slot.suggestedAnimation ?? "fade",
      start: slot.id === fullBleedSlot ? 0 : start,
    });
    start += 0.1;
  }

  for (const panel of panels.filter((p) => p.z === "over_photos")) pushPanel(panel);

  for (const slot of layout.textSlots ?? []) {
    layers.push({
      id: slot.id,
      type: "text",
      text: SAMPLE_TEXT[slot.role] ?? SAMPLE_TEXT.heading,
      font: "fonts/PlayfairDisplay.ttf",
      x: slot.x,
      y: slot.y,
      width: slot.width,
      height: slot.height,
      size: slot.sizePx ?? 64,
      color: fullBleedSlot ? "#FFFFFF" : "#2D2D33",
      align: slot.align ?? "left",
      wrap: true,
      animation: "fade",
      start: 0.35,
    });
  }

  const [minDur] = layout.durationRange ?? [5, 6];
  return {
    id: layout.id,
    duration: minDur,
    effect: "layer_scene",
    layers,
    // No crossfade: every scene boundary stays a hard cut so a extracted frame is
    // never half of two layouts.
    transition: { type: "none", duration: 0 },
    captions: [],
    _index: index,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const library = JSON.parse(fs.readFileSync("layouts/library.json", "utf8"));

  const photos = fs
    .readdirSync(args.photos)
    .filter((f) => /\.(jpe?g|png)$/i.test(f))
    .map((f) => path.join(args.photos, f).replace(/\\/g, "/"));
  if (photos.length === 0) throw new Error(`no photographs in ${args.photos}`);

  // Read real pixel sizes so portrait/landscape assignment is honest.
  const sized = photos.map((p) => {
    const out = execFileSync(
      process.env.FFPROBE_PATH ?? "ffprobe",
      ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", p],
      { encoding: "utf8" }
    ).trim();
    const [width, height] = out.split(",").map(Number);
    return { path: p, width, height };
  });

  const slides = args.ids.map((id, i) => {
    const layout = library.layouts.find((l) => l.id === id);
    if (!layout) throw new Error(`layout '${id}' not in library`);
    return buildSlide(layout, library, sized, i);
  });

  const timeline = {
    project: { name: "layout-primitives-probe-real", width: 1920, height: 1080, fps: 30, quality: "draft" },
    music: [],
    audio: { fade_in: 0, fade_out: 0, crossfade: 0 },
    output: { path: args.out.replace(/\.json$/, ".mp4") },
    overlays: [],
    slides: slides.map(({ _index, ...slide }) => slide),
  };

  fs.writeFileSync(args.out, JSON.stringify(timeline, null, 2));

  // Frame-accurate seek points, so review never lands on a boundary.
  let t = 0;
  const marks = slides.map((slide) => {
    const mid = t + slide.duration / 2;
    t += slide.duration;
    return `${slide.id}\t${mid.toFixed(2)}`;
  });
  console.log(`[probe] ${args.out} — ${slides.length} scene(s), ${t.toFixed(2)}s, ${sized.length} photo(s)`);
  console.log(marks.join("\n"));
}

main();
