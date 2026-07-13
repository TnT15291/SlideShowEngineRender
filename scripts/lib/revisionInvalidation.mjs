const PHASE_BY_RADIUS = { timeline: "render", build: "build", plan: "plan" };
const REAPPROVAL_KINDS = new Set(["photo", "pacing", "structure", "story"]);

export function revisionInvalidation(directives, radius) {
  return {
    reenter: PHASE_BY_RADIUS[radius] || radius,
    requiresReapproval: radius === "plan" || radius === "build" || directives.some((d) => REAPPROVAL_KINDS.has(d.kind)),
  };
}

export function invalidateApproval(file, { round, radius }) {
  if (!file) return false;
  let selection;
  try { selection = JSON.parse(file.read()); } catch { return false; }
  if (!selection) return false;
  selection.status = "invalidated";
  selection.invalidatedAt = new Date().toISOString();
  selection.invalidation = { round, radius, reason: "customer revision requires a new preview approval" };
  file.write(JSON.stringify(selection, null, 2) + "\n");
  return true;
}
