// Phase B / node 7 — STORY PLAN.
//
// Structures the film into five acts — Opening → Love Story → Ceremony →
// Family & Friends → Ending — using the chosen direction, the director notes,
// and what content the photo set actually has. Each act declares its goal,
// feeling, rhythm, which content tags it pulls, a caption idea, and ONE priority
// effect. This is the bridge the timeline node (Phase C) walks act by act.
//
// Grounding (Phụ lục A #3): emphasis is a coarse low/medium/high dial, never a
// duration — the timeline generator sets real seconds from music energy. The
// guardrail keeps segments in the fixed ordered set, clamps emotion/pacing/
// emphasis/effect to their enums, and filters photoTags to the vocabulary.
//
// No DEEPSEEK_API_KEY -> deterministic STUB (a sensible five-act plan biased by
// the director notes' effects) so Phase C can run. See schema/story-plan.schema.json.
//
// Usage: node scripts/generateStoryPlan.mjs [--notes analysis/director_notes.json]
//        [--content analysis/photo_content.json] [--out analysis/story_plan.json]
import fs from "node:fs";
import path from "node:path";
import { hasKey, provenance, defaultModel, callDeepSeekJSON, str, oneOf, filterVocab } from "./lib/deepseek.mjs";
import { TAG_VOCAB, EMOTION_VOCAB } from "./lib/vocab.mjs";
import { loadLedger, active, applyToStoryPlan } from "./lib/directives.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const directivesPath = arg("--directives", "");
const notesPath = arg("--notes", "analysis/director_notes.json");
const contentPath = arg("--content", "analysis/photo_content.json");
const outPath = arg("--out", "analysis/story_plan.json");
const language = arg("--language", "vi");
const languageName = language === "en" ? "English" : "Vietnamese";

const SEGMENTS = ["opening", "love_story", "ceremony", "family_friends", "ending"];
const PACING = new Set(["slow", "medium", "fast", "dynamic"]);
const EMPHASIS = new Set(["low", "medium", "high"]);
// Tag + emotion vocabularies come from the schema, same as the effect whitelist below.
const EMOTIONS = EMOTION_VOCAB;

// engine effect whitelist (single source of truth)
const tlSchema = JSON.parse(fs.readFileSync(path.resolve(root, "schema/timeline.schema.json"), "utf8"));
const EFFECTS = new Set(tlSchema.$defs.effect.enum);

// --- load director notes ---------------------------------------------------
const absNotes = path.resolve(root, notesPath);
if (!fs.existsSync(absNotes)) {
  console.error(
    `[generateStoryPlan] ${notesPath} not found.\n` +
      `Run node 5+6 first:  node scripts/generateDirectorNotes.mjs`
  );
  process.exit(1);
}
const notesDoc = JSON.parse(fs.readFileSync(absNotes, "utf8"));
const dn = notesDoc.director_notes || {};
const choice = notesDoc.choice || "A";

