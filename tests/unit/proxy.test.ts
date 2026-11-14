import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { proxy, config } from '@/proxy'
import { mintAuthToken, AUTH_COOKIE_NAME, _resetAuthWarnings } from '@/lib/auth'

const ORIG = { pw: process.env.APP_ACCESS_PASSWORD, secret: process.env.AUTH_SECRET }

beforeEach(() => {
  process.env.APP_ACCESS_PASSWORD = 'hunter2'
  process.env.AUTH_SECRET = 'test-secret'
})
afterEach(() => {
  if (ORIG.pw === undefined) delete process.env.APP_ACCESS_PASSWORD; else process.env.APP_ACCESS_PASSWORD = ORIG.pw
  if (ORIG.secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = ORIG.secret
})

function mkReq(path: string, cookie?: string, method = 'GET') {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = `${AUTH_COOKIE_NAME}=${cookie}`
  return new NextRequest(new URL(path, 'http://localhost'), { headers, method })
}

// Part A â€” the matcher decides which paths the gate even runs on. This locks the
// PREVIOUSLY-FIXED bypass the matcher comment documents (an earlier matcher excluded
// any path ending in an image extension, leaving such routes reachable unauthenticated).
describe('proxy matcher', () => {
  const re = new RegExp('^' + config.matcher[0]! + '$')
  const runsOn = (p: string) => re.test(p)

  it('runs the gate on app + api routes', () => {
    expect(runsOn('/')).toBe(true)
    expect(runsOn('/api/chat')).toBe(true)
    expect(runsOn('/dashboard')).toBe(true)
  })

  it('runs the gate on a route that merely ENDS in an image extension (bypass stays closed)', () => {
    expect(runsOn('/report.png')).toBe(true)
    expect(runsOn('/logo.svg')).toBe(true)
  })

  it('skips Next internals + favicon', () => {
    expect(runsOn('/_next/static/chunk-abc.js')).toBe(false)
    expect(runsOn('/_next/image')).toBe(false)
    expect(runsOn('/favicon.ico')).toBe(false)
  })
})

// Part B â€” the gate's branching: api-vs-page, public-path allowlist, enable flag.
describe('proxy gate', () => {
  it('lets a request through with a valid cookie', async () => {
    const token = await mintAuthToken()
    const res = await proxy(mkReq('/api/chat', token))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('returns 401 JSON on an /api route without a valid cookie', async () => {
    const res = await proxy(mkReq('/api/chat'))
    expect(res.status).toBe(401)
  })

  it('returns 401 on an /api route with a tampered cookie', async () => {
    const res = await proxy(mkReq('/api/chat', 'payload.deadbeef'))
    expect(res.status).toBe(401)
  })

  it('redirects a page request without a cookie to /login, preserving the destination', async () => {
    const res = await proxy(mkReq('/dashboard'))
    expect(res.status).toBe(307)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/login')
    expect(loc).toContain('next=%2Fdashboard')
  })

  it('does not append a next param for the root path', async () => {
    const res = await proxy(mkReq('/'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).not.toContain('next=')
  })

  it('lets /login and /api/auth through unauthenticated', async () => {
    expect((await proxy(mkReq('/login'))).headers.get('x-middleware-next')).toBe('1')
    expect((await proxy(mkReq('/api/auth'))).headers.get('x-middleware-next')).toBe('1')
  })

  it('lets GET and HEAD to /login through, but not an unauthenticated POST', async () => {
    expect((await proxy(mkReq('/login', undefined, 'GET'))).headers.get('x-middleware-next')).toBe('1')
    expect((await proxy(mkReq('/login', undefined, 'HEAD'))).headers.get('x-middleware-next')).toBe('1')

    // A POST to /login would reach Next's Server Action handler pre-auth (S3).
    const post = await proxy(mkReq('/login', undefined, 'POST'))
    expect(post.headers.get('x-middleware-next')).toBeNull()
    expect(post.status).toBe(401)
  })

  it('lets a POST to /login through with a valid cookie', async () => {
    const token = await mintAuthToken()
    const res = await proxy(mkReq('/login', token, 'POST'))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('is a no-op for every path when the gate is disabled', async () => {
    delete process.env.APP_ACCESS_PASSWORD
    expect((await proxy(mkReq('/api/chat'))).headers.get('x-middleware-next')).toBe('1')
    expect((await proxy(mkReq('/dashboard'))).headers.get('x-middleware-next')).toBe('1')
  })
})

describe('proxy gate — production without AUTH_SECRET', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
    _resetAuthWarnings()
  })

  it('returns 503 on every path and logs one error naming AUTH_SECRET, with no secret value', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    delete process.env.AUTH_SECRET
    _resetAuthWarnings()
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    for (const p of ['/', '/api/chat', '/login', '/api/auth', '/api/files/raw']) {
      const res = await proxy(mkReq(p))
      expect(res.status, p).toBe(503)
      expect(res.headers.get('x-middleware-next'), p).toBeNull()
    }

    expect(errSpy).toHaveBeenCalledTimes(1)
    const logged = errSpy.mock.calls[0]!.map(String).join(' ')
    expect(logged).toContain('AUTH_SECRET')
    expect(logged).not.toContain('hunter2')
  })

  it('does not 503 outside production (dev keeps the single-var setup)', async () => {
    delete process.env.AUTH_SECRET
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await proxy(mkReq('/login'))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })
})
