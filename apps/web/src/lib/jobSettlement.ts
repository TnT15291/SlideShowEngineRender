/**
 * When a job snapshot means the account's render balance may have moved.
 *
 * The server holds a credit when a run starts and hands it back when the run
 * reaches a terminal state, so the sidebar balance has to be re-read on those
 * transitions. The rule that is easy to get wrong — and that cost a render step
 * stuck opening and closing forever — is that the *first* snapshot after mount
 * is not a transition. It is a report of a run that settled at some point in
 * the past, possibly days ago, whose refund is already reflected in the balance
 * the page loaded with. Treating it as news re-read the user, which re-resolved
 * the route, which remounted the panel, which read the same terminal snapshot
 * again.
 */

const terminalStatuses = new Set(["failed", "completed", "completed_with_warning"])

export type SettlementTracker = { seen: boolean; settled: string | null }

export function createSettlementTracker(): SettlementTracker {
  return { seen: false, settled: null }
}

/**
 * Records `status` against `tracker` and returns whether that status is news
 * about the balance — true only for a genuine transition into a terminal state
 * observed while mounted, never for the opening snapshot and never twice for
 * the same terminal state.
 */
export function recordJobStatus(tracker: SettlementTracker, status: string): boolean {
  const first = !tracker.seen
  tracker.seen = true
  if (!terminalStatuses.has(status)) {
    tracker.settled = null
    return false
  }
  const news = !first && tracker.settled !== status
  tracker.settled = status
  return news
}
