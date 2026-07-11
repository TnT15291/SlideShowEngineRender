// Phase A / node 2 — SEMANTIC photo analysis (the AI-vision layer).
//
// Rule-based `analyzePhotos.mjs` already scores each photo technically (sharpness,
// luma, quality, focal point). This script adds the layer it cannot: WHAT is in
// the photo (couple / group / ceremony / candid ...) and how load-bearing it is
// for the story (hero / emotion / story-importance). Those come from ONE batched
// vision call so the whole set is judged in one narrative context.
//
// PROVIDER: **OpenAI (gpt-5.5)**, not DeepSeek. The text nodes (Phase B) run on
// DeepSeek, but DeepSeek's API does not serve vision — its /chat/completions
// takes `messages[].content` as a plain STRING (no `image_url` content part) and
// list-models returns only the text-only deepseek-v4-flash / deepseek-v4-pro.
// Image understanding exists in the chat.deepseek.com UI, not the API. So this
// one node points elsewhere. Nothing else about the request changes: DeepSeek is
// OpenAI-compatible, and this file always spoke the OpenAI shape.
//
// Any OpenAI-compatible endpoint that accepts `image_url` parts works — swap via
// VISION_BASE_URL / VISION_API_KEY / VISION_MODEL (OpenRouter, Azure OpenAI, a
// Gemini compatibility layer). Against a *.deepseek.com host we refuse up front
// rather than fire a request that cannot succeed, and stay on the deterministic
// STUB so downstream keeps running. `--require-vision` turns that refusal into a
// hard failure for pipelines that must not silently degrade.
//
// Whatever endpoint serves it, JSON mode nudges toward JSON but does NOT enforce
// our schema, so `validateAiResults` below (clamp/drop/fill) is load-bearing, not
// belt-and-suspenders — every model field is re-coerced onto the contract in
// schema/photo-content.schema.json ($defs/aiResult).
//
// Guardrails (enforced here for real AI output):
//   - the model returns records keyed by INDEX; this scaffold owns the
//     index -> file mapping. The model never sees or sets a path/config.
//   - tags must be in the controlled vocabulary (unknown tags dropped).
//   - emotion must be in the enum (else a safe default); scores clamped to 0..1.
//   - one result per photo, indices in range, no extras.
//
// Env (vision provider — any OpenAI-compatible endpoint that accepts image_url):
//   VISION_API_KEY (or OPENAI_API_KEY), VISION_BASE_URL (default
//   https://api.openai.com/v1), VISION_MODEL (default gpt-5.5),
//   VISION_REASONING_EFFORT (low|medium|high; unset = the model's own default).
// Also FFMPEG_PATH (for the previews).
//
// This is the ONLY node whose cost scales with the photo set: every photo is
// downscaled and base64'd into a request. `--dry-run` prices the run (requests,
// payload, unreadable images) without sending anything, and `--limit N` judges a
// sample so the prompt can be checked by eye before the whole set is paid for.
//
// Usage: node scripts/analyzePhotoContent.mjs [--photos analysis/photos.json]
//        [--out analysis/photo_content.json] [--model <id>] [--require-vision]
//        [--dry-run] [--limit N]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { isRetryableStatus, MAX_ATTEMPTS, RETRY_BASE_MS, sleep } from "./lib/retryPolicy.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const die = (msg) => {
  console.error(`[analyzePhotoContent] FAILED: ${msg}`);
  process.exit(1);
};

const DEFAULT_OUT = "analysis/photo_content.json";
const SAMPLE_OUT = "analysis/photo_content.sample.json";

const photosPath = arg("--photos", "analysis/photos.json");
const outPath = arg("--out", DEFAULT_OUT);
const outExplicit = process.argv.includes("--out");
const model = arg("--model", null);
const requireVision = process.argv.includes("--require-vision");
const dryRun = process.argv.includes("--dry-run");

const limitRaw = arg("--limit", null);
let limit = null;
if (limitRaw !== null) {
  limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1) die(`--limit must be a positive integer, got "${limitRaw}"`);
}

