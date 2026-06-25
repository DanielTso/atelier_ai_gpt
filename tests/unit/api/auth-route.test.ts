import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AUTH_COOKIE_NAME, mintAuthToken, checkPassword, isAuthEnabled, verifyAuthCookie } from '@/lib/auth'
import { _resetLoginThrottle, LOGIN_MAX_FAILURES } from '@/lib/rateLimit'
import { POST, DELETE } from '@/app/api/auth/route'

const ORIG = { pw: process.env.APP_ACCESS_PASSWORD, secret: process.env.AUTH_SECRET }

function req(body: unknown, headers: Record<string, string> = {}) {
  return new Request('http://localhost/api/auth', {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.APP_ACCESS_PASSWORD = 'hunter2'
  process.env.AUTH_SECRET = 'test-secret'
  _resetLoginThrottle()
})
afterEach(() => {
  if (ORIG.pw === undefined) delete process.env.APP_ACCESS_PASSWORD; else process.env.APP_ACCESS_PASSWORD = ORIG.pw
  if (ORIG.secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = ORIG.secret
})

describe('lib/auth', () => {
  it('isAuthEnabled tracks APP_ACCESS_PASSWORD', () => {
    expect(isAuthEnabled()).toBe(true)
    delete process.env.APP_ACCESS_PASSWORD
    expect(isAuthEnabled()).toBe(false)
  })

  it('checkPassword is exact', async () => {
    expect(await checkPassword('hunter2')).toBe(true)
    expect(await checkPassword('wrong')).toBe(false)
    expect(await checkPassword('hunter2 ')).toBe(false)
  })

  it('mintAuthToken round-trips through verifyAuthCookie', async () => {
    const token = await mintAuthToken()
    expect(await verifyAuthCookie(token)).toBe(true)
    expect(await verifyAuthCookie('tampered')).toBe(false)
    expect(await verifyAuthCookie('payload.deadbeef')).toBe(false) // bad signature
    expect(await verifyAuthCookie(undefined)).toBe(false)
  })

  it('verifyAuthCookie rejects an expired cookie', async () => {
    const expired = await mintAuthToken(-10) // exp 10s in the past
    expect(await verifyAuthCookie(expired)).toBe(false)
  })

  it('each minted cookie is unique (nonce)', async () => {
    expect(await mintAuthToken()).not.toBe(await mintAuthToken())
  })

  it('verifyAuthCookie is false when the gate is disabled', async () => {
    const token = await mintAuthToken()
    delete process.env.APP_ACCESS_PASSWORD
    expect(await verifyAuthCookie(token)).toBe(false)
  })
})

describe('POST /api/auth', () => {
  it('rejects a wrong password with 401 and no cookie', async () => {
    const res = await POST(req({ password: 'nope' }))
    expect(res.status).toBe(401)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('sets the auth cookie on the correct password', async () => {
    const res = await POST(req({ password: 'hunter2' }))
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') || ''
    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=`)
    expect(cookie.toLowerCase()).toContain('httponly')
    // the cookie value must verify
    const value = cookie.split(`${AUTH_COOKIE_NAME}=`)[1]?.split(';')[0]
    expect(await verifyAuthCookie(decodeURIComponent(value ?? ''))).toBe(true)
  })

  it('returns 400 on a malformed body', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('throttles after too many failures from the same client', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.7' }
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      const r = await POST(req({ password: 'nope' }, ip))
      expect(r.status).toBe(401)
    }
    // The next attempt — even with the CORRECT password — is blocked with 429.
    const blocked = await POST(req({ password: 'hunter2' }, ip))
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBeTruthy()
  })

  it('a successful login clears the failure counter', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.8' }
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) {
      await POST(req({ password: 'nope' }, ip))
    }
    const ok = await POST(req({ password: 'hunter2' }, ip))
    expect(ok.status).toBe(200)
    // Counter reset → a subsequent wrong password is a normal 401, not a 429.
    const after = await POST(req({ password: 'nope' }, ip))
    expect(after.status).toBe(401)
  })

  it('is a no-op when the gate is disabled', async () => {
    delete process.env.APP_ACCESS_PASSWORD
    const res = await POST(req({ password: 'whatever' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('DELETE clears the cookie', async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') || ''
    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=`)
    expect(cookie.toLowerCase()).toMatch(/max-age=0/)
  })
})
