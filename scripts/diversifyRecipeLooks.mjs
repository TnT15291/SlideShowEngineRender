import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const templateDir = path.join(root, "story-templates");
const layouts = JSON.parse(fs.readFileSync(path.join(root, "layouts/library.json"), "utf8")).layouts;
const layoutById = new Map(layouts.map((layout) => [layout.id, layout]));

// The scalable gallery tail used to be identical in nearly every recipe.
// Each recipe now owns a distinct 1-photo → 2-photo → 3-photo composition.
const recipeLooks = {
  "afterparty-pulse-01": ["gallery_matte_hero", "photo_duo", "arch_trio"],
  "cinematic-film-01": ["gallery_matte_hero", "photo_duo", "three_photo_row"],
  "cinematic-vows-01": ["gallery_matte_hero", "photo_duo", "polaroid_scatter"],
  "city-to-ceremony-01": ["gallery_matte_hero", "photo_duo", "paper_collage"],
  "classic-luxury-01": ["gallery_matte_hero", "photo_duo", "feature_plus_duo"],
  "classic-multisong-album-01": ["gallery_matte_hero", "duo_tinted_spread", "arch_trio"],
  "editorial-bold-01": ["gallery_matte_hero", "duo_tinted_spread", "polaroid_scatter"],
  "family-roots-01": ["gallery_matte_hero", "duo_tinted_spread", "paper_collage"],
  "four-seasons-love-01": ["gallery_matte_hero", "duo_tinted_spread", "three_photo_row"],
  "garden-botanical-01": ["gallery_matte_hero", "duo_tinted_spread", "feature_plus_duo"],
  "garden-diary-01": ["gallery_matte_hero", "magazine_page_turn", "three_photo_row"],
  "heritage-ceremony-01": ["gallery_matte_hero", "magazine_page_turn", "arch_trio"],
  "jmii-silk-botanical-01": ["gallery_matte_hero", "magazine_page_turn", "polaroid_scatter"],
  "korean-soft-01": ["gallery_matte_hero", "magazine_page_turn", "paper_collage"],
  "letters-to-forever-01": ["gallery_matte_hero", "magazine_page_turn", "feature_plus_duo"],
  "long-distance-love-01": ["full_bleed_quote", "magazine_page_turn", "arch_trio"],
  "luminous-editorial-motion-01": ["full_bleed_quote", "photo_duo", "three_photo_row"],
  "modern-teal-01": ["full_bleed_quote", "photo_duo", "arch_trio"],
  "playful-scrapbook-01": ["full_bleed_quote", "photo_duo", "paper_collage"],
  "studio-white-prewedding-01": ["full_bleed_quote", "photo_duo", "polaroid_scatter"],
  "three-chapters-biography-01": ["full_bleed_quote", "photo_duo", "feature_plus_duo"],
  "warm-film-01": ["full_bleed_quote", "duo_tinted_spread", "arch_trio"],
  "white-weddings-editorial-01": ["full_bleed_quote", "duo_tinted_spread", "feature_plus_duo"],
  "white-weddings-full-01": ["full_bleed_quote", "magazine_page_turn", "three_photo_row"],
};

function photoRequests(layoutId) {
  const layout = layoutById.get(layoutId);
  if (!layout) throw new Error(`Unknown layout: ${layoutId}`);
  if (layout.textRequired) throw new Error(`Gallery tail cannot use text-required layout: ${layoutId}`);
  return (layout.photoSlots || []).map((slot, index, slots) => ({
    slot: slot.id,
    orient: "any",
    quality: index === Math.floor(slots.length / 2) ? "best" : "good",
  }));
}

for (const file of fs.readdirSync(templateDir).filter((name) => name.endsWith(".json"))) {
  const filePath = path.join(templateDir, file);
  const recipe = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const selected = recipeLooks[recipe.id];
  if (!selected) throw new Error(`Missing look direction for ${recipe.id}`);

  const tail = recipe.scenes.filter((scene) => /^s8[345]_/.test(scene.id));
  if (tail.length !== 3) throw new Error(`${recipe.id} has ${tail.length} scalable tail layouts; expected 3`);

  tail.forEach((scene, index) => {
    scene.layout = selected[index];
    scene.photoSlots = photoRequests(selected[index]);
  });

  fs.writeFileSync(filePath, `${JSON.stringify(recipe, null, 2)}\n`);
}

console.log(`Diversified scalable gallery looks for ${Object.keys(recipeLooks).length} recipes.`);
