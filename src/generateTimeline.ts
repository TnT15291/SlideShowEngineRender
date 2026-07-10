import fs from "node:fs";
import path from "node:path";
import { isPortrait, readImageSize } from "./imageSize";
import { CURVES_PRESETS } from "./types";
import type {
  Caption,
  ColorGrade,
  CurvesPreset,
  EffectPreset,
  Slide,
  Timeline,
  TransitionType,
} from "./types";

// Generate a timeline.json from a folder of real photos. This is the local
// stand-in for the AI/n8n step in the docs: it produces the concrete "contract"
// the render engine consumes — no vague fields, every slide fully specified.
//
// Framing is chosen from each image's orientation:
//   portrait  -> portrait_blur_background (never crops a person)
//   landscape -> cycles zoom/pan presets so consecutive slides don't feel static
//   square    -> still
//
// Usage:
//   npx tsx src/generateTimeline.ts [--input input] [--out timeline/timeline.json]
//     [--count N] [--duration 4] [--music music/wedding.mp3] [--transition none]
//     [--look cinematic|film|dreamy|clean]

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png"]);

// Rotated across landscape slides for visual variety. Ken Burns corner drifts
// interleave with straight zooms/pans so no two consecutive slides move alike.
const LANDSCAPE_CYCLE: EffectPreset[] = [
  "slow_zoom_in",
  "kenburns_tl",
  "slow_zoom_out",
  "kenburns_br",
  "pan_left",
  "kenburns_tr",
  "pan_right",
  "kenburns_bl",
];

// "mix" rotates through a tasteful set instead of one fixed transition.
const TRANSITION_MIX: TransitionType[] = [
  "crossfade",
  "smooth_left",
  "dissolve",
  "smooth_right",
  "circle_open",
  "wipe_left",
];

interface GenOptions {
  inputDir: string;
  outPath: string;
  count?: number;
  duration: number;
  musicPath?: string;
  volume: number;
  transition: TransitionType | "mix";
  title?: string; // caption shown on the first slide (opening title)
  ending?: string; // caption shown on the last slide (closing line)
  logo?: string; // PNG overlaid bottom-right for the whole video
  particles?: string; // black-bg loop screen-blended over everything
  vignette: boolean;
  curves?: string; // curves preset name for the global grade
  look?: string; // named grade bundle (cinematic / film / dreamy / clean)
}

// Grade bundles distilled from 2026 wedding-videography research: cinematic
// (bars + grain + contrast), film (vintage curve + warm + heavy grain), dreamy
// (bloom + warm), clean (true-to-color, barely touched). --vignette/--curves
// still override individual fields on top.
const LOOKS: Record<string, ColorGrade> = {
  cinematic: {
    letterbox: true,
    grain: 6,
    contrast: 1.05,
    saturation: 1.06,
    vignette: true,
  },
  film: { curves: "vintage", grain: 10, temperature: 5600, vignette: true },
  dreamy: { glow: 0.45, temperature: 5800, brightness: 0.03 },
  clean: { saturation: 1.05, contrast: 1.02 },
};

function parseArgs(argv: string[]): GenOptions {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };

  const duration = Number(get("--duration") ?? 4);
  const countRaw = get("--count");

  return {
    inputDir: get("--input") ?? "input",
    outPath: get("--out") ?? "timeline/timeline.json",
    count: countRaw ? Number(countRaw) : undefined,
    duration,
    musicPath: get("--music") ?? "music/wedding.mp3",
    volume: Number(get("--volume") ?? 0.8),
    // Crossfade is the wedding-slideshow default ("chuyển cảnh đẹp"); pass
    // --transition none for a fast draft, or "mix" to rotate several styles.
    transition: (get("--transition") as TransitionType | "mix") ?? "crossfade",
    title: get("--title"),
    ending: get("--ending"),
    logo: get("--logo"),
    particles: get("--particles"),
    vignette: argv.includes("--vignette"),
    curves: get("--curves"),
    look: get("--look"),
  };
}

// Wedding-look fonts (Google Fonts, Vietnamese-verified). Used automatically
// when present in fonts/; falls back to the engine default (Arial) otherwise.
const ROLE_FONTS: Record<Caption["role"], string> = {
  title: "fonts/GreatVibes-Regular.ttf",
  subtitle: "fonts/PlayfairDisplay.ttf",
  caption: "fonts/BeVietnamPro-Regular.ttf",
};

// Script faces read smaller than sans at equal px, so the title gets a bump
// over its role default (h/13) when the script font is in use.
const TITLE_SCRIPT_SIZE = Math.round(1080 / 8);

/** A bottom-center caption that fits within a slide of length `slideDuration`. */
function makeCaption(text: string, slideDuration: number, role: Caption["role"]): Caption {
  const start = 0.5;
  const duration = Math.max(1, Math.min(3, slideDuration - start - 0.5));
  const caption: Caption = {
    text,
    role,
    position: "bottom_center",
    start,
    duration,
    color: "white",
    shadow: true,
    animation: "slide_up",
  };

  const font = ROLE_FONTS[role];
  if (fs.existsSync(font)) {
    caption.font = font;
    if (role === "title") caption.size = TITLE_SCRIPT_SIZE;
  }
  return caption;
}

