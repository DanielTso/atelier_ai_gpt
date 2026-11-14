// Best-effort in-memory login throttle for the single shared-password gate.
//
// State lives in the serverless function instance's memory. Vercel Fluid Compute reuses
// instances across requests, so this throttles brute-force effectively in practice, but
// it is NOT shared across instances — for a hard guarantee add a Vercel WAF rate-limit
// rule on POST /api/auth or back this with a KV store. It exists to slow online guessing
// of the access password, not to be a distributed limiter.
//
// Attempts are RESERVED (counted) synchronously on entry, before the route awaits
// anything, and cleared on a successful login. A check-now/record-later pair let a
// parallel burst through: every request passed the check before any had recorded a
// failure, so all of them were evaluated against the real password.

/** Attempts allowed per key per window (a successful login clears the count). */
export const LOGIN_MAX_ATTEMPTS = 10
/** @deprecated Old name from when only failures were counted; use LOGIN_MAX_ATTEMPTS. */
export const LOGIN_MAX_FAILURES = LOGIN_MAX_ATTEMPTS
export const LOGIN_WINDOW_MS = 15 * 60 * 1000 // 15 minutes

type AttemptRecord = { count: number; resetAt: number }
const attempts = new Map<string, AttemptRecord>()

// Bound memory: drop expired records when the map grows. Cheap and only runs on writes.
function pruneExpired(now: number) {
  if (attempts.size < 1000) return
  for (const [key, rec] of attempts) {
    if (now >= rec.resetAt) attempts.delete(key)
  }
}

/**
 * Reserve one login attempt for this key. Synchronous on purpose: call it BEFORE the
 * first await so concurrent requests see each other's reservations. Returns
 * `allowed: false` (and how long until the window resets) once the key has used
 * LOGIN_MAX_ATTEMPTS attempts in the current window; a blocked call is not counted.
 */
export function reserveLoginAttempt(
  key: string,
  now: number = Date.now()
): { allowed: boolean; retryAfterSec: number } {
  pruneExpired(now)
  const rec = attempts.get(key)
  if (!rec || now >= rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return { allowed: true, retryAfterSec: 0 }
  }
  if (rec.count >= LOGIN_MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSec: Math.ceil((rec.resetAt - now) / 1000) }
  }
  rec.count += 1
  return { allowed: true, retryAfterSec: 0 }
}

/** Clear this key's attempts (call on a successful login). */
export function clearLoginAttempts(key: string): void {
  attempts.delete(key)
}

/** Test-only: reset all state. */
export function _resetLoginThrottle(): void {
  attempts.clear()
}
