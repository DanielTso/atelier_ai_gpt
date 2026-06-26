import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_COOKIE_NAME, AUTH_TTL_SECONDS, mintAuthToken, checkPassword, isAuthEnabled } from '@/lib/auth'
import { loginThrottle, recordLoginFailure, clearLoginFailures } from '@/lib/rateLimit'
import { apiError } from '@/lib/errors'

const schema = z.object({ password: z.string().min(1).max(200) })

const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const

// Small fixed delay on a wrong password to further slow automated guessing.
const FAILURE_DELAY_MS = 250

// Derive the throttle key from the client IP. On Vercel, `x-real-ip` is set to the
// true connecting IP, and `x-forwarded-for` has the real client appended on the
// RIGHT (anything the client itself sends is preserved to the left of it). So we
// trust `x-real-ip` first and otherwise take the RIGHTMOST forwarded entry — never
// the leftmost, which is fully client-spoofable: an attacker could rotate a fresh
// leftmost X-Forwarded-For per request and never accumulate failures against one
// key, defeating the per-key brute-force throttle entirely. Off-Vercel deployments
// must front this with a proxy that sets x-real-ip / overwrites x-forwarded-for.
function clientKey(req: Request): string {
  const realIp = req.headers.get('x-real-ip')?.trim()
  if (realIp) return realIp
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) {
    const parts = fwd.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]!
  }
  return 'unknown'
}

export async function POST(req: Request) {
  try {
    // Gate disabled → nothing to log in to.
    if (!isAuthEnabled()) return NextResponse.json({ ok: true })

    const key = clientKey(req)
    const throttle = loginThrottle(key)
    if (throttle.blocked) {
      return NextResponse.json(
        { error: 'Too many attempts. Try again later.' },
        { status: 429, headers: { 'Retry-After': String(throttle.retryAfterSeconds) } }
      )
    }

    const body = schema.safeParse(await req.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    if (!(await checkPassword(body.data.password))) {
      recordLoginFailure(key)
      await new Promise((r) => setTimeout(r, FAILURE_DELAY_MS))
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
    }

    clearLoginFailures(key)
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
