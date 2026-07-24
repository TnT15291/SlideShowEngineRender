// Node 0 — COMPILE THE PROMPT.
//
// The customer's prompt is not one thing. It is a story ("hai người Việt xa quê,
// gặp nhau ở Nhật") tangled together with a list of orders ("dùng hiệu ứng lật
// trang phim", "đừng có chữ trên ảnh cưới", "khoảng 3 phút"). The pipeline used to
// read only the story and drop every order on the floor without a word. This node
// separates them: prose out one side, a typed directive ledger out the other.
//
// Extraction, NOT creativity. The model is given the engine's live vocabulary and
// asked only "which of these knobs did the customer just reach for, and in whose
// words?" It invents nothing: a directive without a `quote` from the prompt is
// rejected, and a target that is not a real engine value goes to `unmapped` rather
// than being rounded to the nearest default. What we cannot do, we say we cannot do.
//
// THE RULES RUN EVEN WITH A KEY. scripts/lib/briefRules.mjs is both the no-key STUB
// and a recall net under the model: an instruction the model skips is an instruction
// that vanishes silently, and silence is the failure mode this entire layer exists
// to kill. A rule hit that the model missed is merged in and logged.
//
// ROUND 0 ONLY. A re-run of this node must never wipe the revision rounds a customer
// added after seeing their preview (see reviseProject.mjs) — it replaces what it
// compiled from the prompt, and leaves everything else exactly where it was.
//
// Usage: node scripts/parseBrief.mjs --prompt <prompt.txt> --out <directives.json>
import fs from "node:fs";
import path from "node:path";
import { hasKey, provenance, defaultModel, callDeepSeekJSON } from "./lib/deepseek.mjs";
import { ruleHits, recallNet } from "./lib/briefRules.mjs";
import {
  validateDirective, loadLedger, saveLedger, blastRadius, stampIds,
  EFFECTS, TRANSITIONS, CURVES, OVERLAYS, PACING, ACTS, ROLES,
} from "./lib/directives.mjs";
import { TAG_LIST } from "./lib/vocab.mjs";

const root = process.cwd();
const arg = (flag, def = "") => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const promptPath = arg("--prompt", "prompt.txt");
const outPath = arg("--out", "directives.json");
const storyOut = arg("--story-out", ""); // optional: the narrative half, for node 3

const absPrompt = path.resolve(root, promptPath);
const prompt = fs.existsSync(absPrompt) ? fs.readFileSync(absPrompt, "utf8").trim() : "";

// An empty prompt is a legitimate state — the customer said nothing, so there is
// nothing to obey. It is NOT an error, and it must still write a ledger, or every
// downstream `--directives` would have to special-case a missing file.
if (!prompt) {
  const ledger = loadLedger(outPath);
  saveLedger(outPath, { ...ledger, version: 1, story: "", directives: ledger.directives.filter((d) => d.round > 0), generatedBy: "empty-prompt", generatedAt: new Date().toISOString() });
  console.log(`[parseBrief] ${promptPath} is empty — no directives. -> ${outPath}`);
  process.exit(0);
}

// --- the model's task ------------------------------------------------------
function buildSystem() {
  return [
    "You read a customer's brief for a wedding slideshow and SEPARATE it into two things:",
    "  (1) `story` — the narrative/emotional half, copied out as prose. Do not summarise or embellish it.",
    "  (2) `directives` — every concrete INSTRUCTION about how the film must be made.",
    "",
    "A directive is only valid if you can QUOTE the customer's own words for it. Never invent a request.",
    "If the customer asks for something this engine cannot do, put it in `unmapped` with a reason. Do NOT",
    "substitute the nearest thing you can do — an unhonoured request must be visible, not disguised.",
    "",
    "Each directive is: {quote, kind, op, scope, target, strength, confidence}",
    `  kind   : effect | transition | color | overlay | pacing | duration | music_mode | caption | photo | moment | structure | story`,
    `  op     : set | forbid | require`,
    `  scope  : {"global":true} | {"act":ACT} | {"scene":"s07"} | {"role":ROLE}`,
    `  strength: "must" (an order) | "prefer" ("khoảng", "nếu được", "ưu tiên")`,
    `  confidence: 0..1 — how sure you are this is an instruction and not just mood.`,
    "",
    `ACT  is one of: ${ACTS.join(", ")}`,
    `ROLE is one of: ${ROLES.join(", ")}`,
    "",
    "target MUST be an exact string from the engine's vocabulary:",
    `  effect     : ${[...EFFECTS].join(", ")}`,
    `  transition : ${[...TRANSITIONS].join(", ")}`,
    `  color      : ${[...CURVES].join(", ")}, none`,
    `  overlay    : ${[...OVERLAYS].join(", ")}`,
    `  pacing     : ${[...PACING].join(", ")}`,
    `  duration   : a NUMBER of seconds (3 phút -> 180)`,
    `  music_mode : auto | highlight | full_song | playlist | loop  (playlist/loop EXTEND a track too short for the photos — "nối thêm bài" -> playlist, "lặp lại bài" -> loop; highlight/full_song apply when the track is too LONG)`,
    `  caption    : the exact text for op=set; null for op=forbid/require`,
    `  photo      : a filename`,
    `  moment     : one of ${TAG_LIST.join(", ")} — op is require or forbid ONLY, never set (a moment names a CONTENT TAG, not a specific photo the customer has not seen). Use it only when the customer explicitly demands or bans a moment appearing ("phải có cảnh trao nhẫn" -> require rings). A moment merely mentioned while telling their story ("chúng tôi trao nhẫn dưới hoàng hôn") is NOT a directive — it belongs in \`story\`.`,
    "",
    "Mood words are directives too when they name a look the engine has: \"hoài niệm\" -> color=vintage.",
    "But a pure story sentence (\"họ gặp nhau ở Nhật\") is NOT a directive — it belongs in `story`.",
    "",
    'Return ONE JSON object: {"story": str, "directives": [...], "unmapped": [{"quote": str, "reason": str}]}',
  ].join("\n");
}

