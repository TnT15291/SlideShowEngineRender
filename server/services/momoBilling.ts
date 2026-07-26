import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

import { z } from "zod"

import { grantPerVideoCreditsToUser } from "./auth.js"
import { writeJsonAtomic } from "./atomicFile.js"
import { withLock } from "./fileLock.js"

export class MomoBillingError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

const momoOrderSchema = z.object({
  orderId: z.string(),
  requestId: z.string(),
  userId: z.string(),
  amount: z.number().int().positive(),
  credits: z.number().int().positive(),
  status: z.enum(["pending", "paid"]),
  createdAt: z.string(),
  paidAt: z.string().optional(),
  transId: z.string().optional(),
})
const momoStoreSchema = z.object({
  version: z.literal(1),
  orders: z.array(momoOrderSchema),
})
type MomoOrder = z.infer<typeof momoOrderSchema>

type MomoCreateResponse = {
  resultCode?: number
  message?: string
  payUrl?: string
}

export type MomoHttpClient = (
  input: string,
  init: RequestInit,
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>

function ordersFile(engineRoot: string) {
  return path.join(engineRoot, "server", "data", "momo-orders.json")
}

async function readOrders(engineRoot: string) {
  try {
    return momoStoreSchema.parse(JSON.parse(await readFile(ordersFile(engineRoot), "utf8")))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1 as const, orders: [] }
    }
    throw error
  }
}

function config() {
  const partnerCode = process.env.MOMO_PARTNER_CODE
  const accessKey = process.env.MOMO_ACCESS_KEY
  const secretKey = process.env.MOMO_SECRET_KEY
  const ipnUrl = process.env.MOMO_IPN_URL
  if (!partnerCode || !accessKey || !secretKey || !ipnUrl) {
    throw new MomoBillingError(409, "MOMO_NOT_CONFIGURED", "MoMo is not configured on this server")
  }
  return {
    partnerCode,
    accessKey,
    secretKey,
    ipnUrl,
    endpoint: process.env.MOMO_ENDPOINT || "https://test-payment.momo.vn/v2/gateway/api/create",
  }
}

export function getMomoCatalog() {
  return {
    enabled: Boolean(
      process.env.MOMO_PARTNER_CODE
      && process.env.MOMO_ACCESS_KEY
      && process.env.MOMO_SECRET_KEY
      && process.env.MOMO_IPN_URL
    ),
    perVideoAmountVnd: Number(process.env.MOMO_PER_VIDEO_PRICE_VND) || 390_000,
  }
}

function sign(raw: string, secretKey: string) {
  return createHmac("sha256", secretKey).update(raw).digest("hex")
}

function secureEqual(left: string, right: string) {
  const a = Buffer.from(left, "utf8")
  const b = Buffer.from(right, "utf8")
  return a.length === b.length && timingSafeEqual(a, b)
}

export async function createMomoCheckout(
  input: { userId: string; username: string; redirectUrl: string },
  engineRoot = process.cwd(),
  http: MomoHttpClient = fetch,
): Promise<{ url: string }> {
  const momo = config()
  const amount = getMomoCatalog().perVideoAmountVnd
  if (!Number.isInteger(amount) || amount < 1_000) {
    throw new MomoBillingError(500, "INVALID_MOMO_PRICE", "MoMo per-video price must be an integer of at least 1000 VND")
  }

  const requestId = randomUUID()
  const orderId = `storeel.${randomUUID()}`
  const orderInfo = `StoReel one video for ${input.username}`.slice(0, 200)
  const extraData = ""
  const requestType = "captureWallet"
  const rawSignature =
    `accessKey=${momo.accessKey}&amount=${amount}&extraData=${extraData}`
    + `&ipnUrl=${momo.ipnUrl}&orderId=${orderId}&orderInfo=${orderInfo}`
    + `&partnerCode=${momo.partnerCode}&redirectUrl=${input.redirectUrl}`
    + `&requestId=${requestId}&requestType=${requestType}`

  const order: MomoOrder = {
    orderId,
    requestId,
    userId: input.userId,
    amount,
    credits: 1,
    status: "pending",
    createdAt: new Date().toISOString(),
  }
  await withLock(ordersFile(engineRoot), async () => {
    const store = await readOrders(engineRoot)
    await writeJsonAtomic(ordersFile(engineRoot), { version: 1, orders: [...store.orders, order] })
  })

  let response
  try {
    response = await http(momo.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        partnerCode: momo.partnerCode,
        requestType,
        ipnUrl: momo.ipnUrl,
        redirectUrl: input.redirectUrl,
        orderId,
        amount,
        lang: "vi",
        orderInfo,
        requestId,
        extraData,
        signature: sign(rawSignature, momo.secretKey),
      }),
    })
  } catch (error) {
    throw new MomoBillingError(502, "MOMO_UNAVAILABLE", error instanceof Error ? error.message : "MoMo request failed")
  }
  const result = await response.json() as MomoCreateResponse
  if (!response.ok || result.resultCode !== 0 || !result.payUrl) {
    throw new MomoBillingError(
      502,
      "MOMO_CHECKOUT_FAILED",
      result.message || `MoMo checkout failed with HTTP ${response.status}`,
    )
  }
  return { url: result.payUrl }
}

export async function handleMomoIpn(rawBody: Buffer, engineRoot = process.cwd()): Promise<void> {
  const momo = config()
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(rawBody.toString("utf8")) as Record<string, unknown>
  } catch {
    throw new MomoBillingError(400, "INVALID_MOMO_PAYLOAD", "MoMo IPN body is not valid JSON")
  }

  const value = (key: string) => payload[key] == null ? "" : String(payload[key])
  const rawSignature =
    `accessKey=${momo.accessKey}&amount=${value("amount")}&extraData=${value("extraData")}`
    + `&message=${value("message")}&orderId=${value("orderId")}&orderInfo=${value("orderInfo")}`
    + `&orderType=${value("orderType")}&partnerCode=${value("partnerCode")}`
    + `&payType=${value("payType")}&requestId=${value("requestId")}`
    + `&responseTime=${value("responseTime")}&resultCode=${value("resultCode")}`
    + `&transId=${value("transId")}`
  const expected = sign(rawSignature, momo.secretKey)
  if (!secureEqual(value("signature"), expected)) {
    throw new MomoBillingError(400, "INVALID_MOMO_SIGNATURE", "MoMo IPN signature is invalid")
  }
  if (value("partnerCode") !== momo.partnerCode) {
    throw new MomoBillingError(400, "INVALID_MOMO_ORDER", "MoMo partner code does not match")
  }

  const store = await readOrders(engineRoot)
  const order = store.orders.find((candidate) => candidate.orderId === value("orderId"))
  if (
    !order
    || order.requestId !== value("requestId")
    || order.amount !== Number(payload.amount)
  ) {
    throw new MomoBillingError(400, "INVALID_MOMO_ORDER", "MoMo IPN does not match a pending order")
  }
  if (Number(payload.resultCode) !== 0 || order.status === "paid") return

  await grantPerVideoCreditsToUser(order.userId, order.credits, `momo:${order.orderId}`, engineRoot)
  await withLock(ordersFile(engineRoot), async () => {
    const latest = await readOrders(engineRoot)
    const orders = latest.orders.map((candidate) => candidate.orderId === order.orderId
      ? {
          ...candidate,
          status: "paid" as const,
          paidAt: new Date().toISOString(),
          transId: value("transId"),
        }
      : candidate)
    await writeJsonAtomic(ordersFile(engineRoot), { version: 1, orders })
  })
}
