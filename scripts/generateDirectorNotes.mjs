// Phase B / nodes 5+6 — CREATIVE BRIEF + DIRECTOR NOTES (one DeepSeek call).
//
// Node 5 (creative brief) and node 6 (director notes) are one continuous line of
// reasoning — "what feeling" then "how to get it out of THIS engine" — so we ask
// for both halves in a single structured JSON response (saves a round-trip, per
// the design's cost-cut). The brief half is free qualitative direction; the
// director half is the guardrailed half.
//
// GUARDRAIL (Phụ lục A — load-bearing, DeepSeek does not enforce our schema):
//   1. Whitelist enums: every effect/transition/curves/easing/overlay value is
//      clamped to the engine's real vocabulary, loaded live from
//      schema/timeline.schema.json so it can never drift from engine capability.
//      Unknown values -> safe defaults.
//   2. No sensitive numbers: the model chooses NO durations, coordinates, cut
//      points, or quality — this node emits none, so there is nothing to sneak in.
//   3. Permission isolation: the model sets no file paths / quality / system
//      config; we only read the known keys below (extras are ignored).
//
// No DEEPSEEK_API_KEY -> deterministic STUB tuned to the chosen story option, so
// the rest of the pipeline runs. See schema/director-notes.schema.json.
//
// Usage: node scripts/generateDirectorNotes.mjs [--options analysis/story_options.json]
//        [--selection analysis/selected_story.json] [--choice A]
//        [--music "music/a thousand years.mp3"] [--assets analysis/assets_catalog.ai.json]
//        [--out analysis/director_notes.json]
import fs from "node:fs";
import path from "node:path";
import { hasKey, provenance, defaultModel, callDeepSeekJSON, str, oneOf } from "./lib/deepseek.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const optionsPath = arg("--options", "analysis/story_options.json");
const choiceArg = (arg("--choice", "") || "").toUpperCase();
const selectionPath = arg("--selection", "analysis/selected_story.json");
const musicPath = arg("--music", "");
const assetsPath = arg("--assets", "analysis/assets_catalog.ai.json"); // shared engine assets, not per-job
const outPath = arg("--out", "analysis/director_notes.json");
// Music ANALYSIS lives beside the job that produced it. Resolving it from a fixed
// root path meant a project silently read another job's analysis whenever the two
// tracks happened to share a filename — and it "worked", which is worse.
const analysisDir = arg("--analysis-dir", path.dirname(outPath)).replace(/\\/g, "/").replace(/\/$/, "");

const PACING = new Set(["slow", "medium", "fast", "dynamic"]);
const EASING = new Set(["gentle", "snap", "bounce"]);
const MONTAGE = new Set(["film_roll_up", "film_roll_left", "film_roll_right"]);
const OVERLAY = new Set(["warm", "soft", "sunset"]);

// --- engine vocabulary (single source of truth = timeline.schema.json) ------
const tlSchema = JSON.parse(fs.readFileSync(path.resolve(root, "schema/timeline.schema.json"), "utf8"));
const EFFECTS = new Set(tlSchema.$defs.effect.enum);
const TRANSITIONS = new Set(tlSchema.$defs.transitionType.enum);
const CURVES = new Set(tlSchema.$defs.curvesPreset.enum);

// --- load the chosen story option ------------------------------------------
const absOptions = path.resolve(root, optionsPath);
if (!fs.existsSync(absOptions)) {
  console.error(
    `[generateDirectorNotes] ${optionsPath} not found.\n` +
      `Run node 3 first:  node scripts/generateStoryOptions.mjs`
  );
  process.exit(1);
}
const optionsDoc = JSON.parse(fs.readFileSync(absOptions, "utf8"));
let selectionDoc = null;
const absSelection = path.resolve(root, selectionPath);
if (!choiceArg && fs.existsSync(absSelection)) {
  selectionDoc = JSON.parse(fs.readFileSync(absSelection, "utf8"));
}
const choice = /^[ABCD]$/.test(choiceArg)
  ? choiceArg
  : (/^[ABCD]$/.test(selectionDoc?.choice) ? selectionDoc.choice : (optionsDoc.recommended || "A"));