// --- run -------------------------------------------------------------------
// The rules always run: as the STUB when there is no key, and as a recall net under
// the model when there is (see recallNet in briefRules.mjs). Their `__unmapped` rows are
// instruction-shaped sentences no rule understood — kept apart from the directives they
// failed to become.
let raw;
if (hasKey()) {
  raw = await callDeepSeekJSON({
    system: buildSystem(),
    user: `The customer's brief:\n\n${prompt}\n\nSeparate it now.`,
    temperature: 0.1, // extraction, not invention
    label: "parseBrief",
    onCall: (real) => console.log(real ? "  DeepSeek brief-compile call..." : "  brief-compile: cached (unchanged prompt — same ledger, no call)"),
  });
} else {
  // In STUB mode the rules ARE the compiler, so their misses are the honest report.
  raw = { story: prompt, ...ruleHits(prompt) };
}

// --- guardrail: clamp onto the engine, and REPORT what would not clamp ------
const directives = [];
const unmapped = [];
(Array.isArray(raw.directives) ? raw.directives : []).forEach((d, i) => {
  const r = validateDirective({ ...d, round: 0, source: "prompt" }, i);
  if (r.ok) directives.push(r.directive);
  else unmapped.push({ quote: r.quote || JSON.stringify(d).slice(0, 120), reason: r.reason });
});
for (const u of Array.isArray(raw.unmapped) ? raw.unmapped : []) {
  if (u?.quote) unmapped.push({ quote: String(u.quote).slice(0, 300), reason: String(u.reason || "the engine has no way to do this").slice(0, 240) });
}

// --- the recall net: what did the model walk past? --------------------------
// Shared with reviseProject, which is where most of the customer's direction actually
// arrives — and which, until this was extracted, had no net at all.
const missed = hasKey() ? recallNet(prompt, directives, "prompt-rule") : [];
directives.push(...missed);

const ledger = loadLedger(outPath);
const kept = (ledger.directives || []).filter((d) => (d.round ?? 0) > 0); // revision rounds survive
const out = {
  version: 1,
  generatedBy: provenance(defaultModel),
  ...(hasKey() ? { model: `deepseek/${defaultModel}` } : {}),
  generatedAt: new Date().toISOString(),
  promptFile: promptPath,
  story: typeof raw.story === "string" && raw.story.trim() ? raw.story.trim().slice(0, 4000) : prompt,
  // Round 0 is re-stamped, never trusted from the extractor: its counter restarts at r1 on
  // every call, and an id that collides with a later round's is not an id.
  directives: [...stampIds(directives, 0), ...kept],
  unmapped,
};
saveLedger(outPath, out);

if (storyOut) {
  const abs = path.resolve(root, storyOut);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, out.story + "\n", "utf8");
}

const note = hasKey() ? "" : " (STUB — rules only; set DEEPSEEK_API_KEY for the full compile)";
console.log(`[parseBrief] ${directives.length} directive(s), ${unmapped.length} unmapped${kept.length ? `, ${kept.length} kept from revisions` : ""} -> ${outPath}${note}`);
for (const d of directives) {
  console.log(`  ${d.strength === "must" ? "!" : "~"} ${d.kind}/${d.op} ${JSON.stringify(d.target)} @ ${JSON.stringify(d.scope)} [${blastRadius(d)}]  ${JSON.stringify(d.quote.slice(0, 60))}`);
}
for (const u of unmapped) console.log(`  ? CANNOT DO: ${JSON.stringify(u.quote.slice(0, 60))} — ${u.reason}`);
if (missed.length) console.log(`  (recall net caught ${missed.length} the model walked past: ${missed.map((d) => d.kind).join(", ")})`);
