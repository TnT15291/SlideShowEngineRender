// Build a compact asset intelligence catalog for AI Director decisions.
//
// Outputs:
//   analysis/assets_catalog.full.json  - paths, license/source hints, dimensions
//   analysis/assets_catalog.ai.json    - short id/label/mood/bestFor summaries
//
// Usage: node scripts/analyzeAssets.mjs
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const outFull = "analysis/assets_catalog.full.json";
const outAi = "analysis/assets_catalog.ai.json";
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const ffprobe = ffmpeg.replace(/ffmpeg(\.exe)?$/i, (_, e) => `ffprobe${e || ""}`);

const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".m4v"]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const FONT_EXT = new Set([".ttf", ".otf"]);

const FONT_HINTS = {
  "BeVietnamPro-Regular.ttf": {
    label: "Clean Vietnamese body text",
    roles: ["caption", "subtitle", "body"],
    mood: ["clean", "modern", "safe"],
    summary: "VN-safe sans font for long Vietnamese captions.",
    supportsVietnamese: true,
    readability: "high",
  },
  "PlayfairDisplay.ttf": {
    label: "Elegant serif display",
    roles: ["title", "subtitle"],
    mood: ["elegant", "classic", "luxury"],
    summary: "VN-safe serif for elegant headings and subtitles.",
    supportsVietnamese: true,
    readability: "medium",
  },
  "GreatVibes-Regular.ttf": {
    label: "Romantic script title",
    roles: ["title", "accent"],
    mood: ["romantic", "classic", "soft"],
    summary: "Script font for short names/titles; avoid long Vietnamese text.",
    supportsVietnamese: false,
    readability: "low_for_long_text",
  },
  "DancingScript.ttf": {
    label: "Soft handwritten script",
    roles: ["title", "accent"],
    mood: ["soft", "romantic", "friendly"],
    summary: "Casual script for short decorative text.",
    supportsVietnamese: false,
    readability: "low_for_long_text",
  },
  "Italianno-Regular.ttf": {
    label: "Thin romantic script",
    roles: ["accent"],
    mood: ["romantic", "delicate", "classic"],
    summary: "Thin script accent for short Latin phrases.",
    supportsVietnamese: false,
    readability: "low_for_long_text",
  },
  "WindSong-Medium.ttf": {
    label: "Decorative wedding script",
    roles: ["accent"],
    mood: ["romantic", "ornate", "classic"],
    summary: "Ornate script accent for short Latin words.",
    supportsVietnamese: false,
    readability: "low_for_long_text",
  },
  "MeaCulpa-Regular.ttf": {
    label: "Fine calligraphy accent",
    roles: ["accent"],
    mood: ["delicate", "romantic", "classic"],
    summary: "Fine calligraphy for short decorative accents.",
    supportsVietnamese: false,
    readability: "low_for_long_text",
  },
  "Pacifico-Regular.ttf": {
    label: "Playful rounded script",
    roles: ["accent", "title"],
    mood: ["joyful", "warm", "casual"],
    summary: "Playful script for upbeat moments and short titles.",
    supportsVietnamese: false,
    readability: "medium_for_short_text",
  },
  "Lobster-Regular.ttf": {
    label: "Bold retro script",
    roles: ["title", "accent"],
    mood: ["bold", "retro", "joyful"],
    summary: "Bold script for high-energy short headings.",
    supportsVietnamese: false,
    readability: "medium_for_short_text",
  },
  "Charm-Regular.ttf": {
    label: "Gentle script subtitle",
    roles: ["subtitle", "accent"],
    mood: ["gentle", "romantic", "soft"],
    summary: "Light script accent for gentle subtitles.",
    supportsVietnamese: false,
    readability: "medium_for_short_text",
  },
};

function existsDir(rel) {
  return fs.existsSync(path.resolve(root, rel));
}

function walk(relDir) {
  const abs = path.resolve(root, relDir);
  if (!fs.existsSync(abs)) return [];
  const out = [];
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(relDir, ent.name).replace(/\\/g, "/");
    if (ent.isDirectory()) out.push(...walk(rel));
    else out.push(rel);
  }
  return out;
}

function slug(s) {
  return s
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
}

