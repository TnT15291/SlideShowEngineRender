import fs from "node:fs";
import path from "node:path";

const templateDir = path.join(process.cwd(), "story-templates");

// These three scalable beats used to be the same in every recipe:
// collage_grid -> double_exposure -> memory_wall. Keep their photo-rich purpose,
// but give each recipe a sequence that matches its visual language.
const directions = {
  "afterparty-pulse-01": ["film_roll_right", "spotlight_focus", "photo_strip_up"],
  "cinematic-film-01": ["photo_strip_left", "tilt_shift", "photo_strip_right"],
  "cinematic-vows-01": ["memory_wall", "double_exposure", "photo_strip_up"],
  "city-to-ceremony-01": ["photo_strip_right", "tilt_shift", "film_roll_left"],
  "classic-luxury-01": ["film_roll_up", "portrait_reflection", "film_roll_right"],
  "classic-multisong-album-01": ["film_roll_right", "panel_flip", "film_roll_left"],
  "editorial-bold-01": ["film_roll_up", "tilt_shift", "photo_strip_left"],
  "family-roots-01": ["film_roll_up", "portrait_reflection", "collage_grid"],
  "four-seasons-love-01": ["photo_strip_up", "portrait_reflection", "collage_grid"],
  "garden-botanical-01": ["photo_strip_left", "portrait_reflection", "memory_wall"],
  "garden-diary-01": ["film_roll_up", "panel_flip", "photo_strip_right"],
  "heritage-ceremony-01": ["memory_wall", "double_exposure", "photo_strip_left"],
  "jmii-silk-botanical-01": ["collage_grid", "portrait_reflection", "photo_strip_up"],
  "korean-soft-01": ["film_roll_left", "double_exposure", "film_roll_up"],
  "letters-to-forever-01": ["film_roll_right", "double_exposure", "memory_wall"],
  "long-distance-love-01": ["photo_strip_left", "double_exposure", "photo_strip_right"],
  "modern-teal-01": ["photo_strip_right", "prism_split", "film_roll_up"],
  "playful-scrapbook-01": ["collage_grid", "panel_flip", "film_roll_left"],
  "studio-white-prewedding-01": ["film_roll_right", "spotlight_focus", "collage_grid"],
  "three-chapters-biography-01": ["film_roll_up", "portrait_reflection", "film_roll_left"],
  "warm-film-01": ["memory_wall", "double_exposure", "photo_strip_right"],
  "white-weddings-editorial-01": ["photo_strip_up", "double_exposure", "memory_wall"],
  "white-weddings-full-01": ["collage_grid", "portrait_reflection", "film_roll_left"],
};

const memoryBackgrounds = {
  "afterparty-pulse-01": "#1C2B30",
  "cinematic-film-01": "#2B2B32",
  "cinematic-vows-01": "#2B2B32",
  "city-to-ceremony-01": "#1C2B30",
  "classic-luxury-01": "#2B2B32",
  "classic-multisong-album-01": "#2B2B32",
  "editorial-bold-01": "#171717",
  "family-roots-01": "#3B332B",
  "four-seasons-love-01": "#3B332B",
  "garden-botanical-01": "#253B32",
  "garden-diary-01": "#253B32",
  "heritage-ceremony-01": "#2B2B32",
  "jmii-silk-botanical-01": "#3B332B",
  "korean-soft-01": "#F4ECE0",
  "letters-to-forever-01": "#34302D",
  "long-distance-love-01": "#1C2B30",
  "modern-teal-01": "#1C2B30",
  "playful-scrapbook-01": "#34322E",
  "studio-white-prewedding-01": "#F7F4EE",
  "three-chapters-biography-01": "#4A4139",
  "warm-film-01": "#3B332B",
  "white-weddings-editorial-01": "#F7F4EE",
  "white-weddings-full-01": "#F7F4EE",
};

const montageSlots = {
  collage_grid: "grid",
  memory_wall: "memories",
  film_roll_up: "film_roll",
  film_roll_left: "film_roll",
  film_roll_right: "film_roll",
  photo_strip_up: "film_roll",
  photo_strip_left: "film_roll",
  photo_strip_right: "film_roll",
};

function makeScene({ index, effect, background }) {
  const scene = {
    id: `s8${index}_${effect}`,
    effect,
    ...(index === 1 ? { signature: true } : {}),
    durationRole: index === 1 ? "calm" : "montage",
    transitionRole: "default",
  };

  if (montageSlots[effect]) {
    scene.photoSlots = [{
      slot: montageSlots[effect],
      count: 6,
      orient: "any",
      quality: "good",
      preferVariety: true,
    }];
    if (effect === "memory_wall") scene.params = { background };
    return scene;
  }

  if (effect === "double_exposure") {
    scene.photoSlots = [{
      slot: "pair",
      count: 2,
      orient: "any",
      quality: "best",
    }];
    return scene;
  }

  scene.photoSlots = [{
    slot: "hero",
    orient: effect === "portrait_reflection" ? "portrait" : "any",
    quality: "best",
  }];
  return scene;
}

let changed = 0;
for (const file of fs.readdirSync(templateDir).filter((name) => name.endsWith(".json"))) {
  const filePath = path.join(templateDir, file);
  const recipe = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const direction = directions[recipe.id];
  const tailIndexes = recipe.scenes
    .map((scene, index) => (/^s8[0-2]_/.test(scene.id) ? index : -1))
    .filter((index) => index >= 0);

  // Luminous Editorial Motion was authored independently and has no shared tail.
  if (!direction && tailIndexes.length === 0) continue;
  if (!direction) throw new Error(`Missing direction for ${recipe.id}`);
  if (tailIndexes.length !== 3) {
    throw new Error(`${recipe.id} has ${tailIndexes.length} shared tail scenes; expected 3`);
  }

  const memoryBackground = memoryBackgrounds[recipe.id];
  if (!memoryBackground) throw new Error(`${recipe.id} has no theme-tinted memory background`);

  tailIndexes.forEach((sceneIndex, index) => {
    recipe.scenes[sceneIndex] = makeScene({
      index,
      effect: direction[index],
      background: memoryBackground,
    });
  });

  fs.writeFileSync(filePath, `${JSON.stringify(recipe, null, 2)}\n`);
  changed += 1;
}

console.log(`Diversified three scalable scenes in ${changed} recipes.`);
