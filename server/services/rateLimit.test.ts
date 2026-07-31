import assert from "node:assert/strict"
import test from "node:test"

import { createRateLimiter } from "./rateLimit.js"

test("allows up to the limit, then blocks within the same window", () => {
  let clock = 0
  const allow = createRateLimiter(3, 1000, () => clock)
  assert.equal(allow("1.2.3.4"), true)
  assert.equal(allow("1.2.3.4"), true)
  assert.equal(allow("1.2.3.4"), true)
  assert.equal(allow("1.2.3.4"), false)
  clock += 500
  assert.equal(allow("1.2.3.4"), false)
})

test("resets once the window elapses", () => {
  let clock = 0
  const allow = createRateLimiter(1, 1000, () => clock)
  assert.equal(allow("1.2.3.4"), true)
  assert.equal(allow("1.2.3.4"), false)
  clock += 1000
  assert.equal(allow("1.2.3.4"), true)
})

test("tracks each key independently", () => {
  let clock = 0
  const allow = createRateLimiter(1, 1000, () => clock)
  assert.equal(allow("1.2.3.4"), true)
  assert.equal(allow("5.6.7.8"), true)
  assert.equal(allow("1.2.3.4"), false)
  assert.equal(allow("5.6.7.8"), false)
})
