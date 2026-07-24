import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto"
import { promisify } from "node:util"

import { z } from "zod"

import { withLock } from "./fileLock.js"

const scryptAsync = promisify(scrypt)

const SALT_BYTES = 16
const KEY_LENGTH = 64
const SESSION_BYTES = 32
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000
const SUBSCRIPTION_PERIOD_MS = 30 * 24 * 60 * 60 * 1000

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
  // Optional so accounts created before billing plans existed keep parsing;
  // treated as defaultPlan() (no render entitlement) wherever it's read.
  plan: planSchema.optional(),
  // Links this account to its Stripe Customer/Subscription so webhook
  // events (which only carry Stripe ids) can be reconciled back to a user.
  stripeCustomerId: z.string().optional(),
  stripeSubscriptionId: z.string().optional(),
})
const userStoreSchema = z.object({ version: z.literal(1), users: z.array(userSchema) })

const sessionSchema = z.object({
  tokenHash: z.string().min(1),
  userId: z.string().uuid(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
})
const sessionStoreSchema = z.object({ version: z.literal(1), sessions: z.array(sessionSchema) })

export const loginInputSchema = z.object({ username: z.string().min(1), password: z.string().min(1) })
export type LoginInput = z.infer<typeof loginInputSchema>
export const registerInputSchema = z.object({
  username: z.string().trim().min(3).max(40).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Username must use lowercase letters, numbers, or hyphens"),
  password: z.string().min(8).max(200),
})
export type RegisterInput = z.infer<typeof registerInputSchema>
export const changePasswordInputSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(200),
})
export type ChangePasswordInput = z.infer<typeof changePasswordInputSchema>

export type StudioUser = z.infer<typeof userSchema>
export type AuthenticatedUser = { id: string; username: string; plan: Plan }

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

async function writeJsonAtomic(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" })
    await rename(temporary, file)
  } finally {
    await rm(temporary, { force: true })
  }
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

export async function createUser(username: string, password: string, engineRoot = process.cwd()): Promise<AuthenticatedUser> {
  const normalized = username.trim().toLowerCase()
  if (!normalized) throw new AuthRequestError(400, "INVALID_USERNAME", "Username must not be empty")
  if (password.length < 8) throw new AuthRequestError(400, "WEAK_PASSWORD", "Password must be at least 8 characters")

  return withLock(usersFile(engineRoot), async () => {
    const store = await readUsers(engineRoot)
    if (store.users.some((user) => user.username === normalized)) {
      throw new AuthRequestError(409, "USER_EXISTS", `A user named ${normalized} already exists`)
    }
    const user: StudioUser = {
      id: randomUUID(),
      username: normalized,
      passwordHash: await hashPassword(password),
      createdAt: new Date().toISOString(),
      plan: defaultPlan(),
    }
    await writeJsonAtomic(usersFile(engineRoot), { version: 1, users: [...store.users, user] })
    return { id: user.id, username: user.username, plan: user.plan ?? defaultPlan() }
  })
}

export async function verifyLogin(username: string, password: string, engineRoot = process.cwd()): Promise<AuthenticatedUser> {
  const normalized = username.trim().toLowerCase()
  const store = await readUsers(engineRoot)
  const user = store.users.find((candidate) => candidate.username === normalized)
  const valid = user ? await verifyPassword(password, user.passwordHash) : await verifyPassword(password, `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`)
  if (!user || !valid) throw new AuthRequestError(401, "INVALID_CREDENTIALS", "Invalid username or password")
  return { id: user.id, username: user.username, plan: user.plan ?? defaultPlan() }
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
    return { id: user.id, username: user.username, plan }
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

export async function getUserById(userId: string, engineRoot = process.cwd()): Promise<AuthenticatedUser | null> {
  const store = await readUsers(engineRoot)
  const user = store.users.find((candidate) => candidate.id === userId)
  return user ? { id: user.id, username: user.username, plan: user.plan ?? defaultPlan() } : null
}
