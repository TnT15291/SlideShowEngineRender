// Phase B / node 3 — STORY OPTIONS.
//
// The first "director" node: given WHAT is in the photo set (from node 2's
// semantic pass) plus an optional client brief, propose FOUR distinct ways to
// tell the story. This is emotion/narrative reasoning only — no effects, no
// transitions, no durations. Those come later (director_notes, node 5+6).
//
// Grounding rule (Phụ lục A #3): the model never sees 89 raw records and never
// invents counts. The scaffold computes a deterministic PROFILE (tag/emotion/
// orientation distribution, hero count) from analysis/photo_content.json and
// feeds THAT. The model only supplies the qualitative directions, and
// validateStoryOptions() below trims + enum-clamps every field it returns.
//
// No DEEPSEEK_API_KEY -> deterministic STUB (four house archetypes) so node 4
// and the rest of the pipeline can still run. See schema/story-options.schema.json.
//
// Usage: node scripts/generateStoryOptions.mjs [--content analysis/photo_content.json]
//        [--brief "5-minute cinematic Korean-style film"] [--out analysis/story_options.json]
import fs from "node:fs";
import path from "node:path";
import { hasKey, provenance, defaultModel, callDeepSeekJSON, str, oneOf } from "./lib/deepseek.mjs";
import { loadLedger, active } from "./lib/directives.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const contentPath = arg("--content", "analysis/photo_content.json");
const directivesPath = arg("--directives", "");
const outPath = arg("--out", "analysis/story_options.json");
const language = arg("--language", "vi");
const languageName = language === "en" ? "English" : "Vietnamese";

// The customer's own words. This node ACCEPTED a brief for its whole life and the
// orchestrator never passed one — so every premium film was pitched by a director who
// had not read what the couple wrote. The four story directions are the first thing
// the customer sees; proposing four that ignore their brief guarantees the first
// revision round is spent watching them retype it.
const ledger = directivesPath ? loadLedger(directivesPath) : { story: "", directives: [] };
const briefText = arg("--brief", "") || ledger.story || "";
// Node 3 reasons about narrative only — effects and transitions are node 5/6's job —
// but pacing and length ARE narrative shape, so those orders belong in the pitch.
const shapeOrders = active(ledger).filter((d) => (d.kind === "pacing" || d.kind === "duration") && d.op === "set");

const IDS = ["A", "B", "C", "D"];
const PACING = new Set(["slow", "medium", "fast", "dynamic"]);
const HERO_THRESHOLD = 0.6;

// --- load node 2 output ----------------------------------------------------
const absContent = path.resolve(root, contentPath);
if (!fs.existsSync(absContent)) {
  console.error(
    `[generateStoryOptions] ${contentPath} not found.\n` +
      `Run node 2 first:  node scripts/analyzePhotoContent.mjs`
  );
  process.exit(1);
}
const content = JSON.parse(fs.readFileSync(absContent, "utf8"));
const photos = Array.isArray(content?.photos) ? content.photos : [];
if (photos.length === 0) {
  console.error(`[generateStoryOptions] ${contentPath} has no photo records.`);
  process.exit(1);
}

// --- deterministic profile (the numbers the AI is NOT allowed to invent) ---
function buildProfile(records) {
  const tags = {}, emotions = {}, orient = {};
  let heroCount = 0;
  for (const p of records) {
    for (const t of p.tags || []) tags[t] = (tags[t] || 0) + 1;
    if (p.emotion) emotions[p.emotion] = (emotions[p.emotion] || 0) + 1;
    if (p.orient) orient[p.orient] = (orient[p.orient] || 0) + 1;
    if ((p.heroScore ?? 0) >= HERO_THRESHOLD) heroCount++;
  }
  const topEmotion = Object.entries(emotions).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return { count: records.length, tags, emotions, orient, heroCount, topEmotion };
}
const profile = buildProfile(photos);

// --- prompts ---------------------------------------------------------------
function buildSystem() {
  return [
    `Write every viewer-visible string in ${languageName} only.`,
    "You are a wedding-film creative director. From a summary of what a couple's photo set contains, you propose FOUR clearly different ways to tell their story.",
    "Think ONLY about emotion, narrative and rhythm. Do NOT mention video effects, transitions, software, durations, or file names — another stage handles all of that.",
    "The four options must be genuinely distinct in feeling (e.g. elegant/minimal vs. warm/chronological vs. dreamy/soft vs. relationships-and-joy), not four rewordings of one idea.",
    "Order them best-fit-first for THIS particular photo set.",
    "Return ONE JSON object exactly of the form:",
    '{"options":[{"title":str,"mood":str,"pacing":"slow|medium|fast|dynamic","emotionalArc":str,"summary":str,"captionTone":str,"fitReason":str}, ... exactly 4 ]}',
    "Keep every string short (title <=6 words, summary 1-2 sentences).",
  ].join("\n");
}
function buildUser() {
  const lines = [
    `Photo set profile (${profile.count} selected photos):`,
    `- content tags: ${fmtCounts(profile.tags)}`,
    `- emotions: ${fmtCounts(profile.emotions)}`,
    `- orientation: ${fmtCounts(profile.orient)}`,
    `- strong hero-worthy photos: ${profile.heroCount}`,
    profile.topEmotion ? `- dominant emotion: ${profile.topEmotion}` : "",
  ];
  if (briefText) lines.push("", `The couple's own brief — every option must be a way of telling THIS story:`, briefText);
  if (shapeOrders.length) {
    lines.push("", "They also asked for, and you must not contradict:");
    for (const d of shapeOrders) {
      lines.push(d.kind === "duration"
        ? `- a film of about ${d.target} seconds ("${d.quote}")`
        : `- ${d.target} pacing ("${d.quote}")`);
    }
  }
  lines.push("", "Propose the four story directions now.");
  return lines.filter(Boolean).join("\n");
}
function fmtCounts(obj) {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(", ") : "(none tagged)";
}