// --- Vision provider config (OpenAI-compatible chat/completions with images) ---
const ffmpeg = process.env.FFMPEG_PATH || "ffmpeg";
const apiKey = process.env.VISION_API_KEY || process.env.OPENAI_API_KEY;
const baseUrl = (process.env.VISION_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const modelId = model || process.env.VISION_MODEL || "gpt-5.5";
const BATCH_SIZE = 12; // photos per request — small enough for per-image attention
const PREVIEW_EDGE = 512; // longest edge of the base64 preview (vision cost scales with resolution)

/** DeepSeek's API has no image content part; sending one is a guaranteed 400. */
const TEXT_ONLY_HOST = /(^|\.)deepseek\.com$/i.test(new URL(baseUrl).hostname);

// GPT-5-family / o-series are REASONING models: they reject the sampling params
// with `400 Unsupported value: 'temperature' does not support 0.2 with this
// model. Only the default (1) value is supported.` They steer via
// `reasoning_effort` instead. Non-reasoning models (gpt-4o...) are the reverse:
// they take temperature and reject reasoning_effort. So the body is built per
// family rather than shared. Verified against the OpenAI docs 2026-07-09.
const IS_REASONING_MODEL = /^(gpt-5|o[134])/i.test(modelId);
const reasoningEffort = process.env.VISION_REASONING_EFFORT || ""; // "" = model default (medium)

// --- Controlled vocabulary (mirror of schema/photo-content.schema.json $defs) ---
const TAG_VOCAB = new Set([
  "couple", "bride", "groom", "solo", "group", "family", "friends",
  "getting_ready", "ceremony", "vows", "rings", "kiss", "first_dance",
  "reception", "party", "portrait", "candid",
  "detail", "decor", "venue", "scenery", "food",
]);
const EMOTIONS = new Set([
  "joyful", "tender", "romantic", "celebratory", "calm", "solemn", "playful",
]);
const DEFAULT_EMOTION = "calm";

// --- Load the rule-based layer ---------------------------------------------
const absPhotos = path.resolve(root, photosPath);
if (!fs.existsSync(absPhotos)) {
  console.error(
    `[analyzePhotoContent] ${photosPath} not found.\n` +
      `Run the rule-based pass first:  node scripts/analyzePhotos.mjs`
  );
  process.exit(1);
}
const photosRaw = JSON.parse(fs.readFileSync(absPhotos, "utf8"));
// analyzePhotos.mjs writes { dir, count, photos: [...] }; also accept a bare array.
const photos = Array.isArray(photosRaw) ? photosRaw : photosRaw?.photos;
if (!Array.isArray(photos) || photos.length === 0) {
  console.error(`[analyzePhotoContent] ${photosPath} has no photo records.`);
  process.exit(1);
}

// A partial run must never be able to pass for a complete one. Downstream reads
// photo_content.json as "every photo, judged": 12 records where 82 are expected
// would skew the story profile and every hero pick, and nothing in the file would
// say so. Same failure as the silent-zeros bug of 2026-07-09 — structurally valid,
// semantically a lie. So a limited run lands in its own file, and refuses to be
// aimed at the real one.
const partial = limit !== null && limit < photos.length;
let effectiveOut = outPath;
if (partial) {
  if (!outExplicit) effectiveOut = SAMPLE_OUT;
  // Match on the FILENAME, not the root path: every project has its own
  // <project>/analysis/photo_content.json, and the pipeline reads each of them as
  // the complete set. Comparing against the root default only would let a sample
  // land in a project under the real name — the exact lie this guard exists for.
  else if (path.basename(outPath) === path.basename(DEFAULT_OUT)) {
    die(
      `--limit ${limit} judges only ${limit} of ${photos.length} photos, but --out points at ${outPath},\n` +
        `  which the pipeline reads as the complete set. Name a sample path instead\n` +
        `  (e.g. ${path.posix.join(path.dirname(outPath.replace(/\\/g, "/")), path.basename(SAMPLE_OUT))}).`
    );
  }
}

// Ordered batch the model will judge. The scaffold, not the model, owns `file`.
const batch = (partial ? photos.slice(0, limit) : photos).map((p, index) => ({
  index,
  file: p.file,
  orient: p.orient,
  quality: p.quality,
  sharpness: p.sharpness,
  meanLuma: p.meanLuma,
  focusX: p.focusX,
  focusY: p.focusY,
}));

// --- Real vision: batched OpenAI-compatible chat/completions with image parts ---
// Returns an array of raw aiResult objects keyed by batch index. Everything it
// returns is re-validated by validateAiResults() below, so a misbehaving model
// (wrong tags, out-of-range scores, missing entries) is fully contained.

/** Downscale one photo to a small JPEG and base64-encode it (vision preview). */
function encodeImagePreview(file) {
  const abs = path.resolve(root, file);
  const r = spawnSync(
    ffmpeg,
    ["-v", "error", "-i", abs,
      "-vf", `scale=${PREVIEW_EDGE}:${PREVIEW_EDGE}:force_original_aspect_ratio=decrease`,
      "-frames:v", "1", "-f", "image2pipe", "-vcodec", "mjpeg", "-"],
    { maxBuffer: 1 << 26 } // stdout is a Buffer (no encoding set)
  );
  if (r.status !== 0 || !r.stdout || r.stdout.length === 0) return null;
  return Buffer.from(r.stdout).toString("base64");
}

/** System prompt: the controlled vocabulary + rubric + strict JSON instruction. */
function buildSystemPrompt() {
  return [
    "You are a wedding-photo analyst. You are shown a batch of photos, each labeled `Photo <index>:`.",
    "For EACH photo, judge it in the context of the whole set and return one JSON object with ONLY these fields:",
    "  index (int = the photo's label), tags (array), emotion (string),",
    "  heroScore, emotionScore, storyImportance (numbers 0..1), note (optional, <=1 short line).",
    `Allowed tags — use ONLY these, choose the 0..5 that apply: ${[...TAG_VOCAB].join(", ")}.`,
    `Allowed emotion — choose exactly one: ${[...EMOTIONS].join(", ")}.`,
    "Scores (0..1): heroScore = how much it deserves a hero / full-bleed slot;",
    "  emotionScore = emotional weight of the moment; storyImportance = how load-bearing for the narrative.",
    "Never output file paths, extra fields, or commentary.",
    'Return a single JSON object exactly of the form {"results": [ ... ]}, one entry per photo, keyed by the index shown.',
  ].join("\n");
}

/** One request for one chunk of photos. Returns the parsed results array. */
async function callVisionChunk(chunk) {
  const content = [];
  for (const it of chunk) {
    content.push({ type: "text", text: `Photo ${it.index}:` });
    const b64 = encodeImagePreview(it.file);
    if (b64) {
      content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } });
    } else {
      content.push({ type: "text", text: "(image unreadable — infer nothing, use neutral defaults)" });
    }
  }
  content.push({
    type: "text",
    text: `Return the JSON object now, one entry per photo for indices: ${chunk.map((c) => c.index).join(", ")}.`,
  });

  const body = {
    model: modelId,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      { role: "user", content },
    ],
    response_format: { type: "json_object" },
    ...(IS_REASONING_MODEL
      ? reasoningEffort ? { reasoning_effort: reasoningEffort } : {}
      : { temperature: 0.2 }),
  };

  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        const text = data?.choices?.[0]?.message?.content ?? "";
        const parsed = JSON.parse(text);
        const arr = Array.isArray(parsed) ? parsed : parsed.results ?? parsed.photos ?? [];
        if (!Array.isArray(arr)) throw new Error("vision model returned no results array");
        return arr;
      }
      lastErr = new Error(`vision HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      // `break`, not `throw`: a throw here lands in the catch below, which records
      // it and lets the loop run again — three identical bad requests, three bills'
      // worth of latency, for a key or a body that will never become correct.
      if (!isRetryableStatus(resp.status)) break;
    } catch (e) {
      lastErr = e; // network failure or an unparseable body — worth another attempt
    }
    if (attempt < MAX_ATTEMPTS) await sleep(RETRY_BASE_MS * attempt);
  }
  throw lastErr ?? new Error("vision call failed");
}

async function callVisionModel(items) {
  const out = [];
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    process.stdout.write(`  ${modelId} batch ${Math.floor(i / BATCH_SIZE) + 1} (${chunk.length} photos)... `);
    out.push(...(await callVisionChunk(chunk)));
    console.log("ok");
  }
  return out;
}

/** No-key fallback: neutral fields from the technical signals we already have,
 *  so the file is structurally complete. `source: "stub"` marks these NOT real. */
function stubResults(items) {
  return items.map((it) => ({
    index: it.index,
    tags: [],
    emotion: DEFAULT_EMOTION,
    heroScore: round3(clamp01((it.quality ?? 0) / 100)),
    emotionScore: 0.5,
    storyImportance: 0.5,
  }));
}

// --- Guardrail: coerce raw model output onto the contract ------------------
function validateAiResults(raw, n, sourceLabel) {
  if (!Array.isArray(raw)) {
    throw new Error(`vision output must be an array, got ${typeof raw}`);
  }
  const byIndex = new Map();
  for (const r of raw) {
    const idx = Number(r?.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= n) continue; // drop out-of-range
    if (byIndex.has(idx)) continue; // first wins on duplicate index
    const tags = Array.isArray(r?.tags)
      ? [...new Set(r.tags.filter((t) => TAG_VOCAB.has(t)))]
      : [];
    const emotion = EMOTIONS.has(r?.emotion) ? r.emotion : DEFAULT_EMOTION;
    const rec = {
      index: idx,
      tags,
      emotion,
      heroScore: clamp01(r?.heroScore),
      emotionScore: clamp01(r?.emotionScore),
      storyImportance: clamp01(r?.storyImportance),
      source: sourceLabel,
    };
    if (typeof r?.note === "string" && r.note.trim()) {
      rec.note = r.note.trim().slice(0, 240);
    }
    byIndex.set(idx, rec);
  }
  // Every photo must end up with a record; fill any gap with a neutral default
  // so downstream never hits an undefined semantic field.
  const results = [];
  for (let i = 0; i < n; i++) {
    results.push(
      byIndex.get(i) ?? {
        index: i,
        tags: [],
        emotion: DEFAULT_EMOTION,
        heroScore: 0.5,
        emotionScore: 0.5,
        storyImportance: 0.5,
        source: sourceLabel,
      }
    );
  }
  return results;
}

function clamp01(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0.5;
  return Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;
}
function round3(n) {
  return Math.round(n * 1000) / 1000;
}

// --- Run -------------------------------------------------------------------
// A key alone is not enough: the endpoint must actually accept images. Firing a
// multimodal request at DeepSeek's text-only API would fail with an opaque 400,
// so we refuse it up front and say what to do about it.
const visionHost = new URL(baseUrl).hostname;
let blocked = null;
if (!apiKey) blocked = "no VISION_API_KEY / OPENAI_API_KEY";
else if (TEXT_ONLY_HOST)
  blocked =
    `${visionHost} does not serve vision — its /chat/completions takes messages[].content as a plain string ` +
    `(no image_url part), and list-models returns only the text-only deepseek-v4-flash / deepseek-v4-pro. ` +
    `Leave VISION_BASE_URL unset (defaults to OpenAI), or point it at another OpenAI-compatible endpoint that accepts images.`;

if (blocked && requireVision) {
  console.error(`[analyzePhotoContent] FAILED (--require-vision): ${blocked}`);
  process.exit(1);
}

/** Price the run without buying it: encode every preview the real call would
 *  send, then report the request count, the payload, and how many photos the
 *  model would receive as "(image unreadable)". Sends nothing, writes nothing. */
function reportDryRun() {
  const fmt = (n) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
  const steer = IS_REASONING_MODEL
    ? reasoningEffort
      ? `reasoning_effort=${reasoningEffort}`
      : "reasoning_effort omitted (model default)"
    : "temperature=0.2";

  console.log(`[analyzePhotoContent] DRY RUN — nothing is sent, nothing is written.\n`);
  console.log(`  endpoint    ${baseUrl}/chat/completions`);
  console.log(`  model       ${modelId}${IS_REASONING_MODEL ? "  (reasoning family)" : ""}`);
  console.log(`  steers by   ${steer}`);
  console.log(`  api key     ${apiKey ? "present" : "ABSENT"}`);
  console.log(`  would call  ${blocked ? `NO — would fall back to STUB (${blocked})` : "YES — real vision request"}`);

  process.stdout.write(`\n  encoding ${batch.length} preview(s) at ${PREVIEW_EDGE}px to measure the payload... `);
  const sizes = batch.map((it) => encodeImagePreview(it.file)?.length ?? null);
  console.log("done");

  const unreadable = batch.filter((_, i) => sizes[i] === null);
  const b64Total = sizes.reduce((s, n) => s + (n ?? 0), 0);
  const chunks = [];
  for (let i = 0; i < batch.length; i += BATCH_SIZE) {
    chunks.push(sizes.slice(i, i + BATCH_SIZE).reduce((s, n) => s + (n ?? 0), 0));
  }

  console.log(`\n  photos      ${batch.length}${partial ? ` of ${photos.length}  (--limit ${limit})` : ""}`);
  console.log(`  requests    ${chunks.length}  (BATCH_SIZE=${BATCH_SIZE})`);
  console.log(`  payload     ${fmt(b64Total)} of base64 across all requests; largest request ${fmt(Math.max(...chunks))}`);
  console.log(`  readable    ${batch.length - unreadable.length}/${batch.length}`);
  if (unreadable.length) {
    console.log(`  UNREADABLE  ${unreadable.length} — the model would be told "(image unreadable)" and score them blind:`);
    for (const it of unreadable.slice(0, 10)) console.log(`                ${it.file}`);
    if (unreadable.length > 10) console.log(`                ... and ${unreadable.length - 10} more`);
  }
  console.log(`\n  would write ${partial ? effectiveOut + "  (sample; not the file the pipeline reads)" : effectiveOut}`);
  console.log(`\n  Re-run without --dry-run to execute.`);
}

if (dryRun) {
  reportDryRun();
  process.exit(0);
}

/** Turn the provider's refusal into the thing to go change. The first real run of
 *  this node is where a wrong key or a wrong model id shows up, and a stack trace
 *  names the line that threw rather than the setting that was wrong. */
function failureHint(msg) {
  if (/HTTP 40[13]/.test(msg)) return `The endpoint rejected the KEY. Check VISION_API_KEY / OPENAI_API_KEY.`;
  if (/HTTP 400/.test(msg))
    return (
      `The endpoint rejected the BODY, not the key. Reasoning models (gpt-5*, o1/o3/o4) refuse ` +
      `\`temperature\`; others refuse \`reasoning_effort\`. This run sent ` +
      `${IS_REASONING_MODEL ? "reasoning-style" : "temperature-style"} params for VISION_MODEL=${modelId}.`
    );
  if (/HTTP 429/.test(msg)) return `Rate limited, still after ${MAX_ATTEMPTS} attempts. Retry later, or lower BATCH_SIZE (${BATCH_SIZE}).`;
  if (/HTTP 5\d\d/.test(msg)) return `Provider-side error, still after ${MAX_ATTEMPTS} attempts.`;
  return `Could not reach ${baseUrl}. Check VISION_BASE_URL and the network.`;
}