const chosen = (optionsDoc.options || []).find((o) => o.id === choice);
if (!chosen) {
  console.error(`[generateDirectorNotes] option ${choice} not found in ${optionsPath}.`);
  process.exit(1);
}

// optional music summary (pacing context only — numbers stay in analyzeMusic)
let musicSummary = null;
if (musicPath) {
  const name = path.basename(musicPath).replace(/\.[^.]+$/, "");
  const abs = path.resolve(root, `${analysisDir}/music/${name}.json`);
  if (fs.existsSync(abs)) {
    const m = JSON.parse(fs.readFileSync(abs, "utf8"));
    musicSummary = { bpm: m.bpmEstimate, energy: m.energy?.mean };
  }
}

function loadAssetMenu() {
  const abs = path.resolve(root, assetsPath);
  if (!fs.existsSync(abs)) return null;
  try {
    const doc = JSON.parse(fs.readFileSync(abs, "utf8"));
    const slim = (xs, max) => Array.isArray(xs)
      ? xs.slice(0, max).map((a) => ({
        id: a.id,
        label: a.label,
        mood: a.mood,
        bestFor: a.bestFor,
        roles: a.roles,
        supportsVietnamese: a.supportsVietnamese,
        readability: a.readability,
        variant: a.variant,
      }))
      : [];
    return {
      fonts: slim(doc.fonts, 14),
      overlays: slim(doc.overlays, 16),
      backgrounds: slim(doc.backgrounds, 16),
      frames: slim(doc.frames, 16),
    };
  } catch {
    return null;
  }
}
const assetMenu = loadAssetMenu();
const assetIds = {
  fonts: new Set(assetMenu?.fonts?.map((a) => a.id) || []),
  overlays: new Set(assetMenu?.overlays?.map((a) => a.id) || []),
  backgrounds: new Set(assetMenu?.backgrounds?.map((a) => a.id) || []),
  frames: new Set(assetMenu?.frames?.map((a) => a.id) || []),
};

// --- prompts ---------------------------------------------------------------
function buildSystem() {
  return [
    "You are the director of a wedding film. You are given ONE chosen story direction and must turn it into (1) a creative brief and (2) concrete direction for a fixed render engine.",
    "You DECIDE FEELING AND WHICH TOOLS TO USE. You do NOT decide numbers: never output durations, timings, coordinates, cut points, file paths, or quality settings — other stages compute those.",
    "",
    "Choose effects/transitions ONLY from these engine vocabularies (exact strings):",
    `EFFECTS: ${[...EFFECTS].join(", ")}`,
    `TRANSITIONS: ${[...TRANSITIONS].join(", ")}`,
    `COLOR CURVES: ${[...CURVES].join(", ")} (or null)`,
    "MONTAGE EFFECT must be one of: film_roll_up, film_roll_left, film_roll_right.",
    "EASING must be one of: gentle, snap, bounce. OVERLAY must be one of: warm, soft, sunset, or null.",
    "",
    "Return ONE JSON object of exactly this shape:",
    '{"creative_brief":{"style":str,"emotionalArc":str,"colorMood":str,"captionPhilosophy":str,"pacing":"slow|medium|fast|dynamic","structure":str,"photoSelection":str},',
    '"director_notes":{"openingEffect":effect,"defaultTransition":transition,"endingTransition":transition,"montageEffect":montage,"heroEffect":effect,"portraitEffect":effect,"groupEffect":effect,"detailEffect":effect,"colorCurves":curves_or_null,"overlayVariant":overlay_or_null,"easingCalm":easing,"easingEnergetic":easing,"notes":[str,...]},',
    '"asset_choices":{"titleFontId":font_id_or_null,"bodyFontId":font_id_or_null,"overlayId":overlay_id_or_null,"openingBackgroundId":background_id_or_null,"endingBackgroundId":background_id_or_null,"frameId":frame_id_or_null}}',
  ].join("\n");
}
function buildUser() {
  const lines = [
    `Chosen story direction (${chosen.id}): ${chosen.title}`,
    `- mood: ${chosen.mood}`,
    `- pacing: ${chosen.pacing}`,
    `- emotional arc: ${chosen.emotionalArc}`,
    `- summary: ${chosen.summary}`,
    chosen.captionTone ? `- caption tone: ${chosen.captionTone}` : "",
  ];
  const p = optionsDoc.profile;
  if (p) {
    lines.push("", `Photo set: ${p.count} photos, ${p.heroCount} hero-worthy, dominant emotion ${p.topEmotion || "n/a"}.`);
    if (p.tags) lines.push(`Content tags present: ${Object.keys(p.tags).join(", ") || "none"}.`);
  }
  if (musicSummary) lines.push("", `Music: ~${musicSummary.bpm} BPM, energy ${Number(musicSummary.energy ?? 0).toFixed(2)} (context for pacing only).`);
  if (assetMenu) {
    lines.push(
      "",
      "Local asset menu. Choose ids only; do not invent ids and do not output paths.",
      JSON.stringify(assetMenu)
    );
  }
  lines.push("", "Write the creative brief and director notes now.");
  return lines.filter(Boolean).join("\n");
}

