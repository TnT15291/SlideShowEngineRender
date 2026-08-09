import { ApiError } from "./api"
import type { Translate, TranslateParams } from "./i18n"
import { strings, type StringKey } from "./strings"

/**
 * A failure whose whole point is a number ("this style needs at least 18
 * photos") is useless once translation throws the number away. Any flat
 * record of primitives on `error.details` is offered to `translate` as
 * placeholder values; `translate` leaves unmatched `{name}` markers alone, so
 * strings that take no parameters are unaffected.
 */
function detailParams(details: unknown): TranslateParams | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined
  const params: TranslateParams = {}
  for (const [key, value] of Object.entries(details)) {
    if (typeof value === "string" || typeof value === "number") params[key] = value
  }
  return Object.keys(params).length ? params : undefined
}

/**
 * Turns anything thrown by the API layer into a sentence in the reader's
 * language.
 *
 * The server speaks English only, so its `message` is the fallback, not the
 * source: a recognised error `code` is translated, and an unrecognised one is
 * passed through as-is. Showing the server's precise English beats replacing
 * it with a vague translated "something went wrong" that says nothing.
 */
export function apiMessage(reason: unknown, t: Translate, fallback: StringKey = "apiError.REQUEST_FAILED"): string {
  if (reason instanceof ApiError) {
    const key = `apiError.${reason.code}`
    if (key in strings) return t(key as StringKey, detailParams(reason.details))
  }
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === "string" && reason) return reason
  return t(fallback)
}
