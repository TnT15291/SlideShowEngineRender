import fs from "node:fs";
import path from "node:path";
import { arg, loadProject } from "./lib/project.mjs";
import { probeMedia, resolveFfmpeg } from "./lib/mediaTools.mjs";
import { EASING_EFFECTS } from "./lib/engineCapabilities.mjs";
import { planGroups, renderedDuration, transitionFor } from "./lib/narratedTimeline.mjs";

const project = loadProject(arg("--project"));
const scriptPath = path.join(project.dir, "script", "script.json");
const narrationPath = path.join(project.dir, "voice", "narration.json");
const narrationWav = path.join(project.dir, "voice", "narration.wav");
for (const file of [scriptPath, narrationPath, narrationWav]) {
  if (!fs.existsSync(file)) throw new Error(`Required input not found: ${file}`);
}
const script = JSON.parse(fs.readFileSync(scriptPath, "utf8"));
const narration = JSON.parse(fs.readFileSync(narrationPath, "utf8"));
if (script.reviewStatus !== "approved" && !process.argv.includes("--allow-unapproved")) {
  throw new Error(`Content review gate is "${script.reviewStatus || "missing"}"; timeline generation requires approved content.`);
}
if (!Array.isArray(script.beats) || !Array.isArray(narration.segments)) throw new Error("Invalid script or narration metadata");
if (script.beats.length !== narration.segments.length) {
  throw new Error(`Beat/segment count mismatch: ${script.beats.length} beats, ${narration.segments.length} segments`);
}
for (let index = 0; index < script.beats.length; index += 1) {
  if (script.beats[index].id !== narration.segments[index].id) {
    throw new Error(`Beat/segment order mismatch at index ${index}: ${script.beats[index].id} vs ${narration.segments[index].id}`);
  }
}


const maxShotDuration = Number(script.project.maxShotDuration ?? 9);
if (!Number.isFinite(maxShotDuration) || maxShotDuration < 4 || maxShotDuration > 28) {
  throw new Error("project.maxShotDuration must be between 4 and 28 seconds");
}
const warnings = [];
// Shared with scripts/assignNarrationVisuals.mjs — see planGroups.
const groups = planGroups(script.beats, narration, maxShotDuration);
const missingVisuals = [];
for (const group of groups) {
  const visuals = group.beats.flatMap((beat) => beat.visuals || (beat.visual ? [beat.visual] : []));
  if (!visuals.length || visuals.some((visual) => !["photo", "clip", "title", "card"].includes(visual.kind))) {
    missingVisuals.push(...group.beats.map((beat) => beat.id));
    continue;
  }
  if (group.partCount > visuals.length) {
    missingVisuals.push(`${group.beats.map((beat) => beat.id).join("+")} (needs ${group.partCount} distinct visuals)`);
  }
  // A beat merged into its neighbour to clear the 2s floor keeps its visual in
  // the list, but only `partCount` of them can be shown. Say so rather than
  // silently dropping tư liệu the editor deliberately assigned.
  if (visuals.length > group.partCount && group.part === 1) {
    warnings.push(
      `${group.beats.map((beat) => beat.id).join("+")}: ${visuals.length} visuals assigned but the merged window only holds ` +
        `${group.partCount} — visual${group.partCount > 1 ? "s" : ""} ${group.partCount + 1}+ will not appear.`,
    );
  }
  const captions = group.beats.filter((beat) => beat.caption);
  if (captions.length > 1 && group.part === 1) {
    warnings.push(
      `${group.beats.map((beat) => beat.id).join("+")}: only the first caption ("${captions[0].caption}") is shown; ` +
        `dropped ${captions.slice(1).map((beat) => `"${beat.caption}"`).join(", ")}.`,
    );
  }
}
if (missingVisuals.length) {
  throw new Error(`Visual assignment gate failed for: ${[...new Set(missingVisuals)].join(", ")}`);
}

const ffmpeg = resolveFfmpeg();
const clipDurations = new Map();
const font = "fonts/BeVietnamPro-Regular.ttf";
function repoAsset(relative, beatId) {
  const absolute = path.resolve(project.dir, relative);
  const inside = path.relative(project.dir, absolute);
  if (inside.startsWith("..") || path.isAbsolute(inside)) throw new Error(`Visual path escapes project for ${beatId}: ${relative}`);
  if (!fs.existsSync(absolute)) throw new Error(`Visual file not found for ${beatId}: ${absolute}`);
  return path.relative(process.cwd(), absolute).replace(/\\/g, "/");
}

// The cards below were drawn against a 1920x1080 frame, and a layer that sticks out of
// the canvas is refused by preflight before a frame is encoded — so a film in any other
// size used to die at the render with four bounds errors it could do nothing about.
// Positions take each axis' own scale; type takes the smaller of the two, because a
// typeface stretched on one axis is not a typeface.
const frameWidth = script.project.width || 1920;
const frameHeight = script.project.height || 1080;
const scaleX = frameWidth / 1920;
const scaleY = frameHeight / 1080;
const px = (value) => Math.round(value * scaleX);
const py = (value) => Math.round(value * scaleY);
const pt = (value) => Math.max(12, Math.round(value * Math.min(scaleX, scaleY)));

function cardLayers(title, subtitle = "") {
  const layers = /** @type {any[]} */ ([
    { type: "rect", color: "#081f33", x: 0, y: 0, width: frameWidth, height: frameHeight },
    { type: "rect", color: "#c89b3c", x: px(230), y: py(360), width: Math.max(2, px(10)), height: py(360) },
    { type: "text", text: title, font, size: pt(68), color: "#ffffff", x: px(290), y: py(350), width: px(1340), height: py(260), align: "left", lineSpacing: 1.2, wrap: true, animation: "fade" },
  ]);
  if (subtitle) layers.push({ type: "text", text: subtitle, font, size: pt(34), color: "#d8e5ef", x: px(295), y: py(660), width: px(1260), height: py(130), align: "left", lineSpacing: 1.2, wrap: true, animation: "fade", start: 0.25 });
  return layers;
}