// --- STUB: house defaults biased by the chosen pacing ----------------------
function stubDoc() {
  const energetic = chosen.pacing === "fast" || chosen.pacing === "dynamic";
  return {
    creative_brief: {
      style: `${chosen.title} — ${chosen.mood}.`,
      emotionalArc: chosen.emotionalArc,
      colorMood: energetic ? "bright, warm, lively" : "warm, soft, filmic",
      captionPhilosophy: chosen.captionTone || "sparse, tasteful Vietnamese captions that support the image, never crowd it",
      pacing: oneOf(chosen.pacing, PACING, "medium"),
      structure: "Opening → Love Story → Ceremony → Family & Friends → Ending.",
      photoSelection: "Lead with hero-worthy frames; group candids into montages; keep tender portraits full and unhurried.",
    },
    director_notes: {
      openingEffect: "slow_zoom_in",
      defaultTransition: "crossfade",
      endingTransition: energetic ? "fade_to_white" : "fade_slow",
      montageEffect: energetic ? "film_roll_left" : "film_roll_up",
      heroEffect: "dark_feather",
      portraitEffect: "portrait_blur_background",
      groupEffect: "collage_grid",
      detailEffect: "circle_focus",
      colorCurves: energetic ? null : "vintage",
      overlayVariant: energetic ? "warm" : "soft",
      easingCalm: "gentle",
      easingEnergetic: energetic ? "snap" : "gentle",
      notes: [
        `Hold hero frames a beat longer to honour the ${chosen.mood} tone.`,
        "Reserve bounce easing for at most one playful peak.",
      ],
    },
    asset_choices: {
      titleFontId: assetIds.fonts.has("font_playfairdisplay") ? "font_playfairdisplay" : null,
      bodyFontId: assetIds.fonts.has("font_bevietnampro") ? "font_bevietnampro" : null,
      overlayId: energetic
        ? (assetIds.overlays.has("ov_light_leak_warm") ? "ov_light_leak_warm" : null)
        : (assetIds.overlays.has("ov_light_leak_soft") ? "ov_light_leak_soft" : null),
      openingBackgroundId: assetMenu?.backgrounds?.[0]?.id || null,
      endingBackgroundId: assetMenu?.backgrounds?.[0]?.id || null,
      frameId: assetMenu?.frames?.find((a) => /floral|corner/i.test(a.id))?.id || null,
    },
  };
}

// --- guardrail: clamp raw model output onto the engine vocabulary ----------
function effect(v, fallback) { return oneOf(v, EFFECTS, fallback); }
function transition(v, fallback) { return oneOf(v, TRANSITIONS, fallback); }

