// Best-effort in-memory login throttle for the single shared-password gate.
//
// State lives in the serverless function instance's memory. Vercel Fluid Compute reuses
// instances across requests, so this throttles brute-force effectively in practice, but
// it is NOT shared across instances — for a hard guarantee add a Vercel WAF rate-limit
// rule on /api/auth or back this with a KV store. It exists to slow online guessing of
// the access password, not to be a distributed limiter.

export const LOGIN_MAX_FAILURES = 10
export const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

type FailureRecord = { count: number; resetAt: number }
const failures = new Map<string, FailureRecord>()

// Bound memory: drop expired records when the map grows. Cheap and only runs on writes.
function pruneExpired(now: number) {
  if (failures.size < 1000) return
  for (const [key, rec] of failures) {
    if (now >= rec.resetAt) failures.delete(key)
  }
}

/** Is this key currently blocked (too many recent failures in the window)? Does not mutate. */
export function loginThrottle(
  key: string,
  now: number = Date.now()
): { blocked: boolean; retryAfterSeconds: number } {
  const rec = failures.get(key)
  if (rec && now < rec.resetAt && rec.count >= LOGIN_MAX_FAILURES) {
    return { blocked: true, retryAfterSeconds: Math.ceil((rec.resetAt - now) / 1000) }
  }
  return { blocked: false, retryAfterSeconds: 0 }
}

/** Record a failed login for this key, opening (or extending) its window. */
export function recordLoginFailure(key: string, now: number = Date.now()): void {
  pruneExpired(now)
  const rec = failures.get(key)
  if (!rec || now >= rec.resetAt) {
    failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return
  }
  rec.count += 1
}

/** Clear failures for this key (call on a successful login). */
export function clearLoginFailures(key: string): void {
  failures.delete(key)
}

/** Test-only: reset all state. */
export function _resetLoginThrottle(): void {
  failures.clear()
}
