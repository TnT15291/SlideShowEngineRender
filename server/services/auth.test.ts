import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import {
  acceptTerms,
  AuthRequestError,
  changePassword,
  consumeRenderEntitlement,
  createPasswordReset,
  createSession,
  createUser,
  deleteSession,
  getSession,
  getUserById,
  isAdminUsername,
  resetPasswordWithToken,
  setUserEmail,
  setUserPlan,
  verifyLogin,
} from "./auth.js"

function withAdminUsernames(context: { after: (fn: () => unknown) => void }, value: string) {
  const previous = process.env.STOREEL_ADMIN_USERNAMES
  process.env.STOREEL_ADMIN_USERNAMES = value
  context.after(() => {
    if (previous === undefined) delete process.env.STOREEL_ADMIN_USERNAMES
    else process.env.STOREEL_ADMIN_USERNAMES = previous
  })
}

async function tempRoot(context: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-auth-"))
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test("createUser rejects duplicates and weak passwords, verifyLogin checks the password", async (context) => {
  const root = await tempRoot(context)

  const user = await createUser("Alice", "correct-secret", {}, root)
  assert.equal(user.username, "alice")

  await assert.rejects(
    createUser("alice", "another-secret", {}, root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "USER_EXISTS",
  )
  await assert.rejects(
    createUser("bob", "short", {}, root),
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
  const user = await createUser("erin", "correct-secret", {}, root)

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
  const user = await createUser("carol", "correct-secret", {}, root)

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
  const user = await createUser("dave", "correct-secret", {}, root)

  assert.deepEqual(await getUserById(user.id, root), user)
  assert.equal(await getUserById("11111111-1111-4111-8111-111111111111", root), null)
})

test("isAdminUsername reads STOREEL_ADMIN_USERNAMES as a case-insensitive, comma-separated list, defaulting to storeel", (context) => {
  const previous = process.env.STOREEL_ADMIN_USERNAMES
  delete process.env.STOREEL_ADMIN_USERNAMES
  context.after(() => { if (previous !== undefined) process.env.STOREEL_ADMIN_USERNAMES = previous })
  assert.equal(isAdminUsername("storeel"), true)
  assert.equal(isAdminUsername("STOREEL"), true)
  assert.equal(isAdminUsername("alice"), false)

  withAdminUsernames(context, "Alice, bob")
  assert.equal(isAdminUsername("alice"), true)
  assert.equal(isAdminUsername("BOB"), true)
  assert.equal(isAdminUsername("storeel"), false)
})

test("account isAdmin follows STOREEL_ADMIN_USERNAMES, not a hardcoded name", async (context) => {
  const root = await tempRoot(context)
  withAdminUsernames(context, "root-admin")

  const admin = await createUser("root-admin", "correct-secret", {}, root)
  assert.equal(admin.isAdmin, true)

  const member = await createUser("alice", "correct-secret", {}, root)
  assert.equal(member.isAdmin, false)

  assert.equal((await verifyLogin("root-admin", "correct-secret", root)).isAdmin, true)
  assert.equal((await getUserById(admin.id, root))?.isAdmin, true)
  assert.equal((await getUserById(member.id, root))?.isAdmin, false)
})

test("new accounts default to zero per-video credits and are blocked from rendering", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("frank", "correct-secret", {}, root)

  await assert.rejects(
    consumeRenderEntitlement(user.id, root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "RENDER_QUOTA_EXCEEDED",
  )
})

test("setUserPlan grants per-video credits that consumeRenderEntitlement decrements and exhausts", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("grace", "correct-secret", {}, root)

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

test("email is normalised, unique across accounts, and exposed on the redacted user", async (context) => {
  const root = await tempRoot(context)

  const user = await createUser("ivy", "correct-secret", { email: "  Ivy@Example.COM ", acceptedTerms: true }, root)
  assert.equal(user.email, "ivy@example.com")
  assert.equal(user.termsAccepted, true)

  // Differs only by case and surrounding space — same address, so it must not
  // create a second account that `createPasswordReset` could resolve to.
  await assert.rejects(
    createUser("ivy-two", "correct-secret", { email: "IVY@example.com", acceptedTerms: true }, root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "EMAIL_EXISTS",
  )

  // An account created without one — the shape every pre-existing account has
  // on disk — still parses, and reports the gap rather than inventing a value.
  const legacy = await createUser("jonah", "correct-secret", {}, root)
  assert.equal(legacy.email, null)
  assert.equal(legacy.termsAccepted, false)
})

test("setUserEmail backfills a legacy account, rejects an address already in use, and acceptTerms is idempotent", async (context) => {
  const root = await tempRoot(context)
  const legacy = await createUser("kara", "correct-secret", {}, root)
  const other = await createUser("liam-two", "correct-secret", { email: "taken@example.com", acceptedTerms: true }, root)

  const backfilled = await setUserEmail(legacy.id, "Kara@Example.com", root)
  assert.equal(backfilled.email, "kara@example.com")
  assert.equal((await getUserById(legacy.id, root))?.email, "kara@example.com")

  await assert.rejects(
    setUserEmail(legacy.id, "taken@example.com", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "EMAIL_EXISTS",
  )
  // Re-submitting the address it already holds is not a clash with itself.
  assert.equal((await setUserEmail(legacy.id, "kara@example.com", root)).email, "kara@example.com")

  const accepted = await acceptTerms(legacy.id, root)
  assert.equal(accepted.termsAccepted, true)
  const usersFile = path.join(root, "server", "data", "studio-users.json")
  const firstAcceptance = JSON.parse(await readFile(usersFile, "utf8")).users
    .find((candidate: { id: string }) => candidate.id === legacy.id).termsAcceptedAt
  await acceptTerms(legacy.id, root)
  const secondAcceptance = JSON.parse(await readFile(usersFile, "utf8")).users
    .find((candidate: { id: string }) => candidate.id === legacy.id).termsAcceptedAt
  // The date consent was first given is the fact worth keeping; a second call
  // must not quietly move it forward.
  assert.equal(secondAcceptance, firstAcceptance)
  assert.equal((await getUserById(other.id, root))?.termsAccepted, true)
})

test("a password reset token works once, dies on reuse, and takes every existing session with it", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("mira", "correct-secret", { email: "mira@example.com", acceptedTerms: true }, root)
  const sessionToken = await createSession(user.id, root)
  assert.deepEqual(await getSession(sessionToken, root), { userId: user.id })

  // An address nobody registered yields no token at all — the caller has
  // nothing to send, and nothing to tell an attacker apart with.
  assert.equal(await createPasswordReset("stranger@example.com", root), null)

  const reset = await createPasswordReset("MIRA@example.com", root)
  assert.ok(reset)
  assert.equal(reset.username, "mira")
  assert.equal(reset.email, "mira@example.com")

  // Stored hashed, exactly like a session token.
  const resetsFile = path.join(root, "server", "data", "studio-password-resets.json")
  const stored = JSON.parse(await readFile(resetsFile, "utf8"))
  assert.equal(stored.resets.length, 1)
  assert.equal(stored.resets[0].tokenHash, createHash("sha256").update(reset.token).digest("hex"))
  assert.ok(!JSON.stringify(stored).includes(reset.token))

  await assert.rejects(
    resetPasswordWithToken(reset.token, "short", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "WEAK_PASSWORD",
  )

  await resetPasswordWithToken(reset.token, "brand-new-secret", root)
  assert.equal((await verifyLogin("mira", "brand-new-secret", root)).id, user.id)
  await assert.rejects(
    verifyLogin("mira", "correct-secret", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "INVALID_CREDENTIALS",
  )
  // Whoever forced the reset must not keep a session minted under the old password.
  assert.equal(await getSession(sessionToken, root), null)

  await assert.rejects(
    resetPasswordWithToken(reset.token, "another-new-secret", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "INVALID_RESET_TOKEN",
  )
})

test("password reset tokens expire, and asking for a new one revokes the outstanding link", async (context) => {
  const root = await tempRoot(context)
  await createUser("nadir", "correct-secret", { email: "nadir@example.com", acceptedTerms: true }, root)
  const resetsFile = path.join(root, "server", "data", "studio-password-resets.json")

  const first = await createPasswordReset("nadir@example.com", root)
  assert.ok(first)
  const second = await createPasswordReset("nadir@example.com", root)
  assert.ok(second)
  // Requesting a second link is how someone says the first is not in their
  // hands — so exactly one live token remains, and it is the new one.
  assert.equal(JSON.parse(await readFile(resetsFile, "utf8")).resets.length, 1)
  await assert.rejects(
    resetPasswordWithToken(first.token, "brand-new-secret", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "INVALID_RESET_TOKEN",
  )

  await writeFile(resetsFile, JSON.stringify({
    version: 1,
    resets: [{
      tokenHash: createHash("sha256").update("expired-reset").digest("hex"),
      userId: (await getUserById((await verifyLogin("nadir", "correct-secret", root)).id, root))!.id,
      createdAt: "2020-01-01T00:00:00.000Z",
      expiresAt: "2020-01-01T01:00:00.000Z",
    }],
  }))
  await assert.rejects(
    resetPasswordWithToken("expired-reset", "brand-new-secret", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "INVALID_RESET_TOKEN",
  )
  // Rejected as invalid, not silently accepted — the old password still works.
  assert.equal((await verifyLogin("nadir", "correct-secret", root)).username, "nadir")

  await assert.rejects(
    resetPasswordWithToken("never-issued", "brand-new-secret", root),
    (error: unknown) => error instanceof AuthRequestError && error.code === "INVALID_RESET_TOKEN",
  )
})

test("subscription plans enforce a monthly render quota and reset after the billing period rolls over", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("henry", "correct-secret", {}, root)
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
