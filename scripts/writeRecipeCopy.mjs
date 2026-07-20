// Tier-2 node B — write the recipe's words for THIS couple.
//
// A recipe ships with canned copy ("Những ngày bên nhau"), which is what makes the
// cheap tier cheap and also what makes two customers receive the same sentences.
// This node rewrites only the copy, scene by scene, grounded in the customer's
// prompt and what the vision node saw in their photos.
//
// The blast radius is deliberately tiny, and that is the whole design:
//
//   * The model may return text for a (sceneId, slotId) pair that the RECIPE
//     already declares. Unknown scenes and unknown slots are dropped — it cannot
//     add a caption where the layout has nowhere to put one.
//   * It returns strings and nothing else. No file paths, no effects, no
//     durations, no geometry, no fonts. Those are not in the output shape and are
//     not read if present (Phụ lục A #4).
//   * Copy that is too long cannot break the frame: fitTextInTimeline measures
//     real glyph widths downstream and re-wraps/shrinks to fit the slot.
//
// So the worst a bad response can do is produce clumsy wording. It cannot produce
// a broken render.
//
// Usage:
//   node scripts/writeRecipeCopy.mjs --recipe story-templates/warm-film-01.json
//     --prompt <prompt.txt> [--content analysis/photo_content.json]
//     [--music analysis/music/x.json] [--out analysis/recipe_copy.json]
import fs from "node:fs";
import path from "node:path";
import { callDeepSeekJSON, hasKey, provenance, str } from "./lib/deepseek.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const die = (msg) => {
  console.error(`[writeRecipeCopy] FAILED: ${msg}`);
  process.exit(1);
};

const recipePath = arg("--recipe", "");
const promptPath = arg("--prompt", "");
const contentPath = arg("--content", "analysis/photo_content.json");
const musicPath = arg("--music", "");
const outPath = arg("--out", "analysis/recipe_copy.json");
const language = arg("--language", "vi");
const languageName = language === "en" ? "English" : "Vietnamese";
const MAX_CHARS = Number(arg("--max-chars", "120"));

if (!recipePath) die("--recipe <story-templates/x.json> is required");
const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const exists = (p) => p && fs.existsSync(path.resolve(root, p));

const recipe = readJson(recipePath);
const prompt = exists(promptPath) ? fs.readFileSync(path.resolve(root, promptPath), "utf8").trim() : "";

// --- what the recipe will actually accept -----------------------------------
// The contract is the recipe's own text map: these scene ids and these slot ids,
// nothing else. Build it once and use it both to prompt and to police.
//
// A slot whose value is a {{token}} is a FACT, not copy: the couple's names, their
// wedding date. The brief fills those. A language model asked to write a closing
// card will cheerfully invent "Linh & Nam · 15.03.2025" — observed, on a real run —
// and a fabricated name on the last frame of a wedding film is not a wording
// problem, it is the wrong film. So token slots are withheld from the model
// entirely: they are never offered, and never accepted back.
const TOKEN = /\{\{\s*\w+\s*\}\}/;
const rawValue = (v) => (v && typeof v === "object" ? String(v.value ?? "") : String(v ?? ""));

const slots = {};
const factSlots = {};
for (const scene of recipe.scenes ?? []) {
  const writable = [];
  const facts = [];
  for (const [id, value] of Object.entries(scene.text ?? {})) {
    (TOKEN.test(rawValue(value)) ? facts : writable).push(id);
  }
  if (writable.length) slots[scene.id] = writable;
  if (facts.length) factSlots[scene.id] = facts;
}
if (!Object.keys(slots).length) die(`recipe ${recipe.id} declares no writable text slots — nothing to write`);

/** The canned copy, which is also the STUB: with no key the recipe ships as-is.
 *  Token slots pass through untouched so applyStoryTemplate can fill them from
 *  the brief. */
function cannedCopy() {
  const out = {};
  for (const scene of recipe.scenes ?? []) {
    if (!scene.text) continue;
    out[scene.id] = {};
    for (const [slotId, raw] of Object.entries(scene.text)) {
      out[scene.id][slotId] = rawValue(raw);
    }
  }
  return out;
}

/** What the model is shown: the writable slots only. It is never even told what
 *  the closing card says, so it cannot be tempted to "improve" a name. */
function writableCopy() {
  const out = {};
  for (const [sceneId, ids] of Object.entries(slots)) {
    out[sceneId] = Object.fromEntries(ids.map((id) => [id, cannedCopy()[sceneId]?.[id] ?? ""]));
  }
  return out;
}

