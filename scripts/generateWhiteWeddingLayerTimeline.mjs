import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const inputDir = path.join(root, "input");
const outPath = path.join(root, "timeline", "input-white-wedding-layer-scene.json");

function arg(name) {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

const images = fs
  .readdirSync(inputDir)
  .filter((name) => /\.(jpe?g|png)$/i.test(name))
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .map((name) => `input/${name}`);

if (images.length === 0) throw new Error("No images found in input");

const defaultStoryBeats = [
  ["SAVE THE DATE", "Trường & Giang"],
  ["OUR STORY", "Những khoảnh khắc yêu thương"],
  ["SPECIAL DAY", "Ngày hôm nay thật ý nghĩa"],
  ["LOVE", "Cảm ơn vì đã cùng nhau đi qua mọi điều"],
  ["THE BIG DAY", "Câu chuyện được kể lại bằng những nụ cười"],
];

const storyPath = arg("--story");
const storyBeats = storyPath
  ? fs
      .readFileSync(path.resolve(root, storyPath), "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line, i) => {
        const [heading, ...rest] = line.split("|").map((part) => part.trim());
        return [heading || defaultStoryBeats[i % defaultStoryBeats.length][0], rest.join(" | ") || heading];
      })
  : defaultStoryBeats;

function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function wrapText(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

function textLayer(text, x, y, width, size, font, align = "center", color = "#634c31", maxChars = 42) {
  const wrapped = wrapText(text, maxChars);
  return {
    type: "text",
    text: wrapped,
    font,
    x,
    y,
    width,
    height: Math.round(size * 1.8),
    size,
    color,
    align,
    animation: "fade",
    start: 0.2,
    duration: 5.4,
  };
}

function imageLayer(image, x, y, width, height, fit = "contain", animation = "fade") {
  return {
    type: "image",
    path: image,
    x,
    y,
    width,
    height,
    fit,
    animation,
    start: 0,
    duration: 6,
  };
}

function rectLayer(color = "#fbf6ed") {
  return { type: "rect", x: 0, y: 0, width: 1920, height: 1080, color };
}

function layoutLayers(group, index) {
  const [heading, sub] = storyBeats[index % storyBeats.length];
  const layout = index % 5;
  const layers = [rectLayer()];

  if (layout === 0) {
    const [a, b, c] = group;
    layers.push(imageLayer(a, 90, 145, 560, 700, "contain", "slide_up"));
    if (b) layers.push(imageLayer(b, 690, 185, 470, 620, "contain", "slide_right"));
    if (c) layers.push(imageLayer(c, 1200, 145, 560, 700, "contain", "slide_left"));
    layers.push(textLayer(heading, 600, 55, 720, 62, "fonts/PlayfairDisplay.ttf"));
    layers.push(textLayer(sub, 460, 920, 1000, 34, "fonts/BeVietnamPro-Regular.ttf", "center", "#634c31", 46));
    return layers;
  }

  if (layout === 1) {
    const [a, b, c] = group;
    layers.push(textLayer(heading, 70, 170, 760, 82, "fonts/PlayfairDisplay.ttf", "left"));
    layers.push(textLayer(sub, 70, 340, 760, 34, "fonts/BeVietnamPro-Regular.ttf", "left", "#634c31", 34));
    layers.push(imageLayer(a, 980, 95, 760, 820, "contain", "slide_left"));
    if (b) layers.push(imageLayer(b, 560, 715, 330, 250, "contain", "slide_right"));
    if (c) layers.push(imageLayer(c, 70, 715, 330, 250, "contain", "slide_up"));
    return layers;
  }

  if (layout === 2) {
    const [a, b, c] = group;
    layers.push(imageLayer(a, 720, 95, 1040, 680, "contain", "slide_left"));
    if (b) layers.push(imageLayer(b, 120, 130, 430, 300, "contain", "slide_right"));
    if (c) layers.push(imageLayer(c, 120, 485, 430, 300, "contain", "slide_up"));
    layers.push(textLayer(heading, 90, 850, 1740, 58, "fonts/PlayfairDisplay.ttf"));
    layers.push(textLayer(sub, 260, 940, 1400, 30, "fonts/BeVietnamPro-Regular.ttf", "center", "#634c31", 58));
    return layers;
  }

  if (layout === 3) {
    const [a, b, c] = group;
    layers.push(imageLayer(a, 110, 135, 790, 810, "contain", "slide_up"));
    if (b) layers.push(imageLayer(b, 980, 135, 380, 360, "contain", "slide_down"));
    if (c) layers.push(imageLayer(c, 1380, 560, 380, 360, "contain", "slide_left"));
    layers.push(textLayer(heading, 970, 565, 790, 62, "fonts/PlayfairDisplay.ttf", "left"));
    layers.push(textLayer(sub, 970, 675, 760, 32, "fonts/BeVietnamPro-Regular.ttf", "left", "#634c31", 38));
    return layers;
  }

  const [a, b, c] = group;
  layers.push(imageLayer(a, 190, 140, 640, 800, "contain", "slide_up"));
  if (b) layers.push(imageLayer(b, 890, 120, 390, 360, "contain", "slide_up"));
  if (c) layers.push(imageLayer(c, 890, 550, 390, 360, "contain", "slide_up"));
  layers.push(textLayer(heading, 1320, 220, 500, 58, "fonts/PlayfairDisplay.ttf", "left"));
  layers.push(textLayer(sub, 1320, 355, 460, 30, "fonts/BeVietnamPro-Regular.ttf", "left", "#634c31", 26));
  return layers;
}

const groups = chunks(images, 3);
const slides = [];
for (const [i, group] of groups.entries()) {
  slides.push({
    id: `input_white_wedding_${String(i + 1).padStart(3, "0")}`,
    duration: 6,
    effect: "layer_scene",
    transition: {
      type: "crossfade",
      duration: 0.6,
    },
    captions: [],
    layers: layoutLayers(group, i),
  });

  const rollImages = images.slice(Math.max(0, i * 3 - 2), Math.min(images.length, i * 3 + 6));
  if ((i + 1) % 4 === 0 && rollImages.length >= 2) {
    const [heading, sub] = storyBeats[i % storyBeats.length];
    slides.push({
      id: `input_white_wedding_film_roll_${String(i + 1).padStart(3, "0")}`,
      duration: 18,
      effect: "film_roll_up",
      images: rollImages.slice(0, 6),
      transition: {
        type: "crossfade",
        duration: 0.6,
      },
      captions: []
    });
  }
}
if (slides.length > 0) slides[slides.length - 1].transition.duration = 0;

const timeline = {
  project: {
    name: "input-white-wedding-layer-scene",
    width: 1920,
    height: 1080,
    fps: 30,
  },
  music: [{ path: "music/a thousand years.mp3", volume: 0.75 }],
  audio: {
    fade_in: 2,
    fade_out: 3,
    crossfade: 0,
  },
  output: {
    path: "output/input-white-wedding-layer-scene.mp4",
  },
  slides,
};

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(timeline, null, 2), "utf8");
console.log(`Wrote ${outPath}`);
console.log(`Images: ${images.length}, slides: ${slides.length}, duration: ${slides.length * 6}s`);
