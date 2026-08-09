import assert from "node:assert/strict"
import test from "node:test"

import { createSettlementTracker, recordJobStatus } from "./jobSettlement"

// The regression this file exists for: opening the render step of a project
// whose last run had already failed used to announce a balance change, which
// reloaded the user, which remounted the panel, which announced it again.
test("the opening snapshot of an already-settled job is not balance news", () => {
  const tracker = createSettlementTracker()
  assert.equal(recordJobStatus(tracker, "failed"), false)
  // ...and a remount must not turn it into news either.
  assert.equal(recordJobStatus(createSettlementTracker(), "completed"), false)
})

test("settling while mounted is announced exactly once", () => {
  const tracker = createSettlementTracker()
  assert.equal(recordJobStatus(tracker, "pending"), false)
  assert.equal(recordJobStatus(tracker, "running"), false)
  assert.equal(recordJobStatus(tracker, "completed"), true)
  // The stream keeps pushing the terminal snapshot; only the transition counts.
  assert.equal(recordJobStatus(tracker, "completed"), false)
  assert.equal(recordJobStatus(tracker, "completed"), false)
})

test("a re-run after a settled run is announced again", () => {
  const tracker = createSettlementTracker()
  recordJobStatus(tracker, "running")
  assert.equal(recordJobStatus(tracker, "failed"), true)
  assert.equal(recordJobStatus(tracker, "running"), false)
  assert.equal(recordJobStatus(tracker, "failed"), true)
})

test("a run that ends in a different terminal state is still news", () => {
  const tracker = createSettlementTracker()
  recordJobStatus(tracker, "running")
  assert.equal(recordJobStatus(tracker, "completed"), true)
  assert.equal(recordJobStatus(tracker, "completed_with_warning"), true)
})

test("paused is not terminal, so resuming and finishing still announces", () => {
  const tracker = createSettlementTracker()
  recordJobStatus(tracker, "running")
  assert.equal(recordJobStatus(tracker, "paused"), false)
  assert.equal(recordJobStatus(tracker, "running"), false)
  assert.equal(recordJobStatus(tracker, "completed"), true)
})