function titleCase(s) {
  return s
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function uniq(xs) {
  return [...new Set(xs.filter(Boolean))];
}

function keywordTags(file) {
  const s = file.toLowerCase();
  const mood = [];
  const colors = [];
  const bestFor = [];
  if (/wedding|flower|floral|bouquet|bride|calla|lilies/.test(s)) mood.push("wedding", "romantic", "soft");
  if (/bokeh|blurred|light/.test(s)) mood.push("soft", "dreamy");
  if (/leak|flare|sunlight/.test(s)) mood.push("cinematic", "warm");
  if (/particle|spark|golden/.test(s)) mood.push("sparkle", "luxury");
  if (/dark|black/.test(s)) mood.push("cinematic");
  if (/waiting|girl|smells|bouquet/.test(s)) mood.push("romantic", "intimate");
  if (/yellow|gold|golden/.test(s)) colors.push("gold");
  if (/pink/.test(s)) colors.push("pink");
  if (/white|cream|wedding/.test(s)) colors.push("white", "cream");
  if (/sunset|warm|sunlight|gold/.test(s)) colors.push("warm");
  if (/background|bokeh|flower|bouquet/.test(s)) bestFor.push("opening", "title", "ending");
  if (/overlay|leak|flare|particle|bokeh/.test(s)) bestFor.push("memory", "ceremony", "ending");
  if (/frame|floral_corner|border/.test(s)) bestFor.push("portrait", "title", "ending");
  return { mood: uniq(mood), colors: uniq(colors), bestFor: uniq(bestFor) };
}

function probeMedia(rel) {
  const abs = path.resolve(root, rel);
  const r = spawnSync(ffprobe, [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate:format=duration",
    "-of", "json",
    abs,
  ], { encoding: "utf8" });
  if (r.error || r.status !== 0) return {};
  try {
    const data = JSON.parse(r.stdout || "{}");
    const st = data.streams?.[0] || {};
    const duration = Number(data.format?.duration);
    return {
      ...(st.width ? { width: st.width } : {}),
      ...(st.height ? { height: st.height } : {}),
      ...(Number.isFinite(duration) ? { duration: +duration.toFixed(2) } : {}),
      ...(st.r_frame_rate && st.r_frame_rate !== "0/0" ? { fps: st.r_frame_rate } : {}),
    };
  } catch {
    return {};
  }
}

function sourceHint(rel) {
  const s = rel.toLowerCase();
  if (s.includes("mixkit")) return { source: "Mixkit", license: "see assets/licenses" };
  if (s.includes("openclipart")) return { source: "OpenClipart", license: "public-domain/source" };
  if (s.includes("cutestock")) return { source: "Cute Stock Footage", license: "free-with-credit-hint" };
  if (rel.startsWith("overlays/light_leak_")) return { source: "local-procedural", license: "repo-generated" };
  if (rel.startsWith("fonts/")) return { source: "Google Fonts/local", license: "see font upstream" };
  return { source: "local", license: "unknown/local" };
}

function fontAsset(rel) {
  const name = path.basename(rel);
  const hint = FONT_HINTS[name] || {
    label: titleCase(name),
    roles: ["accent"],
    mood: ["wedding"],
    summary: "Local font asset.",
    supportsVietnamese: false,
    readability: "unknown",
  };
  return {
    id: `font_${slug(name).replace(/_regular|_medium/g, "")}`,
    type: "font",
    path: rel,
    ...sourceHint(rel),
    ...hint,
  };
}

function overlayAsset(rel) {
  const ext = path.extname(rel).toLowerCase();
  const k = keywordTags(rel);
  const base = path.basename(rel);
  const isBundledLeak = /^light_leak_(warm|soft|sunset)\.mp4$/i.test(base);
  const variant = isBundledLeak ? base.match(/^light_leak_(warm|soft|sunset)\.mp4$/i)[1].toLowerCase() : undefined;
  const label = variant ? `${titleCase(variant)} cinematic light leak` : titleCase(base);
  return {
    id: variant ? `ov_light_leak_${variant}` : `ov_${slug(base)}`,
    type: "overlay",
    path: rel,
    ...(variant ? { variant } : {}),
    mediaType: VIDEO_EXT.has(ext) ? "video" : "image",
    label,
    summary: variant
      ? `${label}; use as a soft fullscreen screen blend.`
      : `${label}; local overlay asset.`,
    mood: uniq(k.mood.length ? k.mood : ["wedding"]),
    bestFor: uniq(k.bestFor.length ? k.bestFor : ["memory", "ending"]),
    colors: k.colors,
    recommendedBlend: rel.toLowerCase().endsWith(".png") ? "alpha" : "screen",
    recommendedOpacity: variant ? 0.55 : 0.35,
    ...probeMedia(rel),
    ...sourceHint(rel),
  };
}

function backgroundAsset(rel) {
  const k = keywordTags(rel);
  const base = path.basename(rel);
  return {
    id: `bg_${slug(base)}`,
    type: "video_background",
    path: rel,
    mediaType: VIDEO_EXT.has(path.extname(rel).toLowerCase()) ? "video" : "image",
    label: titleCase(base),
    summary: `${titleCase(base)}; use for title cards, chapter cards, or soft interludes.`,
    mood: uniq(k.mood.length ? k.mood : ["romantic", "soft"]),
    bestFor: uniq(k.bestFor.length ? k.bestFor : ["opening", "title", "ending"]),
    colors: k.colors,
    loopable: VIDEO_EXT.has(path.extname(rel).toLowerCase()),
    ...probeMedia(rel),
    ...sourceHint(rel),
  };
}

function frameAsset(rel) {
  const k = keywordTags(rel);
  const base = path.basename(rel);
  return {
    id: `frame_${slug(base)}`,
    type: "frame",
    path: rel,
    mediaType: "image",
    label: titleCase(base),
    summary: `${titleCase(base)}; decorative frame overlay.`,
    mood: uniq(k.mood.length ? k.mood : ["wedding", "romantic"]),
    bestFor: uniq(k.bestFor.length ? k.bestFor : ["portrait", "title", "ending"]),
    colors: k.colors,
    recommendedBlend: "alpha",
    recommendedOpacity: 1,
    ...probeMedia(rel),
    ...sourceHint(rel),
  };
}

const fonts = existsDir("fonts")
  ? walk("fonts").filter((f) => FONT_EXT.has(path.extname(f).toLowerCase())).map(fontAsset)
  : [];
const overlays = [
  ...walk("overlays"),
  ...walk("assets/overlays"),
].filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()) || IMAGE_EXT.has(path.extname(f).toLowerCase()))
  .map(overlayAsset);
