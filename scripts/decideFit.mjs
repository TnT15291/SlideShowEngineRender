// Turns a fit_plan.json (scripts/assessFit.mjs) into a DECISION — the same shape as gate
// 4b's selectMusicEdit.mjs (source precedence, a decisionWindow that is honest about
// whether anyone was actually asked), but WITHOUT an interactive pause: the web UI that
// will let a customer answer this question is separate, future work. Until it exists, this
// node applies the SAFE default and records that plainly, so a later interactive version is
// a natural extension (add a real channel + exit-3 window) rather than a rewrite.
//
// The safe default, always: NEVER cull a photo without a person saying so. `keep_all` is
// the recommended option for every "too many photos" regime precisely so this auto-decider
// can pick the first recommended option without ever choosing to throw something away.
//
//   node scripts/decideFit.mjs --fit-plan analysis/fit_plan.json
//     [--directives directives.json] [--out analysis/fit_decision.json]
import fs from "node:fs";
import path from "node:path";
import { validate } from "./lib/checkSchema.mjs";
import { loadLedger, active } from "./lib/directives.mjs";

const root = process.cwd();
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const die = (msg) => { console.error(`[decideFit] FAILED: ${msg}`); process.exit(1); };
const readJson = (p) => JSON.parse(fs.readFileSync(path.resolve(root, p), "utf8"));
const exists = (p) => p && fs.existsSync(path.resolve(root, p));

const fitPlanPath = arg("--fit-plan", "analysis/fit_plan.json");
const directivesPath = arg("--directives", "");
const outPath = arg("--out", "analysis/fit_decision.json");

if (!exists(fitPlanPath)) die(`fit plan not found: ${fitPlanPath} — run scripts/assessFit.mjs first`);
const plan = readJson(fitPlanPath);
const orders = exists(directivesPath) ? active(loadLedger(path.resolve(root, directivesPath))) : [];

function writeDecision(doc) {
  const nowIso = new Date().toISOString();
  const out = {
    generatedBy: "fit-decision",
    generatedAt: nowIso,
    regime: plan.regime,
    // Nobody was asked — the interactive gate is future work — so the honest record is a
    // ZERO-LENGTH window, the same rule selected-music.schema.json states: a deadline that
    // was never offered must never be dressed up as one the customer was given.
    decisionWindow: { openedAt: nowIso, deadlineAt: nowIso, timeoutHours: 0 },
    ...doc,
  };
  const errors = validate(readJson("schema/fit-decision.schema.json"), out);
  if (errors.length) {
    console.error("[decideFit] fit_decision failed schema:");
    for (const e of errors.slice(0, 20)) console.error("  - " + e);
    process.exit(1);
  }
  const absOut = path.resolve(root, outPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, JSON.stringify(out, null, 2) + "\n");
  console.log(`[decideFit] ${out.optionId} (${out.source}) — ${out.reason}\n  -> ${outPath}`);
  process.exit(0);
}

// A balanced job has no options and nothing to decide.
if (plan.regime === "balanced" || !plan.options?.length) {
  writeDecision({ optionId: "balanced", source: "natural", reason: "album and track already agree; no question to ask" });
}

// Did the customer's own prompt already answer this (a music_mode/duration directive)?
// Same precedence rule as selectMusicEdit: the ledger outranks any auto default.
const modeOrder = orders.find((d) => d.kind === "music_mode" && d.op === "set");
const orderToOption = { highlight: "highlight", full_song: "full_song_stretch", loop: "loop", playlist: "playlist" };
const requestedOptionId = modeOrder ? orderToOption[modeOrder.target] : null;
const matched = requestedOptionId ? plan.options.find((o) => o.id === requestedOptionId) : null;
if (matched) {
  writeDecision({
    optionId: matched.id, source: "ledger",
    reason: `the prompt already said so ("${modeOrder.quote.slice(0, 120)}")`,
    musicMode: matched.musicMode,
  });
}

// No UI to ask yet: apply the first RECOMMENDED option — by construction (fitPlan.mjs)
// this is always the non-destructive default (highlight/keep_all/add_photos), never a cull.
const recommended = plan.options.find((o) => o.recommended) || plan.options[0];
// The customer DID ask for something (modeOrder exists) but it does not fit this regime's
// arithmetic (e.g. "add another song" on an album already too SHORT on photos — extending
// the track only stretches each photo further, the opposite of what they want). Silently
// picking a different default here would be exactly the "disobeying quietly" this repo's
// directive layer exists to kill (see directives.mjs's own header). Say so in the reason.
const conflict = modeOrder && !matched
  ? ` — the prompt asked for "${modeOrder.target}" ("${modeOrder.quote.slice(0, 100)}"), but that does not fit a ${plan.regime} album; using the recommended default instead`
  : "";
writeDecision({
  optionId: recommended.id, source: "auto",
  reason: `no interactive UI to ask the customer yet — applied the recommended default: ${recommended.label}${conflict}`,
  ...(recommended.musicMode ? { musicMode: recommended.musicMode } : {}),
});
