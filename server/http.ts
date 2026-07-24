import type { IncomingMessage, ServerResponse } from "node:http"

import { z, type ZodType } from "zod"

export const DEFAULT_JSON_LIMIT = 1024 * 1024

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
  }
}

export function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" })
  response.end(JSON.stringify(body))
}

export function sendError(response: ServerResponse, status: number, code: string, message: string, details?: unknown) {
  sendJson(response, status, {
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  })
}

// Exact bytes, no content-type check and no JSON parsing — required for
// signature-verified webhooks (e.g. Stripe), where re-serializing the body
// would change its bytes and invalidate the HMAC signature.
export async function readRawBody(request: IncomingMessage, maxBytes = DEFAULT_JSON_LIMIT): Promise<Buffer> {
  const contentLength = z.coerce.number().int().nonnegative().safeParse(request.headers["content-length"])
  if (contentLength.success && contentLength.data > maxBytes) {
    throw new HttpError(413, "BODY_TOO_LARGE", `Request body exceeds the ${maxBytes}-byte limit`)
  }

  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new HttpError(413, "BODY_TOO_LARGE", `Request body exceeds the ${maxBytes}-byte limit`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

export async function readJsonBody<T>(request: IncomingMessage, schema: ZodType<T>, maxBytes = DEFAULT_JSON_LIMIT): Promise<T> {
  const contentType = request.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase()
  if (contentType !== "application/json") {
    throw new HttpError(415, "UNSUPPORTED_MEDIA_TYPE", "Content-Type must be application/json")
  }

  const raw = await readRawBody(request, maxBytes)

  let value: unknown
  try {
    value = JSON.parse(raw.toString("utf8"))
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Request body is not valid JSON")
  }

  const result = schema.safeParse(value)
  if (!result.success) {
    throw new HttpError(400, "VALIDATION_ERROR", "Request body failed validation", result.error.issues)
  }
  return result.data
}
