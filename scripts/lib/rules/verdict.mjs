import { actionFor, POLICY_VERSION } from "./policy.mjs";

export function evaluateFindings({ tier, problems = [] }) {
  const findings = problems.map((problem) => ({ ...problem, action: actionFor(tier, problem.check) }));
  const grouped = { block: [], repair: [], "manual-review": [], warn: [] };
  for (const finding of findings) grouped[finding.action].push(finding);
  const verdict = grouped.block.length ? "block"
    : grouped.repair.length || grouped["manual-review"].length ? "review"
      : "pass";
  return { verdict, policyVersion: POLICY_VERSION, tier, findings, actions: grouped,
    counts: Object.fromEntries(Object.entries(grouped).map(([action, rows]) => [action, rows.length])) };
}

export function evaluateQualityReport({ tier, report }) {
  return evaluateFindings({ tier, problems: report?.problems || [] });
}
