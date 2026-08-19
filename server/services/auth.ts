import { readFile } from "node:fs/promises"
import path from "node:path"
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

import { z } from "zod"

import { withLock } from "./fileLock.js"
import { writeJsonAtomic } from "./atomicFile.js"

const scryptAsync = promisify(scrypt)

const SALT_BYTES = 16
const KEY_LENGTH = 64
const SESSION_BYTES = 32
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SUBSCRIPTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000
const PASSWORD_RESET_BYTES = 32
// Short on purpose: the token is a bearer credential for the account, and a
// customer who asked for a reset acts on it within minutes.
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000

const planSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("subscription"),
    monthlyRenderQuota: z.number().int().min(0),
    rendersUsedThisPeriod: z.number().int().min(0),
    periodStart: z.string().datetime(),
  }),
  z.object({
    type: z.literal("per_video"),
    creditsRemaining: z.number().int().min(0),
  }),
])
export type Plan = z.infer<typeof planSchema>

function defaultPlan(): Plan {
  return { type: "per_video", creditsRemaining: 0 }
}

const userSchema = z.object({
  id: z.string().uuid(),
  username: z.string().min(1),
  passwordHash: z.string().min(1),
  createdAt: z.string().datetime(),
  // Optional so accounts created before email existed keep parsing. Every new
  // account is required to supply one (see registerInputSchema); the older,
  // email-less accounts are pushed through the backfill prompt at their next
  // sign-in, which is why the absence has to be representable at all.
  email: z.string().email().optional(),
  // When this account ticked the Terms of Service + Privacy Policy box. Absent
  // on accounts created before those pages existed — see `termsAccepted`.
  termsAcceptedAt: z.string().datetime().optional(),
  // Optional so accounts created before billing plans existed keep parsing;
  // treated as defaultPlan() (no render entitlement) wherever it's read.
  plan: planSchema.optional(),
  // Links this account to its Stripe Customer/Subscription so webhook
  // events (which only carry Stripe ids) can be reconciled back to a user.
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
  // Provider-neutral payment ids already applied to this account. This makes
  // asynchronous IPN/webhook retries idempotent without trusting browser redirects.
  processedPaymentIds: z.array(z.string()).optional(),
})
const userStoreSchema = z.object({ version: z.literal(1), users: z.array(userSchema) })

const sessionSchema = z.object({
  tokenHash: z.string().min(1),
  userId: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
})
const sessionStoreSchema = z.object({ version: z.literal(1), sessions: z.array(sessionSchema) })

// Password-reset tokens are stored exactly like sessions — hashed, never in
// the clear — so a leaked copy of server/data/ cannot be replayed into an
// account takeover. `usedAt` is what makes a token single-use: it is kept
// rather than deleted so a replay is rejected as used, not as unknown.
const passwordResetSchema = z.object({
  tokenHash: z.string().min(1),
  userId: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  usedAt: z.string().datetime().optional(),
})
const passwordResetStoreSchema = z.object({ version: z.literal(1), resets: z.array(passwordResetSchema) })

// One place that decides what "the same email" means, so a lookup can never
// disagree with the uniqueness check that was supposed to prevent the clash.
function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

const emailSchema = z.string().trim().toLowerCase().email().max(200)

export const loginInputSchema = z.object({ username: z.string().min(1), password: z.string().min(1) })
export type LoginInput = z.infer<typeof loginInputSchema>
export const registerInputSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Username must use lowercase letters, numbers, or hyphens"),
  password: z.string().min(8).max(200),
  email: emailSchema,
  // Literal `true`, not a boolean: a request that omits the field or sends
  // false is rejected by the schema, so "registered without accepting" is not
  // a state the store can reach.
  acceptedTerms: z.literal(true),
})
export type RegisterInput = z.infer<typeof registerInputSchema>
export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
})
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>
export const setEmailInputSchema = z.object({ email: emailSchema })
export type SetEmailInput = z.infer<typeof setEmailInputSchema>
export const forgotPasswordInputSchema = z.object({ email: emailSchema })
export type ForgotPasswordInput = z.infer<typeof forgotPasswordInputSchema>
export const resetPasswordInputSchema = z.object({
  token: z.string().min(1).max(200),
  newPassword: z.string().min(8).max(200),
})
export type ResetPasswordInput = z.infer<typeof resetPasswordInputSchema>