const backgrounds = walk("assets/backgrounds")
  .filter((f) => VIDEO_EXT.has(path.extname(f).toLowerCase()) || IMAGE_EXT.has(path.extname(f).toLowerCase()))
  .map(backgroundAsset);
const frames = walk("assets/frames")
  .filter((f) => IMAGE_EXT.has(path.extname(f).toLowerCase()))
  .map(frameAsset);

const full = {
  generatedAt: new Date().toISOString(),
  version: 1,
  counts: {
    fonts: fonts.length,
    overlays: overlays.length,
    backgrounds: backgrounds.length,
    frames: frames.length,
  },
  fonts,
  overlays,
  backgrounds,
  frames,
};

function aiEntry(a) {
  return {
    id: a.id,
    label: a.label,
    summary: a.summary,
    type: a.type,
    ...(a.roles ? { roles: a.roles } : {}),
    ...(a.mood?.length ? { mood: a.mood } : {}),
    ...(a.bestFor?.length ? { bestFor: a.bestFor } : {}),
    ...(a.colors?.length ? { colors: a.colors } : {}),
    ...(a.supportsVietnamese != null ? { supportsVietnamese: a.supportsVietnamese } : {}),
    ...(a.readability ? { readability: a.readability } : {}),
    ...(a.variant ? { variant: a.variant } : {}),
    ...(a.recommendedBlend ? { recommendedBlend: a.recommendedBlend } : {}),
    ...(a.recommendedOpacity != null ? { recommendedOpacity: a.recommendedOpacity } : {}),
  };
}

const ai = {
  generatedAt: full.generatedAt,
  version: full.version,
  purpose: "Short asset menu for AI Director. Choose ids only; timeline generator maps ids to local paths.",
  counts: full.counts,
  fonts: fonts.map(aiEntry),
  overlays: overlays.map(aiEntry),
  backgrounds: backgrounds.map(aiEntry),
  frames: frames.map(aiEntry),
};

for (const rel of [outFull, outAi]) fs.mkdirSync(path.dirname(path.resolve(root, rel)), { recursive: true });
fs.writeFileSync(path.resolve(root, outFull), JSON.stringify(full, null, 2));
fs.writeFileSync(path.resolve(root, outAi), JSON.stringify(ai, null, 2));
console.log(`[analyzeAssets] wrote ${outFull} and ${outAi}`);
console.log(`  fonts=${fonts.length} overlays=${overlays.length} backgrounds=${backgrounds.length} frames=${frames.length}`);
