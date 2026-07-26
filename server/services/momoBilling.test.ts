import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import test from "node:test"

import { createUser, getUserById } from "./auth.js"
import {
  createMomoCheckout,
  handleMomoIpn,
  MomoBillingError,
  type MomoHttpClient,
} from "./momoBilling.js"

const MOMO_ENV = {
  MOMO_PARTNER_CODE: "MOMO_TEST",
  MOMO_ACCESS_KEY: "access_test",
  MOMO_SECRET_KEY: "secret_test",
  MOMO_IPN_URL: "https://merchant.test/api/billing/momo/ipn",
  MOMO_ENDPOINT: "https://test-payment.momo.vn/v2/gateway/api/create",
  MOMO_PER_VIDEO_PRICE_VND: "390000",
}

async function fixture(context: { after: (fn: () => unknown) => void }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "storeel-momo-"))
  const previous = Object.fromEntries(Object.keys(MOMO_ENV).map((key) => [key, process.env[key]]))
  Object.assign(process.env, MOMO_ENV)
  context.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
    await rm(root, { recursive: true, force: true })
  })
  return root
}

function signedIpn(createBody: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
  const payload: Record<string, unknown> = {
    partnerCode: MOMO_ENV.MOMO_PARTNER_CODE,
    orderId: createBody.orderId,
    requestId: createBody.requestId,
    amount: createBody.amount,
    orderInfo: createBody.orderInfo,
    orderType: "momo_wallet",
    transId: 4088878653,
    resultCode: 0,
    message: "Successful.",
    payType: "qr",
    responseTime: 1721720663942,
    extraData: "",
    ...overrides,
  }
  const raw =
    `accessKey=${MOMO_ENV.MOMO_ACCESS_KEY}&amount=${payload.amount}&extraData=${payload.extraData}`
    + `&message=${payload.message}&orderId=${payload.orderId}&orderInfo=${payload.orderInfo}`
    + `&orderType=${payload.orderType}&partnerCode=${payload.partnerCode}`
    + `&payType=${payload.payType}&requestId=${payload.requestId}`
    + `&responseTime=${payload.responseTime}&resultCode=${payload.resultCode}`
    + `&transId=${payload.transId}`
  payload.signature = createHmac("sha256", MOMO_ENV.MOMO_SECRET_KEY).update(raw).digest("hex")
  return Buffer.from(JSON.stringify(payload))
}

test("MoMo checkout signs AIO v2 request and a replayed IPN grants one credit", async (context) => {
  const root = await fixture(context)
  const user = await createUser("momo-buyer", "correct-secret", root)
  let createBody: Record<string, unknown> = {}
  const http: MomoHttpClient = async (url, init) => {
    assert.equal(url, MOMO_ENV.MOMO_ENDPOINT)
    createBody = JSON.parse(String(init.body)) as Record<string, unknown>
    return {
      ok: true,
      status: 200,
      json: async () => ({ resultCode: 0, payUrl: "https://test-payment.momo.vn/pay/test" }),
    }
  }

  const checkout = await createMomoCheckout({
    userId: user.id,
    username: user.username,
    redirectUrl: "https://app.test/?checkout=success",
  }, root, http)
  assert.equal(checkout.url, "https://test-payment.momo.vn/pay/test")
  assert.equal(createBody.requestType, "captureWallet")
  assert.equal(createBody.amount, 390000)
  assert.equal(createBody.ipnUrl, MOMO_ENV.MOMO_IPN_URL)
  assert.match(String(createBody.signature), /^[0-9a-f]{64}$/)

  const ipn = signedIpn(createBody)
  await handleMomoIpn(ipn, root)
  await handleMomoIpn(ipn, root)
  const after = await getUserById(user.id, root)
  assert.equal(after?.plan.type, "per_video")
  assert.equal(after?.plan.type === "per_video" && after.plan.creditsRemaining, 1)
})

test("MoMo IPN rejects invalid signatures and mismatched order amounts", async (context) => {
  const root = await fixture(context)
  const user = await createUser("momo-guard", "correct-secret", root)
  let createBody: Record<string, unknown> = {}
  await createMomoCheckout({
    userId: user.id,
    username: user.username,
    redirectUrl: "https://app.test/?checkout=success",
  }, root, async (_url, init) => {
    createBody = JSON.parse(String(init.body)) as Record<string, unknown>
    return { ok: true, status: 200, json: async () => ({ resultCode: 0, payUrl: "https://momo.test/pay" }) }
  })

  const badSignature = signedIpn(createBody)
  const decoded = JSON.parse(badSignature.toString("utf8")) as Record<string, unknown>
  decoded.signature = "0".repeat(64)
  await assert.rejects(
    handleMomoIpn(Buffer.from(JSON.stringify(decoded)), root),
    (error: unknown) => error instanceof MomoBillingError && error.code === "INVALID_MOMO_SIGNATURE",
  )

  await assert.rejects(
    handleMomoIpn(signedIpn(createBody, { amount: 391000 }), root),
    (error: unknown) => error instanceof MomoBillingError && error.code === "INVALID_MOMO_ORDER",
  )
})
