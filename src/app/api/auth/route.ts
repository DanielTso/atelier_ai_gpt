import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_COOKIE_NAME, AUTH_TTL_SECONDS, mintAuthToken, checkPassword, isAuthEnabled } from '@/lib/auth'
import { loginThrottle, recordLoginFailure, clearLoginFailures } from '@/lib/rateLimit'
import { apiError } from '@/lib/errors'

const schema = z.object({ password: z.string().min(1).max(200) })

const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const

// Small fixed delay on a wrong password to further slow automated guessing.
const FAILURE_DELAY_MS = 250

function clientKey(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim()
  return req.headers.get('x-real-ip')?.trim() || 'unknown'
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