const useReal = !blocked;
const generatedBy = useReal ? `vision:${visionHost}/${modelId}` : "stub";

let raw;
try {
  raw = useReal ? await callVisionModel(batch) : stubResults(batch);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  die(
    `${msg}\n  ${failureHint(msg)}\n` +
      `  Nothing was written. Use --dry-run to inspect the request without sending it,\n` +
      `  and --limit N to judge a sample before paying for all ${photos.length} photos.`
  );
}
const results = validateAiResults(raw, batch.length, generatedBy);

// Merge technical (scaffold-owned) + semantic (validated model) per photo.
const merged = batch.map((b) => {
  const s = results[b.index];
  const rec = {
    file: b.file,
    orient: b.orient,
    tags: s.tags,
    emotion: s.emotion,
    heroScore: s.heroScore,
    emotionScore: s.emotionScore,
    storyImportance: s.storyImportance,
    source: s.source,
  };
  if (b.quality !== undefined) rec.quality = b.quality;
  if (b.sharpness !== undefined) rec.sharpness = b.sharpness;
  if (b.meanLuma !== undefined) rec.meanLuma = b.meanLuma;
  if (b.focusX !== undefined) rec.focusX = b.focusX;
  if (b.focusY !== undefined) rec.focusY = b.focusY;
  if (s.note) rec.note = s.note;
  return rec;
});

