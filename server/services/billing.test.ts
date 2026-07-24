import assert from "node:assert/strict"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import type Stripe from "stripe"

import { createUser, getUserById } from "./auth.js"
import { BillingRequestError, createCheckoutSession, getPlanCatalog, handleWebhookEvent, type BillingStripeClient } from "./billing.js"

async function tempRoot(context: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-billing-"))
  context.after(() => rm(root, { recursive: true, force: true }))
  return root
}

function fakeStripe(overrides: Partial<BillingStripeClient> = {}): BillingStripeClient {
  let customerCounter = 0
  return {
    customers: { create: async () => ({ id: `cus_fake_${++customerCounter}` }) },
    checkout: { sessions: { create: async () => ({ url: "https://checkout.stripe.com/fake-session" }) } },
    webhooks: { constructEvent: () => { throw new Error("constructEvent not stubbed for this test") } },
    ...overrides,
  }
}

function fakeEvent(type: string, object: unknown): Stripe.Event {
  return { type, data: { object } } as unknown as Stripe.Event
}

test("getPlanCatalog falls back to documented placeholder prices when env is unset", () => {
  // PLAN_CATALOG is computed once at module load from process.env, not
  // re-read per call — this only exercises the fallback branch (no
  // STRIPE_SUBSCRIPTION_PRICE_CENTS etc. is set for this test process).
  // Overriding real amounts is a startup-time (env) concern, not something
  // a single process can re-exercise after the module has already loaded.
  const catalog = getPlanCatalog()
  assert.equal(catalog.subscription.unitAmountCents, 2900)
  assert.equal(catalog.subscription.monthlyRenderQuota, 10)
  assert.equal(catalog.per_video.unitAmountCents, 1500)
  assert.equal(catalog.per_video.credits, 1)
  assert.equal(catalog.subscription.currency, "usd")
})

