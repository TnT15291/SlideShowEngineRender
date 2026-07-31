import { ApiError } from "./api"
import type { Translate } from "./i18n"
import { strings, type StringKey } from "./strings"

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
    if (key in strings) return t(key as StringKey)
  }
  if (reason instanceof Error && reason.message) return reason.message
  if (typeof reason === "string" && reason) return reason
  return t(fallback)
}
