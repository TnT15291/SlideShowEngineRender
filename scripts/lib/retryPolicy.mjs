// The retry policy both API clients share.
//
// It lives here because it was copy-pasted, and the copy drifted into a bug: each
// client wrote `throw lastErr` inside its own `try` to mean "client error, stop",
// where the surrounding `catch` swallowed it and ran the loop again. A bad key
// cost three identical requests instead of one. Two copies, one bug, fixed twice.
// So the rule now has one home.

export const MAX_ATTEMPTS = 3;
export const RETRY_BASE_MS = 500;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * True when the same request, sent again, could plausibly succeed.
 *
 * 429 (rate limited) and 5xx (server) are worth another attempt. Every other 4xx
 * says WE built the request wrong — bad key, unsupported param, malformed body.
 * Re-sending it byte-for-byte buys the identical failure, three times the latency,
 * and three entries in the provider's error log.
 */
export function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}
