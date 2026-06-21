import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AUTH_COOKIE_NAME, authToken, checkPassword, isAuthEnabled, verifyAuthCookie } from '@/lib/auth'
import { POST, DELETE } from '@/app/api/auth/route'

const ORIG = { pw: process.env.APP_ACCESS_PASSWORD, secret: process.env.AUTH_SECRET }

function req(body: unknown) {
  return new Request('http://localhost/api/auth', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
}

beforeEach(() => {
  process.env.APP_ACCESS_PASSWORD = 'hunter2'
  process.env.AUTH_SECRET = 'test-secret'
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

  it('checkPassword is exact', () => {
    expect(checkPassword('hunter2')).toBe(true)
    expect(checkPassword('wrong')).toBe(false)
    expect(checkPassword('hunter2 ')).toBe(false)
  })

  it('authToken round-trips through verifyAuthCookie', async () => {
    const token = await authToken()
    expect(await verifyAuthCookie(token)).toBe(true)
    expect(await verifyAuthCookie('tampered')).toBe(false)
    expect(await verifyAuthCookie(undefined)).toBe(false)
  })

  it('verifyAuthCookie is false when the gate is disabled', async () => {
    const token = await authToken()
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
