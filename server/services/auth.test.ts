import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  AuthRequestError,
  changePassword,
  consumeRenderEntitlement,
  createSession,
  createUser,
  deleteSession,
  getSession,
  getUserById,
  setUserPlan,
  verifyLogin,
} from "./auth.js"

async function tempRoot(context: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-auth-"))
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test("createUser rejects duplicates and weak passwords, verifyLogin checks the password", async (context) => {
  const root = await tempRoot(context)

  const user = await createUser("Alice", "correct-secret", root)
  assert.equal(user.username, "alice")

  await assert.rejects(
    createUser("alice", "another-secret", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "USER_EXISTS",
  )
  await assert.rejects(
    createUser("bob", "short", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "WEAK_PASSWORD",
  )

  const authenticated = await verifyLogin("Alice", "correct-secret", root)
  assert.deepEqual(authenticated, user)

  await assert.rejects(
    verifyLogin("alice", "wrong-secret", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "INVALID_CREDENTIALS",
  )
  await assert.rejects(
    verifyLogin("nobody", "correct-secret", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "INVALID_CREDENTIALS",
  )
})

test("changePassword verifies the current password and replaces it", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("erin", "correct-secret", root)

  await assert.rejects(
    changePassword(user.id, "wrong-secret", "new-correct-secret", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "INVALID_CURRENT_PASSWORD",
  )
  await changePassword(user.id, "correct-secret", "new-correct-secret", root)
  await assert.rejects(
    verifyLogin("erin", "correct-secret", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "INVALID_CREDENTIALS",
  )
  assert.deepEqual(await verifyLogin("erin", "new-correct-secret", root), user)
})

test("sessions can be created, looked up, expired, and revoked", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("carol", "correct-secret", root)

  const token = await createSession(user.id, root)
  const session = await getSession(token, root)
  assert.deepEqual(session, { userId: user.id })
  assert.equal(await getSession("not-a-real-token", root), null)

  await deleteSession(token, root)
  assert.equal(await getSession(token, root), null)

  const expiredSessionsFile = path.join(root, "server", "data", "studio-sessions.json")
  await mkdir(path.dirname(expiredSessionsFile), { recursive: true })
  await writeFile(expiredSessionsFile, JSON.stringify({
    version: 1,
    sessions: [{
      tokenHash: createHash("sha256").update("expired-token").digest("hex"),
      userId: user.id,
      createdAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-02T00:00:00.000Z",
    }],
  }))
  assert.equal(await getSession("expired-token", root), null)
})

test("getUserById returns a redacted user or null", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("dave", "correct-secret", root)

  assert.deepEqual(await getUserById(user.id, root), user)
  assert.equal(await getUserById("11111111-1111-4111-8111-111111111111", root), null)
})

test("new accounts default to zero per-video credits and are blocked from rendering", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("frank", "correct-secret", root)

  await assert.rejects(
    consumeRenderEntitlement(user.id, root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "RENDER_QUOTA_EXCEEDED",
  )
})

test("setUserPlan grants per-video credits that consumeRenderEntitlement decrements and exhausts", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("grace", "correct-secret", root)

  await setUserPlan("grace", { type: "per_video", creditsRemaining: 2 }, root)
  await consumeRenderEntitlement(user.id, root)
  await consumeRenderEntitlement(user.id, root)
  await assert.rejects(
    consumeRenderEntitlement(user.id, root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "RENDER_QUOTA_EXCEEDED",
  )

  await assert.rejects(
    setUserPlan("nobody", { type: "per_video", creditsRemaining: 1 }, root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "USER_NOT_FOUND",
  )
})

test("subscription plans enforce a monthly render quota and reset after the billing period rolls over", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("henry", "correct-secret", root)
  await setUserPlan("henry", { type: "subscription", monthlyRenderQuota: 2, rendersUsedThisPeriod: 0, periodStart: new Date().toISOString() }, root)

  await consumeRenderEntitlement(user.id, root)
  await consumeRenderEntitlement(user.id, root)
  await assert.rejects(
    consumeRenderEntitlement(user.id, root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "RENDER_QUOTA_EXCEEDED",
  )

  const usersFile = path.join(root, "server", "data", "studio-users.json")
  const store = JSON.parse(await readFile(usersFile, "utf8"))
  const stale = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString()
  store.users = store.users.map((candidate: { username: string; plan?: unknown }) =>
    candidate.username === "henry" ? { ...candidate, plan: { type: "subscription", monthlyRenderQuota: 2, rendersUsedThisPeriod: 2, periodStart: stale } } : candidate)
  await writeFile(usersFile, `${JSON.stringify(store, null, 2)}\n`, "utf8")

  // A new billing period rolls the usage counter back to zero instead of staying blocked.
  await consumeRenderEntitlement(user.id, root)
})
