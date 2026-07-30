import fs from "node:fs";
import path from "node:path";
import { str } from "./strUtils.mjs";

const root = process.cwd();
// ---------------------------------------------------------------------------
// Ledger I/O
// ---------------------------------------------------------------------------
export function loadLedger(file) {
  const abs = path.resolve(root, file);
  if (!fs.existsSync(abs)) return { version: 1, story: "", directives: [], unmapped: [] };
  const doc = JSON.parse(fs.readFileSync(abs, "utf8"));
  return {
    version: doc.version ?? 1,
    story: str(doc.story, 4000),
    directives: Array.isArray(doc.directives) ? doc.directives : [],
    unmapped: Array.isArray(doc.unmapped) ? doc.unmapped : [],
  };
}
export function saveLedger(file, ledger) {
  const abs = path.resolve(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, JSON.stringify(ledger, null, 2) + "\n");
}

/** Stamp ids that are unique ACROSS THE WHOLE LEDGER, not just within one round.
 *
 *  The rule extractor numbers from r1 every time it runs, so round 0 emitted r1,r2,r3 and
 *  round 1 emitted r1,r2 — the ledger then held two different orders under the id `r1`.
 *  Everything that dedupes or looks up by id (the applied-count, audit rows, the
 *  compliance report) silently merged two unrelated instructions into one. An id that is
 *  not unique is not an id. */
export const stampIds = (directives, round) =>
  directives.map((d, i) => ({ ...d, id: `r${round}.${i + 1}`, round }));

const conflictKey = (d) => `${d.kind}:${JSON.stringify(d.scope)}:${d.op}`;

/** Append a revision round. Directives ACCUMULATE — round 2 must not silently undo
 *  round 1. Where two rounds contradict (same kind + same scope), the LATER round
 *  wins, and the superseded one is marked rather than deleted, so the report can
 *  still say "you asked for X, then changed it to Y". */
export function appendRound(ledger, incoming, round) {
  const stamped = stampIds(incoming, round).map((d) => ({ ...d, source: "revision" }));
  const incomingKeys = new Set(stamped.map(conflictKey));
  const kept = ledger.directives.map((d) =>
    incomingKeys.has(conflictKey(d)) && !d.supersededBy ? { ...d, supersededBy: round } : d
  );
  return { ...ledger, directives: [...kept, ...stamped] };
}

/** Re-derive `supersededBy` across the whole ledger from what is still standing.
 *
 *  WHY THIS EXISTS: appendRound only ever SETS supersededBy, so it is a one-way door,
 *  and undo has to walk back through it. Restoring "whatever round N superseded" is not
 *  enough and is actively wrong:
 *
 *      r1 polaroid  --superseded by--> r2 circle_focus  --superseded by--> r3 film_roll
 *
 *  Undo r2 and a naive restore un-supersedes r1, leaving r1 AND r3 both in force on the
 *  same key — two contradictory orders, and whichever applies last wins by accident.
 *
 *  So supersession is DERIVED here rather than trusted: for each conflict key, a
 *  directive is superseded by the next round that also touched that key. Undone
 *  directives are invisible to that reckoning entirely. On a ledger with nothing undone this
 *  reproduces appendRound's answer exactly — it is the same rule, applied to survivors. */
export function recomputeSupersession(directives) {
  const groups = new Map();
  for (const d of directives) {
    if (d.undoneBy) continue; // withdrawn: it cannot supersede, and cannot be superseded
    const k = conflictKey(d);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }

  const replacedBy = new Map();
  for (const group of groups.values()) {
    const rounds = [...new Set(group.map((d) => d.round ?? 0))].sort((a, b) => a - b);
    for (const d of group) {
      const next = rounds.find((r) => r > (d.round ?? 0));
      if (next !== undefined) replacedBy.set(d.id, next);
    }
  }

  return directives.map((d) => {
    const by = replacedBy.get(d.id);
    if (by !== undefined) return { ...d, supersededBy: by };
    const { supersededBy, ...rest } = d; // nothing replaces it any more — back in force
    return rest;
  });
}

/** Withdraw a round. Undo is "stop asking for this, then re-derive" — never "apply the
 *  inverse", which cannot work when the operations do not commute.
 *
 *  The withdrawn directives are MARKED, not deleted, so the receipt can still say "you
 *  asked for X, then took it back".
 *
 *  UNDO IS ONE-WAY, deliberately. An undo round holds no directives of its own — it is a
 *  set of `undoneBy` marks — so there is nothing for a second undo to withdraw, and
 *  `--undo <an undo round>` finds nothing rather than performing a redo. That is the
 *  honest shape: to get a withdrawn order back, ask for it again, which costs one
 *  sentence and leaves a full audit trail. A redo verb would need marks on marks to stay
 *  auditable, and nobody has asked for the film to travel in that direction yet.
 *
 *  @returns {{ledger, undone, restored}} — `restored` is what comes back into force as a
 *  result, which the customer must be shown: undoing "use polaroid" silently reinstates
 *  whatever it had replaced, and a surprise is a surprise in both directions. */
export function undoRound(ledger, target, round) {
  const directives = ledger.directives || [];
  const undone = directives.filter((d) => (d.round ?? 0) === target && !d.undoneBy);
  if (!undone.length) return { ledger, undone: [], restored: [] };

  const wasActive = new Set(active(ledger).map((d) => d.id));
  const marked = directives.map((d) =>
    (d.round ?? 0) === target && !d.undoneBy ? { ...d, undoneBy: round } : d
  );
  const settled = recomputeSupersession(marked);
  const next = { ...ledger, directives: settled };

  return {
    ledger: next,
    undone,
    restored: active(next).filter((d) => !wasActive.has(d.id)),
  };
}

/** The directives actually in force: later rounds have replaced the superseded, and an
 *  undo has withdrawn the rest. */
export const active = (ledger) => (ledger.directives || []).filter((d) => !d.supersededBy && !d.undoneBy);