function listImages(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => IMAGE_EXTS.has(path.extname(f).toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}

/** Pick a framing preset for one image from its intrinsic dimensions. */
function effectFor(
  absImage: string,
  landscapeIndex: number
): { effect: EffectPreset; landscapeConsumed: boolean } {
  const size = readImageSize(absImage);
  if (isPortrait(size)) {
    return { effect: "portrait_blur_background", landscapeConsumed: false };
  }
  if (size && size.width === size.height) {
    return { effect: "still", landscapeConsumed: false };
  }
  const effect = LANDSCAPE_CYCLE[landscapeIndex % LANDSCAPE_CYCLE.length];
  return { effect, landscapeConsumed: true };
}

export function generateTimeline(opts: GenOptions): Timeline {
  const baseDir = process.cwd();
  const inputAbs = path.resolve(baseDir, opts.inputDir);

  let files = listImages(inputAbs);
  if (opts.count !== undefined) files = files.slice(0, opts.count);
  if (files.length === 0) {
    throw new Error(`No images (${[...IMAGE_EXTS].join(", ")}) found in ${inputAbs}`);
  }

  let landscapeIndex = 0;
  const slides: Slide[] = files.map((file, i) => {
    const rel = path.join(opts.inputDir, file).replace(/\\/g, "/");
    const { effect, landscapeConsumed } = effectFor(
      path.join(inputAbs, file),
      landscapeIndex
    );
    if (landscapeConsumed) landscapeIndex++;

    const isFirst = i === 0;
    const isLast = i === files.length - 1;
    const captions: Caption[] = [];
    if (isFirst && opts.title)
      captions.push(makeCaption(opts.title, opts.duration, "title"));
    else if (isLast && opts.ending)
      captions.push(makeCaption(opts.ending, opts.duration, "caption"));

    const transitionType: TransitionType =
      opts.transition === "mix"
        ? TRANSITION_MIX[i % TRANSITION_MIX.length]
        : opts.transition;

    const slide: Slide = {
      id: `slide_${pad(i + 1)}`,
      image: rel,
      duration: opts.duration,
      effect,
      transition: {
        type: transitionType,
        duration: transitionType === "none" ? 0 : 1,
      },
      captions,
    };
    return slide;
  });

  const musicAbs = opts.musicPath
    ? path.resolve(baseDir, opts.musicPath)
    : undefined;
  const hasMusic = musicAbs !== undefined && fs.existsSync(musicAbs);

  const overlays: Timeline["overlays"] = [];
  if (opts.particles) {
    overlays.push({
      path: opts.particles,
      position: "fullscreen",
      opacity: 0.5,
      margin: 40,
      blend: "screen",
      start: 0,
    });
  }
  if (opts.logo) {
    overlays.push({
      path: opts.logo,
      position: "bottom_right",
      scale: 0.14,
      opacity: 0.9,
      margin: 40,
      blend: "alpha",
      start: 0,
    });
  }

  const timeline: Timeline = {
    project: {
      name: "wedding",
      width: 1920,
      height: 1080,
      fps: 30,
      quality: "share",
    },
    // Music is the slideshow's only audio, so default near unity (not the old
    // 0.3 background level). Override per run with --volume if needed.
    music: hasMusic ? [{ path: opts.musicPath!, volume: opts.volume }] : [],
    audio: { fade_in: 2, fade_out: 2, crossfade: 2 },
    output: { path: "output/final.mp4" },
    overlays,
    slides,
  };

  if (opts.look && !LOOKS[opts.look]) {
    throw new Error(
      `--look must be one of: ${Object.keys(LOOKS).join(", ")} (got "${opts.look}")`
    );
  }
  if (opts.curves && !(CURVES_PRESETS as readonly string[]).includes(opts.curves)) {
    throw new Error(
      `--curves must be one of: ${CURVES_PRESETS.join(", ")} (got "${opts.curves}")`
    );
  }
  if (opts.look || opts.vignette || opts.curves) {
    timeline.color = {
      ...(opts.look ? LOOKS[opts.look] : {}),
      ...(opts.vignette ? { vignette: true } : {}),
      ...(opts.curves ? { curves: opts.curves as CurvesPreset } : {}),
    };
  }

  return timeline;
}

function main(): void {
  const opts = parseArgs(process.argv.slice(2));
  const timeline = generateTimeline(opts);

  const outAbs = path.resolve(process.cwd(), opts.outPath);
  fs.mkdirSync(path.dirname(outAbs), { recursive: true });
  fs.writeFileSync(outAbs, JSON.stringify(timeline, null, 2) + "\n");

  const counts = timeline.slides.reduce<Record<string, number>>((acc, s) => {
    acc[s.effect] = (acc[s.effect] ?? 0) + 1;
    return acc;
  }, {});

  console.log(`Wrote ${outAbs}`);
  console.log(`  slides: ${timeline.slides.length}`);
  console.log(
    `  music:  ${
      timeline.music.length > 0
        ? timeline.music.map((t) => t.path).join(", ")
        : "(none found)"
    }`
  );
  console.log(
    `  effects: ${Object.entries(counts)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ")}`
  );
}

main();