// --- grounding: what the photos are actually of ------------------------------
const grounding = { customerPrompt: prompt, recipeMood: recipe.name };
if (exists(contentPath)) {
  const content = readJson(contentPath);
  const rows = content.photos ?? [];
  const tally = (key) => {
    const counts = {};
    for (const r of rows) {
      const v = r[key];
      for (const item of Array.isArray(v) ? v : [v]) {
        if (item) counts[item] = (counts[item] ?? 0) + 1;
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  };
  grounding.photoTags = tally("tags");
  grounding.photoEmotions = tally("emotion");
  grounding.photoContentFrom = content.generatedBy ?? "unknown";
}
if (exists(musicPath)) {
  const m = readJson(musicPath);
  grounding.musicSeconds = Math.round(m.duration ?? 0);
  grounding.musicSections = (m.sections ?? []).length;
}

// --- generate ----------------------------------------------------------------
let copy = cannedCopy();
let generatedBy = "stub";
let rewritten = 0;

if (hasKey()) {
  const raw = await callDeepSeekJSON({
    temperature: 0.6,
    system:
      `You write the on-screen words for a wedding slideshow. Write every viewer-visible string in ${languageName} only. ` +
      `Return JSON: {"scenes": {"<sceneId>": {"<slotId>": "<text>"}}}. ` +
      `Use ONLY the sceneIds and slotIds given in "slots" — you may not add scenes or slots. ` +
      `Return text and nothing else: no file paths, no effects, no durations, no fonts, no numbers of seconds. ` +
      `Keep each line under ${MAX_CHARS} characters; short is better than clever, and an eyebrow or a date is a few words, not a sentence. ` +
      `NEVER invent a fact. You do not know the couple's names, their wedding date, or the name of their town — ` +
      `if it was not in the customer's own words, you may not put it on screen. Those slots are filled from the ` +
      `brief and are not offered to you. Write about what is THERE: the places, the moments, the feeling.`,
    user: JSON.stringify({ slots, currentCopy: writableCopy(), ...grounding }),
  });

  const scenes = raw?.scenes && typeof raw.scenes === "object" ? raw.scenes : {};
  for (const [sceneId, slotIds] of Object.entries(slots)) {
    const proposed = scenes[sceneId];
    if (!proposed || typeof proposed !== "object") continue;   // scene not rewritten: keep the recipe's line
    for (const slotId of slotIds) {
      const value = proposed[slotId];
      // Guardrail: strings only, and only for a slot this recipe declares. An
      // object here would be the model trying to hand back geometry or a font.
      if (typeof value !== "string") continue;
      const text = str(value.trim(), MAX_CHARS);
      if (!text) continue;
      copy[sceneId][slotId] = text;
      rewritten++;
    }
  }
  // Every unknown key the model invented is simply never read: `slots` is the
  // iteration source, not the response.
  const invented = Object.keys(scenes).filter((id) => !slots[id]);
  if (invented.length) console.warn(`[writeRecipeCopy] dropped ${invented.length} scene id(s) the recipe does not declare: ${invented.slice(0, 5).join(", ")}`);
  if (rewritten) generatedBy = provenance();
}

const totalSlots = Object.values(slots).reduce((n, ids) => n + ids.length, 0);
const withheld = Object.values(factSlots).reduce((n, ids) => n + ids.length, 0);
if (language === "en" && rewritten < totalSlots - withheld) {
  die(`English output requires all writable recipe text slots to be rewritten (${rewritten}/${totalSlots - withheld}); refusing to mix Vietnamese recipe copy into the video`);
}
const doc = {
  version: 1,
  language,
  generatedAt: new Date().toISOString(),
  generatedBy,
  recipeId: recipe.id,
  rewritten,
  totalSlots,
  // Named, not silent: whoever reads this file should be able to see that the
  // names and the date came from the brief and not from a model.
  factSlotsWithheld: withheld,
  scenes: copy,
};
fs.mkdirSync(path.dirname(path.resolve(root, outPath)), { recursive: true });
fs.writeFileSync(path.resolve(root, outPath), JSON.stringify(doc, null, 2) + "\n");
console.log(
  `[writeRecipeCopy] ${recipe.id}: ${rewritten}/${totalSlots} slot(s) rewritten -> ${outPath} — ${generatedBy}` +
    (generatedBy === "stub" ? " (recipe's own copy; set DEEPSEEK_API_KEY to personalise)" : "")
);
