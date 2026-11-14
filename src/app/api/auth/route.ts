import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_COOKIE_NAME, AUTH_TTL_SECONDS, mintAuthToken, checkPassword, checkAuthConfig, isAuthEnabled } from '@/lib/auth'
import { reserveLoginAttempt, clearLoginAttempts } from '@/lib/rateLimit'
import { apiError } from '@/lib/errors'

const schema = z.object({ password: z.string().min(1).max(200) })

const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const

// Small fixed delay on a wrong password to further slow automated guessing.
const FAILURE_DELAY_MS = 250

// Derive the throttle key from the client IP. A proxy APPENDS the connecting client
// on the RIGHT of `x-forwarded-for` (anything the client itself sends is preserved to
// the left of it), so the RIGHTMOST entry is the trusted hop — never the leftmost,
// which is fully client-spoofable: an attacker could rotate a fresh leftmost value per
// request and never accumulate attempts against one key. `x-real-ip` is only a
// fallback: Vercel sets it, but off Vercel it may be whatever the client sent.
function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]!
  }
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  return 'unknown'
}

export async function POST(req: Request) {
  try {
    // Gate disabled → nothing to log in to.
    if (!isAuthEnabled()) return NextResponse.json({ ok: true })
    // Production without AUTH_SECRET (the proxy also answers 503 before reaching here).
    if (checkAuthConfig()) return NextResponse.json({ error: 'Service unavailable' }, { status: 503 })

    // Count the attempt synchronously, BEFORE the first await, so a parallel burst
    // cannot all pass the throttle before any of them is recorded.
    const key = clientKey(req)
    const attempt = reserveLoginAttempt(key)
    if (!attempt.allowed) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(attempt.retryAfterSec) } }
      )
    }

    const body = schema.safeParse(await req.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    if (!(await checkPassword(body.data.password))) {
      await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS))
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
    }

    clearLoginAttempts(key)
    const res = NextResponse.json({ ok: true })
    res.cookies.set(AUTH_COOKIE_NAME, await mintAuthToken(), { ...COOKIE_OPTS, maxAge: AUTH_TTL_SECONDS })
    return res
  } catch (error) {
    return apiError(error, 'Login failed', 500)
  }
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AUTH_COOKIE_NAME, '', { ...COOKIE_OPTS, maxAge: 0 })
  return res
}
