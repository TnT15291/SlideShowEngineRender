// Tier-2 node A — pick WHICH recipe (and theme) fits this couple.
//
// The strongest signal for choosing a recipe is the customer's own sentence
// ("một đám cưới ấm áp, mộc mạc"), not a vision score. That is a statement of
// intent, and per docs/token-saving-plan.md the AI optimises the film without
// overriding it. So this node reads the prompt, the music's shape and the photo
// counts — and never needs the vision node at all.
//
// Guardrail (Phụ lục A): the model may only return an id that already exists.
// The menu is built from story-templates/*.json and layouts/library.json, so it
// cannot drift from what the engine can actually render, and it cannot invent a
// recipe. Anything unknown falls back to a deterministic rule.
//
// Usage:
//   node scripts/pickRecipe.mjs --prompt <file> --music <analysis/music/x.json>
//     --photos <analysis/photos.json> [--recipes story-templates] [--out ...]
import fs from "node:fs";
import path from "node:path";
import { callDeepSeekJSON, hasKey, provenance, str, oneOf } from "./lib/deepseek.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const die = (msg) => {
  console.error(`[pickRecipe] FAILED: ${msg}`);
  process.exit(1);
};

const promptPath = arg("--prompt", "");
const musicPath = arg("--music", "");
const photosPath = arg("--photos", "analysis/photos.json");
const recipesDir = arg("--recipes", "story-templates");
const libraryPath = arg("--library", "layouts/library.json");
const outPath = arg("--out", "analysis/recipe_choice.json");

const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));

// --- the menu: whatever is on disk, never a hardcoded list -------------------
const recipeFiles = fs
  .readdirSync(path.resolve(root, recipesDir))
  .filter((f) => f.endsWith(".json"))
  .sort();
if (!recipeFiles.length) die(`no recipes in ${recipesDir}`);

const menu = recipeFiles.map((f) => {
  const r = readJson(`${recipesDir}/${f}`);
  return {
    id: r.id,
    file: `${recipesDir}/${f}`,
    name: r.name,
    theme: r.libraryTheme,
    bestFor: r.fit?.bestFor ?? [],
    minPhotos: r.fit?.minPhotos ?? 0,
    idealPhotos: r.fit?.idealPhotos ?? 0,
    notes: str(r.source?.notes ?? "", 300),
  };
});
const byId = new Map(menu.map((m) => [m.id, m]));
const themes = Object.keys(readJson(libraryPath).designTokens?.themes ?? {});

// --- deterministic facts CODE computes (the AI never counts) -----------------
const photos = readJson(photosPath).photos ?? [];
const portrait = photos.filter((p) => p.orient === "portrait").length;
const facts = {
  photoCount: photos.length,
  portrait,
  landscape: photos.length - portrait,
};
if (musicPath && fs.existsSync(path.resolve(root, musicPath))) {
  const m = readJson(musicPath);
  facts.musicSeconds = Math.round(m.duration ?? 0);
  facts.bpm = m.bpmEstimate ?? null;
  facts.sections = (m.sections ?? []).length;
  facts.calmSections = (m.sections ?? []).filter((s) => (s.energy ?? 0) < 0.4).length;
}
const prompt = promptPath && fs.existsSync(path.resolve(root, promptPath))
  ? fs.readFileSync(path.resolve(root, promptPath), "utf8").trim()
  : "";

/** Deterministic rule, used as the STUB and as the fallback when the model
 *  returns something that is not on the menu. Prefers a recipe whose photo
 *  budget this shoot can actually fill, then keyword overlap with the prompt. */
function ruleBased() {
  const words = prompt.toLowerCase();
  const hint = (tag) => (words.includes(tag) ? 1 : 0);
  const scored = menu.map((m) => {
    let score = 0;
    if (facts.photoCount >= m.minPhotos) score += 3;
    if (facts.photoCount >= m.idealPhotos) score += 1;
    // Vietnamese and English cues a customer actually writes.
    if (/ấm|warm|mộc|candid|giản dị|gia đình/.test(words) && m.bestFor.includes("family_warmth")) score += 3;
    if (/ấm|warm|film|phim nhựa|hoài niệm|vintage/.test(words) && m.theme === "warm_film") score += 2;
    if (/điện ảnh|cinematic|trầm|moody|sang/.test(words) && m.bestFor.includes("cinematic")) score += 3;
    if (/tối giản|minimal|hiện đại|modern/.test(words) && m.bestFor.includes("modern_minimal")) score += 3;
    if (/tạp chí|editorial|thời trang|fashion/.test(words) && m.bestFor.includes("editorial")) score += 3;
    score += hint("prewedding") && m.bestFor.includes("prewedding") ? 1 : 0;
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score || a.m.id.localeCompare(b.m.id));
  const top = scored[0];
  return {
    recipeId: top.m.id,
    themeId: top.m.theme,
    reason: prompt
      ? `rule: best keyword + photo-budget fit for the customer's prompt (score ${top.score})`
      : `rule: no prompt given; best photo-budget fit (score ${top.score})`,
  };
}

// --- the model only ever chooses from the menu -------------------------------
let choice = ruleBased();
let generatedBy = "stub";

if (hasKey()) {
  const raw = await callDeepSeekJSON({
    temperature: 0.2,
    system:
      `You choose ONE wedding-slideshow recipe for a couple. Return JSON: ` +
      `{"recipeId": "<id from the menu>", "themeId": "<id from the themes list>", "reason": "<one sentence>"}. ` +
      `Choose only ids that appear in the input. Do not invent a recipe, a theme, an effect, a duration or a file path. ` +
      `Weigh the customer's own words most heavily: they are stating what they want, and your job is to serve that, not to overrule it. ` +
      `Then weigh whether the shoot has enough photos for the recipe's budget, and whether the music's pace suits it.`,
    user: JSON.stringify({ customerPrompt: prompt, facts, menu, themes }),
  });

  // Guardrail: an id that is not on the menu is not a choice, it is a
  // hallucination. Fall back to the rule rather than render something that does
  // not exist.
  const id = oneOf(str(raw?.recipeId, 60), new Set(byId.keys()), null);
  if (id) {
    const picked = byId.get(id);
    choice = {
      recipeId: id,
      // A theme the library does not define would render as missing colour
      // tokens, so an unknown theme falls back to the recipe's own.
      themeId: oneOf(str(raw?.themeId, 60), new Set(themes), picked.theme),
      reason: str(raw?.reason, 240) || "model choice",
    };
    generatedBy = provenance();
  } else {
    choice.reason = `model returned an unknown recipe id (${str(raw?.recipeId, 40) || "none"}); ${choice.reason}`;
  }
}

const doc = {
  version: 1,
  generatedAt: new Date().toISOString(),
  generatedBy,
  recipeId: choice.recipeId,
  recipe: byId.get(choice.recipeId).file,
  themeId: choice.themeId,
  reason: choice.reason,
  consideredIds: menu.map((m) => m.id),
};
fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(doc, null, 2) + "\n");
console.log(
  `[pickRecipe] ${doc.recipeId} (theme ${doc.themeId}) -> ${outPath} — ${generatedBy}\n  ${doc.reason}`
);