async function visualSlide(id, visual, caption, contentSpan, transition) {
  const duration = Number((contentSpan + transition.duration).toFixed(3));
  const base = { id, duration, transition, captions: [] };
  if (visual.kind === "title" || visual.kind === "card") {
    return {
      ...base,
      effect: "layer_scene",
      layers: cardLayers(visual.title || caption || script.project.name, visual.subtitle || ""),
    };
  }
  if (caption) {
    base.captions.push({
      text: caption,
      role: "caption",
      position: "bottom_center",
      start: 0.3,
      duration: Math.max(0, Number((duration - 0.6).toFixed(3))),
      font,
      size: pt(44),
      color: "white",
      outline: { color: "black", width: Math.max(1, Math.round(3 * Math.min(scaleX, scaleY))) },
      shadow: true,
      animation: "fade",
    });
  }
  const asset = repoAsset(visual.src, id);
  if (visual.kind === "clip") {
    let clipDuration = clipDurations.get(asset);
    if (clipDuration == null) {
      clipDuration = (await probeMedia(path.resolve(asset), ffmpeg)).duration;
      clipDurations.set(asset, clipDuration);
    }
    if (clipDuration + 0.001 < duration) {
      throw new Error(`Clip ${asset} is ${clipDuration.toFixed(2)}s but slide ${id} needs ${duration.toFixed(2)}s`);
    }
    return { ...base, effect: "video_background", background: asset };
  }
  const effect = visual.effect || "slow_zoom_in";
  // validateTimeline rejects `easing` on anything that is not zoompan-driven,
  // so only carry it where the engine will accept it.
  const easing = EASING_EFFECTS.has(effect) ? { easing: visual.easing || "gentle" } : {};
  return { ...base, effect, image: asset, ...easing };
}

const slides = [];
for (let index = 0; index < groups.length; index += 1) {
  const group = groups[index];
  const next = groups[index + 1];
  const explicit = group.part < group.partCount ? null : group.beats.at(-1)?.transition;
  const transition = transitionFor(group, next || { beats: [{ section: "closing" }] }, explicit);
  const visuals = group.beats.flatMap((beat) => beat.visuals || [beat.visual]);
  const visual = visuals[group.part - 1];
  // Only the opening part carries the caption: repeating it on every part of a
  // split window re-animates the same words at each cut, which reads as a stutter.
  const caption = group.part === 1 ? group.beats.find((beat) => beat.caption)?.caption || "" : "";
  const suffix = group.partCount > 1 ? `-p${group.part}` : "";
  slides.push(await visualSlide(`${group.beats.map((beat) => beat.id).join("-")}${suffix}`, visual, caption, group.end - group.start, transition));
}

// Two neighbouring slides on one clip both start it at zero, so the picture
// visibly jumps back. The engine cannot see this; the editor has to cut a
// second subclip or move a photo in between.
for (let index = 1; index < slides.length; index += 1) {
  const previous = /** @type {{id: string, background?: string}} */ (slides[index - 1]);
  const current = /** @type {{id: string, background?: string}} */ (slides[index]);
  if (previous.background && previous.background === current.background) {
    warnings.push(`${previous.id} → ${current.id} both play ${previous.background}; the clip restarts from 0 on the cut.`);
  }
}

const closingDuration = Number(script.project.closingDuration ?? 4);
if (closingDuration < 2 || closingDuration > 30) throw new Error("project.closingDuration must be in the 2–30 second range");
slides.push({
  id: "closing-card",
  duration: closingDuration,
  effect: "layer_scene",
  layers: cardLayers(
    script.project.closingSlogan || "AN NINH TỪ NHÂN DÂN, VÌ NHÂN DÂN, DO NHÂN DÂN LÀM CHỦ",
    script.project.issuer || "Xã Lao Bảo, tỉnh Quảng Trị",
  ),
  transition: { type: "none", duration: 0 },
  captions: [],
});

const music = (script.music || []).map((track, index) => {
  if (!track.path) throw new Error(`music[${index}].path is required`);
  return { ...track, path: repoAsset(track.path, `music[${index}]`) };
});
const timeline = {
  project: {
    name: script.project.name,
    width: script.project.width || 1920,
    height: script.project.height || 1080,
    fps: script.project.fps || 30,
    quality: script.project.quality || "high",
  },
  music,
  audio: {
    fade_in: 1.5,
    fade_out: 3,
    crossfade: 2,
    voiceover: {
      path: path.relative(process.cwd(), narrationWav).replace(/\\/g, "/"),
      start: 0,
      volume: 1,
      ducking: true,
    },
  },
  output: { path: project.rel(script.project.output || project.manifest.output) },
  color: { saturation: 1.02, contrast: 1.04, vignette: 0.12 },
  slides,
};
const duration = renderedDuration(slides);
if (duration + 0.001 < narration.totalDuration) {
  throw new Error(`Rendered timeline is ${duration.toFixed(2)}s, shorter than narration ${narration.totalDuration.toFixed(2)}s`);
}
const relativeTimeline = project.manifest.timeline || "timeline/timeline.json";
const outputPath = path.join(project.dir, relativeTimeline);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify(timeline, null, 2)}\n`, "utf8");
for (const warning of [...new Set(warnings)]) console.warn(`[warning] ${warning}`);
console.log(`Timeline ready: ${project.rel(relativeTimeline)} (${slides.length} slides, ${duration.toFixed(2)}s).`);