// --- STUB: four house archetypes (deterministic) ---------------------------
function stubOptions() {
  return [
    { title: "Luxury Wedding Film", mood: "elegant, refined, unhurried", pacing: "slow",
      emotionalArc: "quiet awe that swells to a graceful, glowing finale",
      summary: "A minimal, cinematic edit that lets the strongest images breathe with sparse, tasteful text.",
      captionTone: "minimal and poetic", fitReason: "suits sets with several strong hero-worthy frames." },
    { title: "A Day To Remember", mood: "warm, heartfelt, chronological", pacing: "medium",
      emotionalArc: "gentle beginning, rising warmth, tearful-happy peak, soft landing",
      summary: "Tells the day in order, leaning into candid, emotional moments and family warmth.",
      captionTone: "warm and personal", fitReason: "works when the set spans getting-ready through celebration." },
    { title: "Korean Romance", mood: "dreamy, soft, bright", pacing: "medium",
      emotionalArc: "airy and tender throughout, blooming at the couple moments",
      summary: "A light, romantic mood board of close, tender couple frames with a delicate feel.",
      captionTone: "gentle and sparse", fitReason: "flatters portrait-heavy, tender couple photography." },
    { title: "Family & Friends", mood: "joyful, lively, connected", pacing: "dynamic",
      emotionalArc: "playful energy building to a big, joyful group finale",
      summary: "Centres the people around the couple — laughter, groups and celebration.",
      captionTone: "warm and upbeat", fitReason: "shines when there are many group and candid photos." },
  ];
}

// --- guardrail: coerce raw options onto the contract -----------------------
function validateStoryOptions(raw) {
  const arr = Array.isArray(raw) ? raw : [];
  const out = [];
  for (let i = 0; i < IDS.length; i++) {
    const o = arr[i] || {};
    const rec = {
      id: IDS[i], // scaffold owns the id — not trusted from the model
      title: str(o.title, 60) || `Story ${IDS[i]}`,
      mood: str(o.mood, 120) || "heartfelt",
      pacing: oneOf(o.pacing, PACING, "medium"),
      emotionalArc: str(o.emotionalArc, 200) || "a gentle rise to a warm finale",
      summary: str(o.summary, 300) || "A tasteful edit of this couple's story.",
    };
    const captionTone = str(o.captionTone, 120);
    if (captionTone) rec.captionTone = captionTone;
    const fitReason = str(o.fitReason, 240);
    if (fitReason) rec.fitReason = fitReason;
    out.push(rec);
  }
  return out;
}

// --- run -------------------------------------------------------------------
const model = defaultModel;
let rawOptions;
if (hasKey()) {
  process.stdout.write("  DeepSeek story-options call... ");
  const parsed = await callDeepSeekJSON({ system: buildSystem(), user: buildUser(), temperature: 0.7 });
  rawOptions = Array.isArray(parsed) ? parsed : parsed.options ?? parsed.results ?? [];
  console.log("ok");
} else {
  rawOptions = stubOptions();
}
const options = validateStoryOptions(rawOptions);

// Persuading the model is not the same as obeying the customer. If they ordered a
// pacing, all four options are that pacing — the choice they were offered is WHICH
// STORY, not whether we listened.
const pacingOrder = shapeOrders.find((d) => d.kind === "pacing" && d.strength === "must");
if (pacingOrder) for (const o of options) o.pacing = pacingOrder.target;

const out = {
  language,
  generatedBy: provenance(model),
  ...(hasKey() ? { model: `deepseek/${model}` } : {}),
  generatedAt: new Date().toISOString(),
  profile,
  options,
  recommended: options[0].id, // default pick for node 4 (best-fit-first ordering)
};

const absOut = path.resolve(root, outPath);
fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(absOut, JSON.stringify(out, null, 2));

const note = hasKey() ? "" : " (STUB — set DEEPSEEK_API_KEY for real story options)";
console.log(
  `[generateStoryOptions] ${options.length} options (${options.map((o) => o.title).join(" · ")}) -> ${outPath}${note}`
);