test("createCheckoutSession creates and links a Stripe customer once, then reuses it", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("iris", "correct-secret", root)

  const sessionCalls: Stripe.Checkout.SessionCreateParams[] = []
  let customerCreateCalls = 0
  const stripe = fakeStripe({
    customers: { create: async () => { customerCreateCalls += 1; return { id: "cus_iris" } } },
    checkout: { sessions: { create: async (params) => { sessionCalls.push(params); return { url: "https://checkout.stripe.com/session1" } } } },
  })

  const first = await createCheckoutSession({ userId: user.id, username: user.username, plan: "per_video", successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" }, root, stripe)
  assert.equal(first.url, "https://checkout.stripe.com/session1")
  assert.equal(customerCreateCalls, 1)
  assert.equal(sessionCalls[0].mode, "payment")
  assert.equal(sessionCalls[0].customer, "cus_iris")
  assert.equal(sessionCalls[0].client_reference_id, user.id)
  assert.equal(sessionCalls[0].metadata?.plan, "per_video")
  assert.equal(sessionCalls[0].line_items?.[0].price_data?.unit_amount, 1500)
  assert.equal((sessionCalls[0].line_items?.[0].price_data as { recurring?: unknown }).recurring, undefined)

  await createCheckoutSession({ userId: user.id, username: user.username, plan: "subscription", successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" }, root, stripe)
  assert.equal(customerCreateCalls, 1, "the second checkout must reuse the already-linked Stripe customer")
  assert.equal(sessionCalls[1].mode, "subscription")
  assert.deepEqual((sessionCalls[1].line_items?.[0].price_data as { recurring?: { interval?: string } }).recurring, { interval: "month" })
})

test("createCheckoutSession surfaces a clear error when Stripe returns no url", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("jack", "correct-secret", root)
  const stripe = fakeStripe({ checkout: { sessions: { create: async () => ({ url: null }) } } })
  await assert.rejects(
    createCheckoutSession({ userId: user.id, username: user.username, plan: "per_video", successUrl: "https://app.test/success", cancelUrl: "https://app.test/cancel" }, root, stripe),
    (error: unknown) => error instanceof BillingRequestError && error.code === "CHECKOUT_SESSION_FAILED",
  )
})

test("webhook: checkout.session.completed activates a subscription and grants per-video credits", async (context) => {
  const root = await tempRoot(context)
  const subscriber = await createUser("kim", "correct-secret", root)
  const buyer = await createUser("liam", "correct-secret", root)

  // Link both users to Stripe customers the way createCheckoutSession would.
  const stripeForSetup = fakeStripe({ customers: { create: async () => ({ id: "cus_subscriber" } as { id: string }) } })
  await createCheckoutSession({ userId: subscriber.id, username: subscriber.username, plan: "subscription", successUrl: "https://app.test/s", cancelUrl: "https://app.test/c" }, root, stripeForSetup)
  const stripeForSetup2 = fakeStripe({ customers: { create: async () => ({ id: "cus_buyer" }) } })
  await createCheckoutSession({ userId: buyer.id, username: buyer.username, plan: "per_video", successUrl: "https://app.test/s", cancelUrl: "https://app.test/c" }, root, stripeForSetup2)

  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  try {
    const subscriptionEvent = fakeEvent("checkout.session.completed", { customer: "cus_subscriber", subscription: "sub_123", metadata: { plan: "subscription" } })
    await handleWebhookEvent(Buffer.from("{}"), "sig", root, fakeStripe({ webhooks: { constructEvent: () => subscriptionEvent } }))
    const subscriberAfter = await getUserById(subscriber.id, root)
    assert.equal(subscriberAfter?.plan.type, "subscription")
    assert.equal(subscriberAfter?.plan.type === "subscription" && subscriberAfter.plan.monthlyRenderQuota, 10)

    const videoEvent = fakeEvent("checkout.session.completed", { customer: "cus_buyer", metadata: { plan: "per_video" } })
    await handleWebhookEvent(Buffer.from("{}"), "sig", root, fakeStripe({ webhooks: { constructEvent: () => videoEvent } }))
    const buyerAfter = await getUserById(buyer.id, root)
    assert.equal(buyerAfter?.plan.type, "per_video")
    assert.equal(buyerAfter?.plan.type === "per_video" && buyerAfter.plan.creditsRemaining, 1)

    // Buying a second video adds to the existing balance instead of overwriting it.
    await handleWebhookEvent(Buffer.from("{}"), "sig", root, fakeStripe({ webhooks: { constructEvent: () => videoEvent } }))
    const buyerAfterSecond = await getUserById(buyer.id, root)
    assert.equal(buyerAfterSecond?.plan.type === "per_video" && buyerAfterSecond.plan.creditsRemaining, 2)
  } finally {
    delete process.env.STRIPE_WEBHOOK_SECRET
  }
})

test("webhook: invoice.paid resets the billing period only for an active subscription", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("morgan", "correct-secret", root)
  const setup = fakeStripe({ customers: { create: async () => ({ id: "cus_morgan" }) } })
  await createCheckoutSession({ userId: user.id, username: user.username, plan: "subscription", successUrl: "https://app.test/s", cancelUrl: "https://app.test/c" }, root, setup)

  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  try {
    const activate = fakeEvent("checkout.session.completed", { customer: "cus_morgan", subscription: "sub_1", metadata: { plan: "subscription" } })
    await handleWebhookEvent(Buffer.from("{}"), "sig", root, fakeStripe({ webhooks: { constructEvent: () => activate } }))

    const store = JSON.parse(await readFile(path.join(root, "server", "data", "studio-users.json"), "utf8"))
    const before = store.users.find((candidate: { id: string }) => candidate.id === user.id)
    assert.equal(before.plan.rendersUsedThisPeriod, 0)

    const invoiceEvent = fakeEvent("invoice.paid", { customer: "cus_morgan" })
    await handleWebhookEvent(Buffer.from("{}"), "sig", root, fakeStripe({ webhooks: { constructEvent: () => invoiceEvent } }))
    const after = await getUserById(user.id, root)
    assert.equal(after?.plan.type === "subscription" && after.plan.rendersUsedThisPeriod, 0)

    // An unknown Stripe customer id must not throw — webhooks must stay resilient to stale events.
    const orphanInvoice = fakeEvent("invoice.paid", { customer: "cus_does_not_exist" })
    await handleWebhookEvent(Buffer.from("{}"), "sig", root, fakeStripe({ webhooks: { constructEvent: () => orphanInvoice } }))
  } finally {
    delete process.env.STRIPE_WEBHOOK_SECRET
  }
})

test("webhook: customer.subscription.deleted reverts the account to the zero-entitlement default", async (context) => {
  const root = await tempRoot(context)
  const user = await createUser("nadia", "correct-secret", root)
  const setup = fakeStripe({ customers: { create: async () => ({ id: "cus_nadia" }) } })
  await createCheckoutSession({ userId: user.id, username: user.username, plan: "subscription", successUrl: "https://app.test/s", cancelUrl: "https://app.test/c" }, root, setup)

  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  try {
    const activate = fakeEvent("checkout.session.completed", { customer: "cus_nadia", subscription: "sub_1", metadata: { plan: "subscription" } })
    await handleWebhookEvent(Buffer.from("{}"), "sig", root, fakeStripe({ webhooks: { constructEvent: () => activate } }))
    assert.equal((await getUserById(user.id, root))?.plan.type, "subscription")

    const cancelEvent = fakeEvent("customer.subscription.deleted", { customer: "cus_nadia" })
    await handleWebhookEvent(Buffer.from("{}"), "sig", root, fakeStripe({ webhooks: { constructEvent: () => cancelEvent } }))
    const after = await getUserById(user.id, root)
    assert.equal(after?.plan.type, "per_video")
    assert.equal(after?.plan.type === "per_video" && after.plan.creditsRemaining, 0)
  } finally {
    delete process.env.STRIPE_WEBHOOK_SECRET
  }
})

test("webhook rejects an unverifiable signature and a missing webhook secret", async (context) => {
  const root = await tempRoot(context)
  await assert.rejects(
    handleWebhookEvent(Buffer.from("{}"), "sig", root, fakeStripe({ webhooks: { constructEvent: () => { throw new Error("bad signature") } } })),
    (error: unknown) => error instanceof BillingRequestError && error.code === "STRIPE_NOT_CONFIGURED",
  )

  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test"
  try {
    await assert.rejects(
      handleWebhookEvent(Buffer.from("{}"), "sig", root, fakeStripe({ webhooks: { constructEvent: () => { throw new Error("bad signature") } } })),
      (error: unknown) => error instanceof BillingRequestError && error.code === "INVALID_SIGNATURE",
    )
  } finally {
    delete process.env.STRIPE_WEBHOOK_SECRET
  }
})
