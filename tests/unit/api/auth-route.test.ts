import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  AUTH_COOKIE_NAME, mintAuthToken, checkPassword, isAuthEnabled, verifyAuthCookie,
  signFilePath, verifyFilePathSig, authConfigError,
} from '@/lib/auth'
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

  it('signFilePath never falls back to the password when AUTH_SECRET is unset', async () => {
    delete process.env.AUTH_SECRET
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const path = 'attachments/7/generated/a-b.png'
      // HMAC-SHA256(password, 'file:' + path): the offline-cracking oracle S6 describes.
      const key = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode('hunter2'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      )
      const raw = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`file:${path}`))
      const passwordSig = Array.from(new Uint8Array(raw), (b) => b.toString(16).padStart(2, '0')).join('')

      const sig = await signFilePath(path)
      expect(sig).toBe('')
      expect(sig).not.toBe(passwordSig)
      // Fail closed: with no AUTH_SECRET, even the password-derived signature is refused.
      expect(await verifyFilePathSig(path, passwordSig)).toBe(false)
    } finally {
      warnSpy.mockRestore()
    }
  })

  it('authConfigError names AUTH_SECRET only in production with the gate on and no secret', () => {
    expect(authConfigError()).toBeNull()
    delete process.env.AUTH_SECRET
    expect(authConfigError()).toBeNull() // NODE_ENV is 'test'
    vi.stubEnv('NODE_ENV', 'production')
    try {
      const msg = authConfigError()
      expect(msg).toContain('AUTH_SECRET')
      expect(msg).not.toContain('hunter2')
      delete process.env.APP_ACCESS_PASSWORD
      expect(authConfigError()).toBeNull() // gate off → nothing to misconfigure
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

describe('POST /api/auth — parallel burst', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/auth')
    vi.resetModules()
  })

  it('evaluates at most LOGIN_MAX_FAILURES guesses from one IP when 50 arrive at once', async () => {
    vi.resetModules()
    const checkSpy = vi.fn()
    vi.doMock('@/lib/auth', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/lib/auth')>()
      checkSpy.mockImplementation(actual.checkPassword)
      return { ...actual, checkPassword: checkSpy }
    })
    const { POST: burstPOST } = await import('@/app/api/auth/route')
    const ip = { 'x-forwarded-for': '203.0.113.99' }

    const results = await Promise.all(
      Array.from({ length: 50 }, () => burstPOST(req({ password: 'nope' }, ip))),
    )
    const statuses = results.map((r) => r.status)

    expect(checkSpy.mock.calls.length).toBeLessThanOrEqual(LOGIN_MAX_FAILURES)
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(LOGIN_MAX_FAILURES)
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(50 - LOGIN_MAX_FAILURES)
    expect(statuses.every((s) => s === 401 || s === 429)).toBe(true)
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

  it('prefers the rightmost X-Forwarded-For hop over a rotated x-real-ip', async () => {
    // Off Vercel, x-real-ip may be whatever the client sent. The proxy-appended
    // rightmost X-Forwarded-For hop is the trusted value, so rotating x-real-ip must
    // not mint a fresh throttle key.
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      const r = await POST(req({ password: 'nope' }, { 'x-real-ip': `10.0.0.${i}`, 'x-forwarded-for': '198.51.100.5' }))
      expect(r.status).toBe(401)
    }
    const blocked = await POST(req({ password: 'hunter2' }, { 'x-real-ip': '10.0.0.250', 'x-forwarded-for': '198.51.100.5' }))
    expect(blocked.status).toBe(429)
  })

  it('falls back to x-real-ip when there is no X-Forwarded-For', async () => {
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      const r = await POST(req({ password: 'nope' }, { 'x-real-ip': '198.51.100.9' }))
      expect(r.status).toBe(401)
    }
    const blocked = await POST(req({ password: 'hunter2' }, { 'x-real-ip': '198.51.100.9' }))
    expect(blocked.status).toBe(429)
  })

  it('keys on the rightmost (proxy-appended) X-Forwarded-For entry, not the spoofable leftmost', async () => {
    // No x-real-ip; the real client is the RIGHTMOST entry the proxy appends. A
    // rotating client-controlled leftmost must NOT mint a fresh throttle key.
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      const r = await POST(req({ password: 'nope' }, { 'x-forwarded-for': `${i}.${i}.${i}.${i}, 203.0.113.50` }))
      expect(r.status).toBe(401)
    }
    const blocked = await POST(req({ password: 'hunter2' }, { 'x-forwarded-for': '9.9.9.9, 203.0.113.50' }))
    expect(blocked.status).toBe(429)
  })

  it('is a no-op when the gate is disabled', async () => {
    delete process.env.APP_ACCESS_PASSWORD
    const res = await POST(req({ password: 'whatever' }))
    expect(res.status).toBe(200)
    expect(res.headers.get('set-cookie')).toBeNull()
  })

  it('refuses to log in (503) in production when AUTH_SECRET is unset', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.AUTH_SECRET
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const res = await POST(req({ password: 'hunter2' }))
      expect(res.status).toBe(503)
      expect(res.headers.get('set-cookie')).toBeNull()
    } finally {
      errSpy.mockRestore()
      vi.unstubAllEnvs()
    }
  })

  it('DELETE clears the cookie', async () => {
    const res = await DELETE()
    expect(res.status).toBe(200)
    const cookie = res.headers.get('set-cookie') || ''
    expect(cookie).toContain(`${AUTH_COOKIE_NAME}=`)
    expect(cookie.toLowerCase()).toMatch(/max-age=0/)
  })
})