export type StudioUser = z.infer<typeof userSchema>
export type AuthenticatedUser = {
  id: string
  username: string
  plan: Plan
  isAdmin: boolean
  /**
   * `null` for an account created before email was required. The web app reads
   * this to decide whether to run the one-time backfill prompt, so it has to be
   * distinguishable from "not loaded" rather than silently defaulted.
   */
  email: string | null
  termsAccepted: boolean
}

// Single source for "is this account an admin" — app.ts's requireAdmin gate
// and the isAdmin flag handed to the frontend both call this, so a change to
// STOREEL_ADMIN_USERNAMES can't leave one of them checking a stale copy.
export function isAdminUsername(username: string): boolean {
  const admins = new Set((process.env.STOREEL_ADMIN_USERNAMES || "storeel").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean))
  return admins.has(username.toLowerCase())
}

function redactUser(user: StudioUser): AuthenticatedUser {
  return {
    id: user.id,
    username: user.username,
    plan: user.plan ?? defaultPlan(),
    isAdmin: isAdminUsername(user.username),
    email: user.email ?? null,
    termsAccepted: Boolean(user.termsAcceptedAt),
  }
}

export class AuthRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

function dataDir(engineRoot: string) {
  return path.resolve(engineRoot, "server", "data")
}

function usersFile(engineRoot: string) {
  return path.join(dataDir(engineRoot), "studio-users.json")
}

function sessionsFile(engineRoot: string) {
  return path.join(dataDir(engineRoot), "studio-sessions.json")
}

function passwordResetsFile(engineRoot: string) {
  return path.join(dataDir(engineRoot), "studio-password-resets.json")
}

async function readUsers(engineRoot: string) {
  try {
    return userStoreSchema.parse(JSON.parse(await readFile(usersFile(engineRoot), "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 as const, users: [] }
    throw new AuthRequestError(500, "INVALID_USER_STORE", "Studio user store is invalid")
  }
}

async function readSessions(engineRoot: string) {
  try {
    return sessionStoreSchema.parse(JSON.parse(await readFile(sessionsFile(engineRoot), "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 as const, sessions: [] }
    throw new AuthRequestError(500, "INVALID_SESSION_STORE", "Studio session store is invalid")
  }
}

async function readPasswordResets(engineRoot: string) {
  try {
    return passwordResetStoreSchema.parse(JSON.parse(await readFile(passwordResetsFile(engineRoot), "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1 as const, resets: [] }
    throw new AuthRequestError(500, "INVALID_RESET_STORE", "Password reset store is invalid")
  }
}

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex")
}

async function hashPassword(password: string) {
  const salt = randomBytes(SALT_BYTES).toString("hex")
  const derived = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer
  return `scrypt$${salt}$${derived.toString("hex")}`
}

async function verifyPassword(password: string, stored: string) {
  const parts = stored.split("$")
  if (parts.length !== 3 || parts[0] !== "scrypt") return false
  const [, salt, hashHex] = parts
  const expected = Buffer.from(hashHex, "hex")
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer
  return derived.length === expected.length && timingSafeEqual(derived, expected)
}

export async function createUser(
  username: string,
  password: string,
  options: { email?: string; acceptedTerms?: boolean } = {},
  engineRoot = process.cwd(),
): Promise<AuthenticatedUser> {
  const normalized = username.trim().toLowerCase()
  if (!normalized) throw new AuthRequestError(400, "INVALID_USERNAME", "Username must not be empty")
  if (password.length < 8) throw new AuthRequestError(400, "WEAK_PASSWORD", "Password must be at least 8 characters")
  const email = options.email ? normalizeEmail(options.email) : undefined
  const now = new Date().toISOString()

  return withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    if (store.users.some((user) => user.username === normalized)) {
      throw new AuthRequestError(409, "USER_EXISTS", `A user named ${normalized} already exists`)
    }
    // One address, one account: `createPasswordReset` resolves an account *by
    // email*, so a shared address would make "reset my password" ambiguous.
    if (email && store.users.some((user) => user.email === email)) {
      throw new AuthRequestError(409, "EMAIL_EXISTS", "That email address is already registered")
    }
    const user: StudioUser = {
      id: randomUUID(),
      username: normalized,
      passwordHash: await hashPassword(password),
      createdAt: now,
      email,
      termsAcceptedAt: options.acceptedTerms ? now : undefined,
      plan: defaultPlan(),
    }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users: [...store.users, user] })
    return redactUser(user)
  })
}

/**
 * The backfill path for accounts that predate the email requirement, and the
 * only way an address can change afterwards.
 *
 * Deliberately does not send a confirmation mail: an account with no address
 * at all cannot be reached to confirm one, so requiring confirmation would
 * lock exactly the users this exists for out of the flow. The trade is that a
 * typo is recoverable only while the customer is still signed in — which is
 * why the web app makes this a prompt at sign-in rather than a silent default.
 */
export async function setUserEmail(userId: string, email: string, engineRoot = process.cwd()): Promise<AuthenticatedUser> {
  const normalized = normalizeEmail(email)
  return withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.id === userId)
    const user = store.users[userIndex]
    if (!user) throw new AuthRequestError(401, "UNAUTHENTICATED", "Session user no longer exists")
    if (store.users.some((candidate) => candidate.email === normalized && candidate.id !== userId)) {
      throw new AuthRequestError(409, "EMAIL_EXISTS", "That email address is already registered")
    }
    const users = [...store.users]
    users[userIndex] = { ...user, email: normalized }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
    return redactUser(users[userIndex])
  })
}

// Recorded when an existing account ticks the box on the backfill prompt, so
// consent is dated rather than assumed for anyone who registered before the
// policy pages existed.
export async function acceptTerms(userId: string, engineRoot = process.cwd()): Promise<AuthenticatedUser> {
  return withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.id === userId)
    const user = store.users[userIndex]
    if (!user) throw new AuthRequestError(401, "UNAUTHENTICATED", "Session user no longer exists")
    const users = [...store.users]
    users[userIndex] = { ...user, termsAcceptedAt: user.termsAcceptedAt ?? new Date().toISOString() }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
    return redactUser(users[userIndex])
  })
}