function validateBrief(raw) {
  const b = raw && typeof raw === "object" ? raw : {};
  return {
    style: str(b.style, 200) || `${chosen.title}.`,
    emotionalArc: str(b.emotionalArc, 240) || chosen.emotionalArc,
    colorMood: str(b.colorMood, 160) || "warm, soft, filmic",
    captionPhilosophy: str(b.captionPhilosophy, 200) || "sparse, tasteful captions that support the image",
    pacing: oneOf(b.pacing, PACING, oneOf(chosen.pacing, PACING, "medium")),
    structure: str(b.structure, 240) || "Opening → Love Story → Ceremony → Family & Friends → Ending.",
    photoSelection: str(b.photoSelection, 240) || "Lead with hero frames; montage the candids.",
  };
}
function validateNotes(raw) {
  const d = raw && typeof raw === "object" ? raw : {};
  const curves = d.colorCurves == null ? null : oneOf(d.colorCurves, CURVES, null);
  const overlay = d.overlayVariant == null ? null : oneOf(d.overlayVariant, OVERLAY, null);
  const notes = Array.isArray(d.notes)
    ? d.notes.map((n) => str(n, 200)).filter(Boolean).slice(0, 6)
    : [];
  return {
    openingEffect: effect(d.openingEffect, "slow_zoom_in"),
    defaultTransition: transition(d.defaultTransition, "crossfade"),
    endingTransition: transition(d.endingTransition, "fade_slow"),
    montageEffect: oneOf(d.montageEffect, MONTAGE, "film_roll_up"),
    heroEffect: effect(d.heroEffect, "dark_feather"),
    portraitEffect: effect(d.portraitEffect, "portrait_blur_background"),
    groupEffect: effect(d.groupEffect, "collage_grid"),
    detailEffect: effect(d.detailEffect, "circle_focus"),
    colorCurves: curves,
    overlayVariant: overlay,
    easingCalm: oneOf(d.easingCalm, EASING, "gentle"),
    easingEnergetic: oneOf(d.easingEnergetic, EASING, "snap"),
    ...(notes.length ? { notes } : {}),
  };
}

function knownId(v, ids) {
  return typeof v === "string" && ids.has(v) ? v : null;
}
function validateAssetChoices(raw) {
  const a = raw && typeof raw === "object" ? raw : {};
  return {
    titleFontId: knownId(a.titleFontId, assetIds.fonts),
    bodyFontId: knownId(a.bodyFontId, assetIds.fonts),
    overlayId: knownId(a.overlayId, assetIds.overlays),
    openingBackgroundId: knownId(a.openingBackgroundId, assetIds.backgrounds),
    endingBackgroundId: knownId(a.endingBackgroundId, assetIds.backgrounds),
    frameId: knownId(a.frameId, assetIds.frames),
  };
}

// --- run -------------------------------------------------------------------
const model = defaultModel;
let raw;
if (hasKey()) {
  process.stdout.write("  DeepSeek director-notes call... ");
  raw = await callDeepSeekJSON({ system: buildSystem(), user: buildUser(), temperature: 0.5 });
  console.log("ok");
} else {
  raw = stubDoc();
}

const out = {
  generatedBy: provenance(model),
  ...(hasKey() ? { model: `deepseek/${model}` } : {}),
  generatedAt: new Date().toISOString(),
  choice,
  storyTitle: str(chosen.title, 60),
  creative_brief: validateBrief(raw.creative_brief),
  director_notes: validateNotes(raw.director_notes),
  asset_choices: validateAssetChoices(raw.asset_choices),
};

const absOut = path.resolve(root, outPath);
fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(absOut, JSON.stringify(out, null, 2));

const note = hasKey() ? "" : " (STUB — set DEEPSEEK_API_KEY for real director notes)";
const dn = out.director_notes;
console.log(
  `[generateDirectorNotes] option ${choice} "${out.storyTitle}" -> ${outPath}${note}\n` +
    `  hero=${dn.heroEffect} group=${dn.groupEffect} montage=${dn.montageEffect} default_trans=${dn.defaultTransition} ending=${dn.endingTransition}`
);
