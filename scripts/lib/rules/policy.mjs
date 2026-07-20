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
  duplicate_photo: WARN,
  hero: WARN,
  black_frame: BLOCK,
  music_edit: BLOCK,
  audio_drift: BLOCK,
};

export const TIERS = ["template", "lite", "premium"];
export const POLICY = { template: { ...BASE }, lite: LITE, premium: { ...BASE } };

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