const out = {
  generatedBy,
  ...(useReal ? { model: `${visionHost}/${modelId}` } : {}),
  generatedAt: new Date().toISOString(),
  count: merged.length,
  // Coverage, stated in the file rather than inferred from its length. A reader
  // that trusts `count` alone cannot tell a sample from the whole set.
  ...(partial ? { partial: true, limitedTo: limit, totalPhotos: photos.length } : {}),
  photos: merged,
};

const absOut = path.resolve(root, effectiveOut);
fs.mkdirSync(path.dirname(absOut), { recursive: true });
fs.writeFileSync(absOut, JSON.stringify(out, null, 2));

console.log(`[analyzePhotoContent] ${merged.length} photos -> ${effectiveOut}${useReal ? ` (vision: ${visionHost}/${modelId})` : " (STUB)"}`);
if (blocked) console.warn(`  semantic fields are PLACEHOLDERS — ${blocked}`);

// A sample exists to be read by a human before the full set is paid for, so print
// it rather than making them open the JSON.
if (partial) {
  console.log(`\n  Sample of ${limit}/${photos.length} — check the tags before spending on the rest:\n`);
  const pad = (s, n) => String(s).padEnd(n).slice(0, n);
  console.log(`    ${pad("file", 26)} ${pad("emotion", 12)} ${pad("hero", 6)} ${pad("emo", 6)} ${pad("story", 6)} tags`);
  for (const p of merged) {
    console.log(
      `    ${pad(path.basename(p.file), 26)} ${pad(p.emotion, 12)} ` +
        `${pad(p.heroScore.toFixed(2), 6)} ${pad(p.emotionScore.toFixed(2), 6)} ${pad(p.storyImportance.toFixed(2), 6)} ` +
        (p.tags.length ? p.tags.join(",") : "-")
    );
  }
  console.log(
    `\n  ${effectiveOut} is a SAMPLE — the pipeline reads ${DEFAULT_OUT}.\n` +
      `  When the tags look right, run without --limit to judge all ${photos.length}.`
  );
}