export async function verifyLogin(username: string, password: string, engineRoot = process.cwd()): Promise<AuthenticatedUser> {
  const normalized = username.trim().toLowerCase()
  const store = await readUsers(engineRoot)
  const user = store.users.find((candidate) => candidate.username === normalized)
  const valid = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`)
  if (!user || !valid) throw new AuthRequestError(401, "INVALID_CREDENTIALS", "Invalid username or password")
  return redactUser(user)
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string, engineRoot = process.cwd()): Promise<void> {
  if (newPassword.length < 8) throw new AuthRequestError(400, "WEAK_PASSWORD", "Password must be at least 8 characters")
  await withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.id === userId)
    const user = store.users[userIndex]
    if (!user || !await verifyPassword(currentPassword, user.passwordHash)) {
      throw new AuthRequestError(401, "INVALID_CURRENT_PASSWORD", "Current password is incorrect")
    }
    const users = [...store.users]
    users[userIndex] = { ...user, passwordHash: await hashPassword(newPassword) }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
  })
}

// The one billable action: starting a real (non-dry-run) render job. Called
// from the /api/projects/:id/job route before the job is handed to the job
// runner. Throws if the account has no render entitlement left; otherwise
// consumes one unit (a render slot for subscriptions, a credit for
// per-video) and persists it so the count survives a server restart.
export async function consumeRenderEntitlement(userId: string, engineRoot = process.cwd()): Promise<void> {
  await withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.id === userId)
    const user = store.users[userIndex]
    if (!user) throw new AuthRequestError(401, "UNAUTHENTICATED", "Session user no longer exists")
    const plan = user.plan ?? defaultPlan()

    if (plan.type === "per_video") {
      if (plan.creditsRemaining <= 0) {
        throw new AuthRequestError(402, "RENDER_QUOTA_EXCEEDED", "No render credits remaining — buy another video to continue")
      }
      const users = [...store.users]
      users[userIndex] = { ...user, plan: { ...plan, creditsRemaining: plan.creditsRemaining - 1 } }
      await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
      return
    }

    const periodExpired = Date.now() - Date.parse(plan.periodStart) >= SUBSCRIPTION_PERIOD_MS
    const current = periodExpired
      ? { ...plan, rendersUsedThisPeriod: 0, periodStart: new Date().toISOString() }
      : plan
    if (current.rendersUsedThisPeriod >= current.monthlyRenderQuota) {
      throw new AuthRequestError(402, "RENDER_QUOTA_EXCEEDED", "Monthly render quota reached for this billing period")
    }
    const users = [...store.users]
    users[userIndex] = { ...user, plan: { ...current, rendersUsedThisPeriod: current.rendersUsedThisPeriod + 1 } }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
  })
}

/**
 * The inverse of `consumeRenderEntitlement`, for a render that never produced a
 * film. Charging happens at start (which is what keeps a double-submit from
 * spending twice), so a run that dies in `build` before a single frame exists
 * has to hand the credit back — otherwise a customer pays for a failure the
 * pipeline caused.
 *
 * Callers must route through `renderBilling`, which holds the one reservation
 * per project that makes this idempotent; calling it directly would let a
 * repeated settle mint credits.
 */
export async function refundRenderEntitlement(userId: string, engineRoot = process.cwd()): Promise<void> {
  await withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.id === userId)
    const user = store.users[userIndex]
    // A deleted user is not an error here: there is nobody left to credit, and
    // throwing would strand the job runner mid-settle.
    if (!user) return
    const plan = user.plan ?? defaultPlan()
    const users = [...store.users]

    if (plan.type === "per_video") {
      users[userIndex] = { ...user, plan: { ...plan, creditsRemaining: plan.creditsRemaining + 1 } }
    } else {
      // If the billing period rolled over while the render was running the
      // usage counter has already been reset, and `max(0, …)` keeps the refund
      // from pushing it negative.
      users[userIndex] = { ...user, plan: { ...plan, rendersUsedThisPeriod: Math.max(0, plan.rendersUsedThisPeriod - 1) } }
    }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
  })
}

// Manual provisioning path (CLI), kept alongside the Stripe-driven functions
// below for comp accounts or when billing.ts isn't configured.
export async function setUserPlan(username: string, plan: Plan, engineRoot = process.cwd()): Promise<AuthenticatedUser> {
  const normalized = username.trim().toLowerCase()
  return withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.username === normalized)
    const user = store.users[userIndex]
    if (!user) throw new AuthRequestError(404, "USER_NOT_FOUND", `No user named ${normalized}`)
    const users = [...store.users]
    users[userIndex] = { ...user, plan }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
    return redactUser(users[userIndex])
  })
}

// --- Stripe reconciliation ---------------------------------------------
// These are only ever called from server/services/billing.ts (checkout
// session creation + webhook handling). Every one of them looks the user up
// by an id Stripe gave us (stripeCustomerId), and no-ops on an unknown
// customer rather than throwing — a webhook handler must stay resilient to
// stale/out-of-order events and always return 200 to Stripe.

export async function getStripeCustomerId(userId: string, engineRoot = process.cwd()): Promise<string | null> {
  const store = await readUsers(engineRoot)
  return store.users.find((candidate) => candidate.id === userId)?.stripeCustomerId ?? null
}

// Persists a newly created Stripe Customer id for this user. Idempotent: if
// the user is already linked (e.g. a duplicate checkout click raced this
// call), the existing id wins and the new one is silently dropped by the
// caller — billing.ts always re-reads via getStripeCustomerId first.
export async function linkStripeCustomer(userId: string, stripeCustomerId: string, engineRoot = process.cwd()): Promise<void> {
  await withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.id === userId)
    const user = store.users[userIndex]
    if (!user || user.stripeCustomerId) return
    const users = [...store.users]
    users[userIndex] = { ...user, stripeCustomerId }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
  })
}

export async function activateSubscription(
  stripeCustomerId: string,
  input: { stripeSubscriptionId: string; monthlyRenderQuota: number },
  engineRoot = process.cwd(),
): Promise<void> {
  await withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.stripeCustomerId === stripeCustomerId)
    if (userIndex === -1) return
    const users = [...store.users]
    users[userIndex] = {
      ...users[userIndex],
      stripeSubscriptionId: input.stripeSubscriptionId,
      plan: { type: "subscription", monthlyRenderQuota: input.monthlyRenderQuota, rendersUsedThisPeriod: 0, periodStart: new Date().toISOString() },
    }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
  })
}

// A per-video Checkout Session completed. Only applies while the account is
// (still) on the per_video plan — a subscriber's checkout is always created
// in "subscription" mode (see billing.ts), so this branch only exists as a
// defensive guard against a stale/replayed event.
export async function grantPerVideoCredits(stripeCustomerId: string, amount: number, engineRoot = process.cwd()): Promise<void> {
  await withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.stripeCustomerId === stripeCustomerId)
    if (userIndex === -1) return
    const user = store.users[userIndex]
    const plan = user.plan ?? defaultPlan()
    if (plan.type !== "per_video") return
    const users = [...store.users]
    users[userIndex] = { ...user, plan: { type: "per_video", creditsRemaining: plan.creditsRemaining + amount } }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
  })
}

export async function grantPerVideoCreditsToUser(
  userId: string,
  amount: number,
  paymentId: string,
  engineRoot = process.cwd(),
): Promise<boolean> {
  return withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.id === userId)
    if (userIndex === -1) return false
    const user = store.users[userIndex]
    const processed = user.processedPaymentIds ?? []
    if (processed.includes(paymentId)) return false
    const plan = user.plan ?? defaultPlan()
    if (plan.type !== "per_video") return false
    const users = [...store.users]
    users[userIndex] = {
      ...user,
      processedPaymentIds: [...processed, paymentId],
      plan: { type: "per_video", creditsRemaining: plan.creditsRemaining + amount },
    }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
    return true
  })
}

// Stripe's `invoice.paid` fires on every successful renewal charge — this is
// the real billing-period boundary, more precise than consumeRenderEntitlement's
// 30-day rolling-window fallback (which only applies to manually/CLI-granted
// subscriptions that never touch Stripe).
export async function resetSubscriptionPeriod(stripeCustomerId: string, engineRoot = process.cwd()): Promise<void> {
  await withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.stripeCustomerId === stripeCustomerId)
    if (userIndex === -1) return
    const user = store.users[userIndex]
    if (!user.plan || user.plan.type !== "subscription") return
    const users = [...store.users]
    users[userIndex] = { ...user, plan: { ...user.plan, rendersUsedThisPeriod: 0, periodStart: new Date().toISOString() } }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
  })
}

// Subscription cancelled or payment failed permanently — revert to the same
// zero-entitlement default a brand-new account gets, rather than leaving a
// stale monthly quota active after the customer stopped paying for it.
export async function cancelSubscription(stripeCustomerId: string, engineRoot = process.cwd()): Promise<void> {
  await withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.stripeCustomerId === stripeCustomerId)
    if (userIndex === -1) return
    const users = [...store.users]
    users[userIndex] = { ...users[userIndex], plan: defaultPlan() }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
  })
}

export async function createSession(userId: string, engineRoot = process.cwd()): Promise<string> {
  const token = randomBytes(SESSION_BYTES).toString("base64url")
  const now = Date.now()
  return withLock(sessionsFile(engineRoot), async () => {
    const store = await readSessions(engineRoot)
    const live = store.sessions.filter((session) => Date.parse(session.expiresAt) > now)
    const session = {
      tokenHash: hashToken(token),
      userId,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + SESSION_TTL_MS).toISOString(),
    }
    await writeJsonAtomic(sessionsFile(engineRoot), { version: 1, sessions: [...live, session] })
    return token
  })
}

export async function getSession(token: string, engineRoot = process.cwd()): Promise<{ userId: string } | null> {
  const store = await readSessions(engineRoot)
  const tokenHash = hashToken(token)
  const session = store.sessions.find((candidate) => candidate.tokenHash === tokenHash)
  if (!session || Date.parse(session.expiresAt) <= Date.now()) return null
  return { userId: session.userId }
}

export async function deleteSession(token: string, engineRoot = process.cwd()): Promise<void> {
  const tokenHash = hashToken(token)
  await withLock(sessionsFile(engineRoot), async () => {
    const store = await readSessions(engineRoot)
    const sessions = store.sessions.filter((session) => session.tokenHash !== tokenHash)
    await writeJsonAtomic(sessionsFile(engineRoot), { version: 1, sessions })
  })
}

// Called after a password reset. A reset exists because the customer may have
// lost control of the account, so every session minted under the old password
// has to die with it — otherwise whoever caused the reset keeps their access.
async function deleteSessionsForUser(userId: string, engineRoot: string): Promise<void> {
  await withLock(sessionsFile(engineRoot), async () => {
    const store = await readSessions(engineRoot)
    const sessions = store.sessions.filter((session) => session.userId !== userId)
    await writeJsonAtomic(sessionsFile(engineRoot), { version: 1, sessions })
  })
}

/**
 * Mint a one-time password-reset token for whoever owns `email`.
 *
 * Returns `null` for an address with no account. The caller must answer the
 * HTTP request identically either way — the endpoint is unauthenticated, so a
 * distinguishable response turns it into a "does this person have an account
 * here?" oracle over a customer list of real wedding couples.
 */
export async function createPasswordReset(
  email: string,
  engineRoot = process.cwd(),
): Promise<{ token: string; username: string; email: string; expiresAt: string } | null> {
  const normalized = normalizeEmail(email)
  const store = await readUsers(engineRoot)
  const user = store.users.find((candidate) => candidate.email === normalized)
  if (!user) return null

  const token = randomBytes(PASSWORD_RESET_BYTES).toString("base64url")
  const now = Date.now()
  const expiresAt = new Date(now + PASSWORD_RESET_TTL_MS).toISOString()
  await withLock(passwordResetsFile(engineRoot), async () => {
    const resets = await readPasswordResets(engineRoot)
    // Drop rows that can never be redeemed again so a long-lived deployment
    // doesn't accumulate them, and invalidate this user's earlier outstanding
    // tokens: asking for a second link is how someone says the first one is
    // not in their hands.
    const retained = resets.resets.filter((reset) =>
      !reset.usedAt && Date.parse(reset.expiresAt) > now && reset.userId !== user.id)
    await writeJsonAtomic(passwordResetsFile(engineRoot), {
      version: 1,
      resets: [...retained, { tokenHash: hashToken(token), userId: user.id, createdAt: new Date(now).toISOString(), expiresAt }],
    })
  })
  return { token, username: user.username, email: normalized, expiresAt }
}

/**
 * Redeem a reset token and set the new password.
 *
 * Marks the token used *inside the same lock* that reads it, so two requests
 * racing on one token cannot both pass the check.
 */
export async function resetPasswordWithToken(token: string, newPassword: string, engineRoot = process.cwd()): Promise<void> {
  if (newPassword.length < 8) throw new AuthRequestError(400, "WEAK_PASSWORD", "Password must be at least 8 characters")
  const tokenHash = hashToken(token)
  const now = Date.now()

  const userId = await withLock(passwordResetsFile(engineRoot), async () => {
    const store = await readPasswordResets(engineRoot)
    const index = store.resets.findIndex((reset) => reset.tokenHash === tokenHash)
    const reset = store.resets[index]
    // One error code for unknown / used / expired. Telling them apart would
    // confirm to a stranger that a token they guessed once existed.
    if (!reset || reset.usedAt || Date.parse(reset.expiresAt) <= now) {
      throw new AuthRequestError(400, "INVALID_RESET_TOKEN", "This password reset link is invalid or has expired")
    }
    const resets = [...store.resets]
    resets[index] = { ...reset, usedAt: new Date(now).toISOString() }
    await writeJsonAtomic(passwordResetsFile(engineRoot), { version: 1, resets })
    return reset.userId
  })

  await withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    const userIndex = store.users.findIndex((candidate) => candidate.id === userId)
    const user = store.users[userIndex]
    if (!user) throw new AuthRequestError(400, "INVALID_RESET_TOKEN", "This password reset link is invalid or has expired")
    const users = [...store.users]
    users[userIndex] = { ...user, passwordHash: await hashPassword(newPassword) }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users })
  })

  await deleteSessionsForUser(userId, engineRoot)
}

export async function getUserById(userId: string, engineRoot = process.cwd()): Promise<AuthenticatedUser | null> {
  const store = await readUsers(engineRoot)
  const user = store.users.find((candidate) => candidate.id === userId)
  return user ? redactUser(user) : null
}
