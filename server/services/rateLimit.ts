// Fixed-window request counter, keyed by caller-supplied string (e.g. an IP).
// Deliberately in-memory and per-process: this API has no shared cache, and
// a login/register brute-force window measured in minutes doesn't need one.
type Bucket = { count: number; resetAt: number }

export function createRateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const buckets = new Map<string, Bucket>()
  return function allow(key: string): boolean {
    const currentTime = now()
    const bucket = buckets.get(key)
    if (!bucket || currentTime >= bucket.resetAt) {
      buckets.set(key, { count: 1, resetAt: currentTime + windowMs })
      return true
    }
    if (bucket.count >= limit) return false
    bucket.count += 1
    return true
  }
}
