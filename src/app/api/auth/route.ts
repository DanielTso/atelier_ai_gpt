import { NextResponse } from 'next/server'
import { z } from 'zod'
import { AUTH_COOKIE_NAME, authToken, checkPassword, isAuthEnabled } from '@/lib/auth'
import { apiError } from '@/lib/errors'

const schema = z.object({ password: z.string().min(1).max(200) })

const COOKIE_OPTS = { httpOnly: true, secure: true, sameSite: 'lax', path: '/' } as const

export async function POST(req: Request) {
  try {
    // Gate disabled → nothing to log in to.
    if (!isAuthEnabled()) return NextResponse.json({ ok: true })

    const body = schema.safeParse(await req.json().catch(() => null))
    if (!body.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    if (!checkPassword(body.data.password)) {
      return NextResponse.json({ error: 'Incorrect password' }, { status: 401 })
    }

    const res = NextResponse.json({ ok: true })
    res.cookies.set(AUTH_COOKIE_NAME, await authToken(), { ...COOKIE_OPTS, maxAge: 60 * 60 * 24 * 30 })
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
