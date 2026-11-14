import { describe, it, expect } from 'vitest'
import { buildContentSecurityPolicy, buildSecurityHeaders } from '@/lib/securityHeaders'
import nextConfig from '../../../next.config'

const directive = (csp: string, name: string) =>
  csp.split('; ').find((d) => d.startsWith(name + ' '))

describe('buildContentSecurityPolicy', () => {
  it('limits connect-src to self and the supabase origin', () => {
    const csp = buildContentSecurityPolicy('https://abc.supabase.co', false)
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https://abc.supabase.co")
    expect(csp).not.toMatch(/connect-src 'self' https:(;|$)/)
  })

  it('falls back to https: when the origin is unknown', () => {
    const csp = buildContentSecurityPolicy(null, false)
    expect(directive(csp, 'connect-src')).toBe("connect-src 'self' https:")
  })

  it('no longer allows youtube-nocookie frames', () => {
    const csp = buildContentSecurityPolicy('https://abc.supabase.co', false)
    expect(csp).not.toContain('youtube-nocookie.com')
    expect(directive(csp, 'frame-src')).toBe("frame-src 'self' https://abc.supabase.co")
  })
})

describe('response headers', () => {
  it('includes a locked-down Permissions-Policy', () => {
    const h = buildSecurityHeaders(null)
    expect(h.find((x) => x.key === 'Permissions-Policy')?.value).toBe(
      'camera=(), microphone=(), geolocation=()',
    )
  })

  it('serves the headers from next.config and disables x-powered-by', async () => {
    expect(nextConfig.poweredByHeader).toBe(false)
    const rules = await nextConfig.headers!()
    expect(rules[0].headers.some((x) => x.key === 'Permissions-Policy')).toBe(true)
  })
})
