const DEFAULT_LIMITS = { special: 2, chapter: 3 };

/** Apply a recipe's small transition vocabulary and enforce special-effect caps. */
export function createTransitionGrammar(strategy = {}, grammar = {}) {
  const vocabulary = new Set(grammar.vocabulary || Object.values(strategy).map((t) => t?.type).filter(Boolean));
  const fallbackRole = grammar.fallbackRole || "default";
  const specialRoles = new Set(grammar.specialRoles || ["peak", "memory"]);
  const limits = { ...DEFAULT_LIMITS, ...(grammar.limits || {}) };
  const counts = new Map();
  const decisions = [];

  function select(role, isLast) {
    const requestedRole = isLast ? "final" : role;
    let resolvedRole = strategy[requestedRole] ? requestedRole : fallbackRole;
    let selected = strategy[resolvedRole] || strategy.default || { type: "crossfade", duration: 0.7 };
    let reason = "role";
    if (!vocabulary.has(selected.type)) {
      resolvedRole = fallbackRole; selected = strategy[resolvedRole] || strategy.default; reason = "outside_vocabulary";
    }
    if (specialRoles.has(resolvedRole)) {
      const used = counts.get(resolvedRole) || 0;
      const limit = limits[resolvedRole] ?? limits.special;
      if (used >= limit) {
        resolvedRole = fallbackRole; selected = strategy[resolvedRole] || strategy.default; reason = "role_limit";
      }
    }
    counts.set(resolvedRole, (counts.get(resolvedRole) || 0) + 1);
    decisions.push({ requestedRole, resolvedRole, type: selected.type, reason });
    return selected;
  }
  return { select, vocabulary: [...vocabulary], counts, decisions };
}
