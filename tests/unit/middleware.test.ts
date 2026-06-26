import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { middleware, config } from '@/middleware'
import { mintAuthToken, AUTH_COOKIE_NAME } from '@/lib/auth'

const ORIG = { pw: process.env.APP_ACCESS_PASSWORD, secret: process.env.AUTH_SECRET }

beforeEach(() => {
  process.env.APP_ACCESS_PASSWORD = 'hunter2'
  process.env.AUTH_SECRET = 'test-secret'
})
afterEach(() => {
  if (ORIG.pw === undefined) delete process.env.APP_ACCESS_PASSWORD; else process.env.APP_ACCESS_PASSWORD = ORIG.pw
  if (ORIG.secret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = ORIG.secret
})

function mkReq(path: string, cookie?: string) {
  const headers: Record<string, string> = {}
  if (cookie) headers.cookie = `${AUTH_COOKIE_NAME}=${cookie}`
  return new NextRequest(new URL(path, 'http://localhost'), { headers })
}

// Part A — the matcher decides which paths the gate even runs on. This locks the
// PREVIOUSLY-FIXED bypass the matcher comment documents (an earlier matcher excluded
// any path ending in an image extension, leaving such routes reachable unauthenticated).
describe('middleware matcher', () => {
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

// Part B — the gate's branching: api-vs-page, public-path allowlist, enable flag.
describe('middleware gate', () => {
  it('lets a request through with a valid cookie', async () => {
    const token = await mintAuthToken()
    const res = await middleware(mkReq('/api/chat', token))
    expect(res.headers.get('x-middleware-next')).toBe('1')
  })

  it('returns 401 JSON on an /api route without a valid cookie', async () => {
    const res = await middleware(mkReq('/api/chat'))
    expect(res.status).toBe(401)
  })

  it('returns 401 on an /api route with a tampered cookie', async () => {
    const res = await middleware(mkReq('/api/chat', 'payload.deadbeef'))
    expect(res.status).toBe(401)
  })

  it('redirects a page request without a cookie to /login, preserving the destination', async () => {
    const res = await middleware(mkReq('/dashboard'))
    expect(res.status).toBe(307)
    const loc = res.headers.get('location')!
    expect(loc).toContain('/login')
    expect(loc).toContain('next=%2Fdashboard')
  })

  it('does not append a next param for the root path', async () => {
    const res = await middleware(mkReq('/'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).not.toContain('next=')
  })

  it('lets /login and /api/auth through unauthenticated', async () => {
    expect((await middleware(mkReq('/login'))).headers.get('x-middleware-next')).toBe('1')
    expect((await middleware(mkReq('/api/auth'))).headers.get('x-middleware-next')).toBe('1')
  })

  it('is a no-op for every path when the gate is disabled', async () => {
    delete process.env.APP_ACCESS_PASSWORD
    expect((await middleware(mkReq('/api/chat'))).headers.get('x-middleware-next')).toBe('1')
    expect((await middleware(mkReq('/dashboard'))).headers.get('x-middleware-next')).toBe('1')
  })
})
