const DEFAULT_LIMITS = { special: 2, chapter: 3 };

/** Apply a recipe's small transition vocabulary and enforce special-effect caps. */
export function createTransitionGrammar(strategy = {}, grammar = {}) {
  const vocabulary = new Set(grammar.vocabulary || Object.values(strategy)
    .flatMap((t) => (Array.isArray(t) ? t : [t]))
    .map((t) => t?.type)
    .filter(Boolean));
  const fallbackRole = grammar.fallbackRole || "default";
  const specialRoles = new Set(grammar.specialRoles || ["peak", "memory"]);
  const limits = { ...DEFAULT_LIMITS, ...(grammar.limits || {}) };
  const counts = new Map();
  const decisions = [];

  // A role's strategy entry may be a single {type,duration} or an array of a few —
  // the array cycles deterministically by how many times that resolved role has
  // already fired, so e.g. "default" (the role most scenes share) does not render
  // the exact same cut over and over across the whole film.
  function pick(entry, role) {
    if (!Array.isArray(entry)) return entry;
    if (!entry.length) return undefined;
    return entry[(counts.get(role) || 0) % entry.length];
  }

  function select(role, isLast) {
    const requestedRole = isLast ? "final" : role;
    let resolvedRole = strategy[requestedRole] ? requestedRole : fallbackRole;
    let selected = pick(strategy[resolvedRole], resolvedRole) || pick(strategy.default, "default") || { type: "crossfade", duration: 0.7 };
    let reason = "role";
    if (!vocabulary.has(selected.type)) {
      resolvedRole = fallbackRole; selected = pick(strategy[resolvedRole], resolvedRole) || pick(strategy.default, "default"); reason = "outside_vocabulary";
    }
    if (specialRoles.has(resolvedRole)) {
      const used = counts.get(resolvedRole) || 0;
      const limit = limits[resolvedRole] ?? limits.special;
      if (used >= limit) {
        resolvedRole = fallbackRole; selected = pick(strategy[resolvedRole], resolvedRole) || pick(strategy.default, "default"); reason = "role_limit";
      }
    }
    counts.set(resolvedRole, (counts.get(resolvedRole) || 0) + 1);
    decisions.push({ requestedRole, resolvedRole, type: selected.type, reason });
    return selected;
  }
  return { select, vocabulary: [...vocabulary], counts, decisions };
}
