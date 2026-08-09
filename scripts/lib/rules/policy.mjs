// Severity and action are POLICY, not properties of a rule.
//
// A rule states a fact ("this text crosses the safe margin"); what happens next
// depends on which tier is running. That decision lives here, in one table,
// instead of being hardcoded into each validator — so a preview flow that wants
// must_use_coverage as a warning changes a row, not a validator.
//
// Actions:
//   block          a product-integrity failure; never repair or deliver
//   repair         qaLoop may apply the finding's deterministic fix (fix-once,
//                  revision-capped — the loop's own discipline still applies)
//   manual-review  no automatic repair; the finding blocks --strict runs and is
//                  flagged for a person on exhaustion
//   warn           advisory only; never blocks, never repaired
//
// Tier policy controls creative intervention as well as severity. Lite blocks
// integrity failures, repairs bounded deterministic defects, and leaves
// subjective improvements as warnings. Revision budgets stay in runProject.

import { RULES, REPAIR_KINDS, isKnownRule } from "./contract.mjs";

const REPAIR = { severity: "error", action: "repair" };
const BLOCK = { severity: "error", action: "block" };
const REVIEW = { severity: "error", action: "manual-review" };
const WARN = { severity: "warn", action: "warn" };
export const POLICY_VERSION = 2;

// Mirrors today's behavior exactly: a rule is "repair" iff its emitter proposes
// a deterministic fix that qaLoop applies; tier-1 gate warnings are advisories.
const BASE = {
  must_use_coverage: REVIEW,
  text_safe_area: REVIEW,
  text_overflow: REPAIR,
  caption_integrity: REVIEW,
  caption_language: BLOCK,
  closing_card: REVIEW,
  crop: REPAIR,
  duplicate_photo: REVIEW,
  layout_repetition: WARN,
  overlay_repetition: WARN,
  pacing: REPAIR,
  hero: REPAIR,
  frame_brightness: REPAIR,
  black_frame: REVIEW,
  music_edit: REVIEW,
  audio_drift: REVIEW,
  photo_coverage: REVIEW,
};

// Lite saves cost by limiting creative intervention, not by shipping broken
// output. Cheap timeline repairs remain enabled, one rendered-frame hero swap
// is allowed by runProject's revision budget, and subjective improvements are
// warnings. Contract and media-integrity failures block delivery.
const LITE = {
  ...BASE,
  must_use_coverage: BLOCK,
  text_safe_area: BLOCK,
  caption_integrity: BLOCK,
  closing_card: BLOCK,
  // Global assignment makes adjacency collisions exceptional. If one survives, Lite no
  // longer ships it under a warning while delivery independently refuses the same report.
  duplicate_photo: BLOCK,
  hero: WARN,
  black_frame: BLOCK,
  music_edit: BLOCK,
  audio_drift: BLOCK,
  photo_coverage: BLOCK,
};

// Premium used to be `{ ...BASE }` — one BLOCK row against Lite's eight. It never shipped
// a broken film for it (runProject always passes --strict, so a manual-review finding still
// fails the run and delivery still refuses a non-pass verdict), but the timing was upside
// down: qaLoop only halts on `block` BEFORE the render, so the most expensive tier was the
// only one that paid for an encode and THEN failed. These four are the failures a premium
// job can prove from the timeline alone, so it can now fail on them for free.
//
// photo_coverage stays manual-review here rather than block: premium is the tier where a
// director's instruction may legitimately cost the film a photograph, and that is a
// judgement for a person with the receipt in analysis/directive-impact.json in front of
// them — not an automatic refusal.
//
// text_safe_area is here for a second reason. src/preflightTimeline.ts decided how hard to
// judge a caption by testing `metadata.pipelineVersion === "lite-v2"` — a string only the
// Lite generator ever wrote — so premium captions were allowed to overrun the 86% safe
// width, run to four lines and outpace the reading rate as WARNINGS while Lite failed on
// all four. There was never a product reason for that; there was a string comparison. The
// gate now reads this row. Measured before flipping it: 18 of 49 stored timelines carry
// findings that would newly become errors, but all 18 predate fitTextInTimeline being wired
// in — a freshly built premium timeline scores zero after the fitter runs.
const PREMIUM = {
  ...BASE,
  must_use_coverage: BLOCK,
  caption_integrity: BLOCK,
  text_safe_area: BLOCK,
  audio_drift: BLOCK,
  black_frame: BLOCK,
};

export const TIERS = ["template", "lite", "premium"];
export const POLICY = { template: { ...BASE }, lite: LITE, premium: PREMIUM };

export function actionFor(tier, check) {
  const rows = POLICY[tier];
  if (!rows) throw new Error(`unknown tier "${tier}" — policy exists for: ${TIERS.join(", ")}`);
  if (!isKnownRule(check)) throw new Error(`unknown rule "${check}" — declare it in lib/rules/contract.mjs first`);
  return rows[check].action;
}

/** The auditable answer to "which rule runs where, and what happens when it
 *  fails?" — one row per tier x rule, generated from the tables so it cannot
 *  drift from what the code does. */
export function coverageMatrix() {
  return TIERS.flatMap((tier) =>
    Object.entries(POLICY[tier]).map(([check, row]) => ({
      check, scope: RULES[check].scope, tier,
      severity: row.severity, action: row.action,
      repairs: RULES[check].repairs.join("+") || "-",
    }))
  );
}

// `node scripts/lib/rules/policy.mjs` prints the matrix for a human.
import { pathToFileURL } from "node:url";
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const rows = coverageMatrix();
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad("tier/rule", 32) + pad("scope", 16) + pad("severity", 10) + pad("action", 15) + "repairs");
  for (const r of rows) console.log(pad(`${r.tier}/${r.check}`, 32) + pad(r.scope, 16) + pad(r.severity, 10) + pad(r.action, 15) + r.repairs);
  const diverged = coverageMatrix().some((r) => {
    const t = POLICY.template[r.check];
    return r.severity !== t.severity || r.action !== t.action;
  });
  console.log(`\ntiers: ${TIERS.join(", ")} — ${diverged ? "policies diverge" : "identical policy"}`);
  console.log(`repair kinds qaLoop implements: ${REPAIR_KINDS.join(", ")}`);
}
