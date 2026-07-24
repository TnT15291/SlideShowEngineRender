import Stripe from "stripe"

import {
  activateSubscription, cancelSubscription, getStripeCustomerId, grantPerVideoCredits,
  linkStripeCustomer, resetSubscriptionPeriod,
} from "./auth.js"

export class BillingRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

// Amounts/quota live in env, not hardcoded, so the actual price can change
// without a code deploy — no real numbers were decided when this was built.
const PLAN_CATALOG = {
  subscription: {
    name: "StoReel subscription",
    unitAmountCents: Number(process.env.STRIPE_SUBSCRIPTION_PRICE_CENTS) || 2900,
    monthlyRenderQuota: Number(process.env.STRIPE_SUBSCRIPTION_QUOTA) || 10,
  },
  per_video: {
    name: "StoReel one video",
    unitAmountCents: Number(process.env.STRIPE_PER_VIDEO_PRICE_CENTS) || 1500,
    credits: 1,
  },
} as const

export type PlanId = keyof typeof PLAN_CATALOG

function currency(): string {
  return (process.env.STRIPE_CURRENCY || "usd").toLowerCase()
}

// Public-safe pricing for the frontend to render before checkout — doesn't
// need a Stripe client, so it works even before STRIPE_SECRET_KEY is set.
export function getPlanCatalog() {
  return {
    subscription: { name: PLAN_CATALOG.subscription.name, unitAmountCents: PLAN_CATALOG.subscription.unitAmountCents, monthlyRenderQuota: PLAN_CATALOG.subscription.monthlyRenderQuota, currency: currency() },
    per_video: { name: PLAN_CATALOG.per_video.name, unitAmountCents: PLAN_CATALOG.per_video.unitAmountCents, credits: PLAN_CATALOG.per_video.credits, currency: currency() },
  }
}

// Narrowed to only what this file calls, so tests can inject a plain object
// literal instead of satisfying (or heavily mocking) the full Stripe SDK type.
export interface BillingStripeClient {
  customers: { create: (params: Stripe.CustomerCreateParams) => Promise<{ id: string }> }
  checkout: { sessions: { create: (params: Stripe.Checkout.SessionCreateParams) => Promise<{ url: string | null }> } }
  webhooks: { constructEvent: (payload: Buffer, signature: string, secret: string) => Stripe.Event }
}

let cachedClient: Stripe | null = null
function client(): BillingStripeClient {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new BillingRequestError(409, "STRIPE_NOT_CONFIGURED", "Stripe is not configured on this server")
  if (!cachedClient) cachedClient = new Stripe(key)
  return cachedClient
}

export type CreateCheckoutInput = {
  userId: string
  username: string
  plan: PlanId
  successUrl: string
  cancelUrl: string
}

export async function createCheckoutSession(input: CreateCheckoutInput, engineRoot = process.cwd(), stripe: BillingStripeClient = client()): Promise<{ url: string }> {
  const catalogEntry = PLAN_CATALOG[input.plan]
  if (!catalogEntry) throw new BillingRequestError(400, "UNKNOWN_PLAN", `Unknown plan: ${input.plan}`)

  let customerId = await getStripeCustomerId(input.userId, engineRoot)
  if (!customerId) {
    const customer = await stripe.customers.create({ name: input.username, metadata: { userId: input.userId } })
    await linkStripeCustomer(input.userId, customer.id, engineRoot)
    customerId = customer.id
  }

  const session = await stripe.checkout.sessions.create({
    mode: input.plan === "subscription" ? "subscription" : "payment",
    customer: customerId,
    client_reference_id: input.userId,
    metadata: { userId: input.userId, plan: input.plan },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: currency(),
        unit_amount: catalogEntry.unitAmountCents,
        product_data: { name: catalogEntry.name },
        ...(input.plan === "subscription" ? { recurring: { interval: "month" as const } } : {}),
      },
    }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
  })

  if (!session.url) throw new BillingRequestError(500, "CHECKOUT_SESSION_FAILED", "Stripe did not return a checkout URL")
  return { url: session.url }
}

function customerIdOf(value: string | Stripe.Customer | Stripe.DeletedCustomer | null): string | null {
  if (!value) return null
  return typeof value === "string" ? value : value.id
}

// Called from the /api/billing/webhook route with the exact raw request
// bytes (never JSON-parsed) and the `stripe-signature` header — signature
// verification requires byte-for-byte fidelity with what Stripe sent.
export async function handleWebhookEvent(rawBody: Buffer, signature: string, engineRoot = process.cwd(), stripe: BillingStripeClient = client()): Promise<void> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new BillingRequestError(409, "STRIPE_NOT_CONFIGURED", "Stripe webhook secret is not configured")

  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, secret)
  } catch (error) {
    throw new BillingRequestError(400, "INVALID_SIGNATURE", error instanceof Error ? error.message : "Invalid webhook signature")
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session
      const customerId = customerIdOf(session.customer)
      if (!customerId) break
      if (session.metadata?.plan === "subscription") {
        const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id
        if (subscriptionId) {
          await activateSubscription(customerId, { stripeSubscriptionId: subscriptionId, monthlyRenderQuota: PLAN_CATALOG.subscription.monthlyRenderQuota }, engineRoot)
        }
      } else if (session.metadata?.plan === "per_video") {
        await grantPerVideoCredits(customerId, PLAN_CATALOG.per_video.credits, engineRoot)
      }
      break
    }
    // Fires on every successful renewal charge (and the first invoice right
    // after checkout) — the real billing-period boundary for a subscription.
    case "invoice.paid": {
      const customerId = customerIdOf((event.data.object as Stripe.Invoice).customer)
      if (customerId) await resetSubscriptionPeriod(customerId, engineRoot)
      break
    }
    case "customer.subscription.deleted": {
      const customerId = customerIdOf((event.data.object as Stripe.Subscription).customer)
      if (customerId) await cancelSubscription(customerId, engineRoot)
      break
    }
    default:
      break
  }
}