// --- available tags from photo content (so the plan pulls what exists) -----
let availableTags = [];
const absContent = path.resolve(root, contentPath);
if (fs.existsSync(absContent)) {
  const content = JSON.parse(fs.readFileSync(absContent, "utf8"));
  const counts = {};
  for (const p of content.photos || []) for (const t of p.tags || []) counts[t] = (counts[t] || 0) + 1;
  availableTags = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

// --- prompts ---------------------------------------------------------------
function buildSystem() {
  return [
    `Write every viewer-visible string in ${languageName} only. Keep act and engine enum values unchanged.`,
    "You are structuring a wedding film into exactly five acts, in this order:",
    "opening, love_story, ceremony, family_friends, ending.",
    "For each act give: goal, emotion, pacing, emphasis, photoTags, priorityEffect, captionIdea.",
    `emotion is one of: ${[...EMOTIONS].join(", ")}.`,
    "pacing is one of: slow, medium, fast, dynamic. emphasis is one of: low, medium, high (relative screen time — NOT seconds).",
    `photoTags come only from: ${[...TAG_VOCAB].join(", ")}.`,
    `priorityEffect is ONE of these engine effects: ${[...EFFECTS].join(", ")}.`,
    "Do NOT output durations, counts, coordinates, or file names.",
    'Return ONE JSON object: {"segments":[{"segment":"opening",...}, ... all five in order ]}.',
  ].join("\n");
}
function buildUser() {
  const lines = [
    `Chosen direction ${choice}: ${notesDoc.storyTitle || ""}`,
    `Creative brief style: ${notesDoc.creative_brief?.style || ""}`,
    `Director notes — hero=${dn.heroEffect}, portrait=${dn.portraitEffect}, group=${dn.groupEffect}, detail=${dn.detailEffect}, opening=${dn.openingEffect}, montage=${dn.montageEffect}.`,
    availableTags.length ? `Content actually present, most common first: ${availableTags.join(", ")}.` : "",
    "",
    "Write the five-act plan now.",
  ];
  return lines.filter(Boolean).join("\n");
}

// --- STUB: sensible five-act plan biased by the director notes -------------
function stubSegments() {
  const has = (t) => availableTags.includes(t);
  const pick = (...cands) => { const f = cands.filter(has); return f.length ? f : cands.slice(0, 2); };
  return [
    { segment: "opening", goal: "Set the tone and introduce the couple.", emotion: "calm", pacing: "slow", emphasis: "medium",
      photoTags: pick("couple", "portrait", "scenery"), priorityEffect: dn.openingEffect || "slow_zoom_in",
      captionIdea: "Names and date, quietly stated." },
    { segment: "love_story", goal: "Trace how their relationship grew.", emotion: "romantic", pacing: "medium", emphasis: "high",
      photoTags: pick("couple", "candid", "portrait"), priorityEffect: dn.heroEffect || "dark_feather",
      captionIdea: "Short lines about their journey together." },
    { segment: "ceremony", goal: "Honour the vows and the moment they marry.", emotion: "tender", pacing: "slow", emphasis: "high",
      photoTags: pick("ceremony", "vows", "rings", "kiss"), priorityEffect: dn.portraitEffect || "portrait_blur_background",
      captionIdea: "A single vow-like line." },
    { segment: "family_friends", goal: "Celebrate the people around them.", emotion: "joyful", pacing: "dynamic", emphasis: "medium",
      photoTags: pick("family", "friends", "group", "party"), priorityEffect: dn.groupEffect || "collage_grid",
      captionIdea: "Warmth and gratitude to loved ones." },
    { segment: "ending", goal: "Close on a lasting, hopeful note.", emotion: "romantic", pacing: "slow", emphasis: "medium",
      photoTags: pick("couple", "portrait"), priorityEffect: dn.heroEffect || "dark_feather",
      captionIdea: "Names again, and a thank-you or a date." },
  ];
}

// --- guardrail: rebuild segments in canonical order, enum-clamped ----------
function validateSegments(raw) {
  const byName = new Map();
  for (const s of Array.isArray(raw) ? raw : []) {
    if (s && SEGMENTS.includes(s.segment) && !byName.has(s.segment)) byName.set(s.segment, s);
  }
  const stub = stubSegments();
  const stubByName = new Map(stub.map((s) => [s.segment, s]));
  return SEGMENTS.map((name) => {
    const s = byName.get(name) || {};
    const d = stubByName.get(name);
    const tags = filterVocab(s.photoTags, TAG_VOCAB);
    return {
      segment: name,
      goal: str(s.goal, 200) || d.goal,
      emotion: oneOf(s.emotion, EMOTIONS, d.emotion),
      pacing: oneOf(s.pacing, PACING, d.pacing),
      emphasis: oneOf(s.emphasis, EMPHASIS, d.emphasis),
      photoTags: tags.length ? tags : d.photoTags,
      priorityEffect: oneOf(s.priorityEffect, EFFECTS, d.priorityEffect),
      captionIdea: str(s.captionIdea, 200) || d.captionIdea,
    };
  });
}

// --- run -------------------------------------------------------------------
const model = defaultModel;
let raw;
if (hasKey()) {
  process.stdout.write("  DeepSeek story-plan call... ");
  const parsed = await callDeepSeekJSON({ system: buildSystem(), user: buildUser(), temperature: 0.5 });
  raw = Array.isArray(parsed) ? parsed : parsed.segments ?? parsed.results ?? [];
  console.log("ok");
} else {
  raw = stubSegments();
}
const segments = validateSegments(raw);

const out = {
  language,
  generatedBy: provenance(model),
  ...(hasKey() ? { model: `deepseek/${model}` } : {}),
  generatedAt: new Date().toISOString(),
  choice,
  segments,
};

// Act-scoped orders land here, and only here: "đoạn bạn bè nhanh hơn" is a fact about
// one act of the plan, not about the film. Applied after the guardrail so a clamped
// enum can never overwrite what the customer actually asked for.
const ledger = directivesPath ? loadLedger(directivesPath) : { directives: [] };
const enforced = applyToStoryPlan(out, active(ledger));
if (enforced.length) out.enforcedDirectives = enforced;

const absOut = path.resolve(root, outPath);
fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(absOut, JSON.stringify(out, null, 2));

const note = hasKey() ? "" : " (STUB — set DEEPSEEK_API_KEY for a real story plan)";
console.log(
  `[generateStoryPlan] ${segments.length} acts -> ${outPath}${note}\n  ` +
    segments.map((s) => `${s.segment}:${s.priorityEffect}`).join("  ")
);
