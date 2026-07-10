import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const themeDir = path.join(root, "templates", "Weddings", "White Weddings Theme");
const pptxScratch = path.join(process.env.TEMP || process.env.TMP || ".", "white-weddings-theme-pptx");
const pptDir = path.join(pptxScratch, "ppt");
const svgDir = path.join(themeDir, "White Weddings svg");
const videoPath = path.join(themeDir, "Bản sao của White Elegant Wedding Save the Date Video.mp4");
const outputPath = path.join(root, "timeline", "white-weddings-theme-first-5.analysis.json");

function read(rel) {
  return fs.readFileSync(path.join(pptxScratch, rel), "utf8");
}

function attrs(tag) {
  const out = {};
  for (const m of tag.matchAll(/([\w:]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

function textOf(xml) {
  return [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)]
    .map((m) => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"))
    .join("");
}

function parseRunStyles(xml) {
  const styles = [];
  for (const m of xml.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
    const run = m[1];
    const rPr = run.match(/<a:rPr\b[^>]*>/)?.[0] ?? "";
    const style = attrs(rPr);
    const color = run.match(/<a:srgbClr val="([^"]+)"/)?.[1];
    const latin = run.match(/<a:latin typeface="([^"]+)"/)?.[1];
    styles.push({
      text: textOf(run),
      fontFamily: latin,
      fontSizePt: style.sz ? Number(style.sz) / 100 : undefined,
      letterSpacingPt: style.spc ? Number(style.spc) / 100 : undefined,
      color: color ? `#${color}` : undefined,
      lang: style.lang,
    });
  }
  return styles;
}

function parseXfrm(xml) {
  const xfrm = xml.match(/<a:xfrm\b[^>]*>[\s\S]*?<\/a:xfrm>/)?.[0];
  if (!xfrm) return undefined;
  const tag = xfrm.match(/<a:xfrm\b[^>]*>/)?.[0] ?? "";
  const off = attrs(xfrm.match(/<a:off\b[^>]*\/>/)?.[0] ?? "");
  const ext = attrs(xfrm.match(/<a:ext\b[^>]*\/>/)?.[0] ?? "");
  const scale = 1920 / 18288000;
  return {
    x: Math.round(Number(off.x ?? 0) * scale),
    y: Math.round(Number(off.y ?? 0) * scale),
    width: Math.round(Number(ext.cx ?? 0) * scale),
    height: Math.round(Number(ext.cy ?? 0) * scale),
    rotationDeg: attrs(tag).rot ? Number(attrs(tag).rot) / 60000 : 0,
    flipH: attrs(tag).flipH === "true",
    flipV: attrs(tag).flipV === "true",
    emu: {
      x: Number(off.x ?? 0),
      y: Number(off.y ?? 0),
      cx: Number(ext.cx ?? 0),
      cy: Number(ext.cy ?? 0),
    },
  };
}

function relsForSlide(i) {
  const xml = read(`ppt/slides/_rels/slide${i}.xml.rels`);
  const rels = {};
  for (const m of xml.matchAll(/<Relationship\b[^>]*\/>/g)) {
    const a = attrs(m[0]);
    rels[a.Id] = {
      target: a.Target?.replace(/^\.\.\//, "ppt/"),
      type: a.Type,
    };
  }
  return rels;
}

function mediaSize(abs) {
  const buf = fs.readFileSync(abs);
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), kind: "png" };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p < buf.length) {
      if (buf[p] !== 0xff) break;
      const marker = buf[p + 1];
      const len = buf.readUInt16BE(p + 2);
      if (marker >= 0xc0 && marker <= 0xc3) {
        return { width: buf.readUInt16BE(p + 7), height: buf.readUInt16BE(p + 5), kind: "jpeg" };
      }
      p += 2 + len;
    }
  }
  if (buf.toString("utf8", 0, 200).includes("<svg")) return { kind: "svg" };
  return { kind: path.extname(abs).slice(1) || "unknown" };
}

function extractBlocks(xml, tag) {
  return [...xml.matchAll(new RegExp(`<p:${tag}\\b[\\s\\S]*?<\\/p:${tag}>`, "g"))].map((m) => m[0]);
}

function parseSlide(i) {
  const xml = read(`ppt/slides/slide${i}.xml`);
  const rels = relsForSlide(i);
  const items = [];

  for (const sp of extractBlocks(xml, "sp")) {
    const cNv = sp.match(/<p:cNvPr\b[^>]*\/>|<p:cNvPr\b[^>]*>/)?.[0] ?? "";
    const a = attrs(cNv);
    const fill = sp.match(/<a:solidFill>[\s\S]*?<a:srgbClr val="([^"]+)"/)?.[1];
    const text = textOf(sp);
    items.push({
      type: text ? "text" : "shape",
      id: a.id,
      name: a.name,
      frame: parseXfrm(sp),
      text: text || undefined,
      runs: text ? parseRunStyles(sp) : undefined,
      fill: fill ? `#${fill}` : undefined,
      geometry: sp.match(/<a:prstGeom prst="([^"]+)"/)?.[1] ?? (sp.includes("<a:custGeom>") ? "custom" : undefined),
    });
  }

  for (const pic of extractBlocks(xml, "pic")) {
    const cNv = pic.match(/<p:cNvPr\b[^>]*\/>|<p:cNvPr\b[^>]*>/)?.[0] ?? "";
    const a = attrs(cNv);
    const rid = pic.match(/r:embed="([^"]+)"/)?.[1] ?? pic.match(/r:link="([^"]+)"/)?.[1];
    const rel = rid ? rels[rid] : undefined;
    const relPath = rel?.target;
    const abs = relPath ? path.join(pptxScratch, relPath) : undefined;
    items.push({
      type: "image",
      id: a.id,
      name: a.name,
      frame: parseXfrm(pic),
      relationshipId: rid,
      source: relPath,
      media: abs && fs.existsSync(abs) ? mediaSize(abs) : undefined,
      mediaAction: pic.includes("ppaction://media") ? "audio-control-icon" : undefined,
      trim: pic.match(/<p14:trim\b[^>]*\/>/)?.[0] ? attrs(pic.match(/<p14:trim\b[^>]*\/>/)[0]) : undefined,
    });
  }

  const svgPath = path.join(svgDir, `${i}.svg`);
  const svg = fs.readFileSync(svgPath, "utf8");
  const transition = xml.match(/<p:transition\b[^>]*>/)?.[0];
  const advance = transition ? attrs(transition) : {};
  const audioRel = Object.values(rels).find((r) => r.type?.includes("/audio"));

  return {
    scene: i,
    source: {
      pptxSlide: `ppt/slides/slide${i}.xml`,
      svg: path.relative(root, svgPath).replace(/\\/g, "/"),
      pptxRelationships: rels,
    },
    canvas: {
      width: 1920,
      height: 1080,
      viewBox: svg.match(/viewBox="([^"]+)"/)?.[1],
      pptxSizeEmu: { cx: 18288000, cy: 10287000 },
    },
    timing: {
      pptxAdvance: advance.advTm ? Number(advance.advTm) / 1000 : undefined,
      transitionType: transition ? transition.match(/<p:transition\b[^>]*>([\s\S]*?)<\/p:transition>/)?.[1] || "cut/unspecified" : "cut/unspecified",
      inferredDurationSeconds: 3088.875011 / 316,
      startSeconds: (i - 1) * (3088.875011 / 316),
      endSeconds: i * (3088.875011 / 316),
    },
    svgStats: {
      bytes: fs.statSync(svgPath).size,
      textTags: (svg.match(/<text\b|<tspan\b/g) ?? []).length,
      imageTags: (svg.match(/<image\b/g) ?? []).length,
      filterTags: (svg.match(/<filter\b/g) ?? []).length,
      clipPathTags: (svg.match(/<clipPath\b/g) ?? []).length,
      note: "SVG text is converted to vector paths; recover readable text/font from PPTX instead.",
    },
    audio: audioRel
      ? {
          path: audioRel.target,
          note: i === 1 ? "Audio starts on slide 1 and is the shared deck music track." : undefined,
        }
      : undefined,
    elements: items,
  };
}

function videoMeta() {
  const stdout = execFileSync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=codec_type,width,height,r_frame_rate,avg_frame_rate,duration",
    "-of",
    "json",
    videoPath,
  ], { encoding: "utf8" });
  return JSON.parse(stdout);
}

const scenes = [1, 2, 3, 4, 5].map(parseSlide);
const doc = {
  project: {
    name: "white-weddings-theme-first-5-source-analysis",
    sourceTheme: path.relative(root, themeDir).replace(/\\/g, "/"),
    generatedAt: new Date().toISOString(),
  },
  sourceFiles: {
    pptx: "templates/Weddings/White Weddings Theme/powerpoints.pptx",
    mp4: "templates/Weddings/White Weddings Theme/Bản sao của White Elegant Wedding Save the Date Video.mp4",
    svgFolder: "templates/Weddings/White Weddings Theme/White Weddings svg",
  },
  sourceDeck: {
    slideCount: 316,
    svgCount: 316,
    video: videoMeta(),
    mapping: "ppt slide N maps to White Weddings svg/N.svg.",
    inferredSceneDurationSeconds: 3088.875011 / 316,
  },
  scenes,
  engineAssessment: {
    currentEngineCanValidateThisSourceTimelineDirectly: false,
    directBlockers: [
      "Timeline schema only supports one image or preset multi-image layouts per slide, not arbitrary Canva layer trees with exact x/y/w/h per element.",
      "Engine captions support only top/center/bottom presets; the source needs exact text boxes, custom fonts, letter spacing, and per-element coordinates.",
      "SVG export has text converted to paths, and the installed FFmpeg build cannot decode SVG input, so SVG files cannot be used directly as slide images here.",
      "PPTX contains exact media and text, but the engine has no PPTX renderer/importer.",
      "Canva-style per-layer animation/easing is not represented in the current timeline schema beyond coarse slide effects and xfade transitions.",
    ],
    canRenderApproximationToday: true,
    viableToday: [
      "Render each source scene as a flattened PNG/JPG, then use effect='still' or subtle pan/zoom in the existing engine.",
      "Use the MP4 as ground truth for duration and transitions.",
      "Use PPTX text/font data for metadata, but bake text into flattened scene images unless engine is extended.",
    ],
    neededForCloseMatch: [
      "Add a layer-based scene renderer to the timeline schema: images, shapes, text, masks, clipping, opacity, transforms, z-index.",
      "Add exact positioned text rendering with font family, font size, color, line spacing, letter spacing, anchors.",
      "Add SVG/PPTX import or pre-render step to produce per-scene PNG backgrounds.",
      "Add per-layer animation: fade, slide, scale, blur, crop/mask, easing, start/end times.",
    ],
  },
};

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(doc, null, 2), "utf8");
console.log(outputPath);
