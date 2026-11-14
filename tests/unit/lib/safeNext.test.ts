import { describe, it, expect } from 'vitest'
import { safeNextPath } from '@/lib/safeNext'

const ORIGIN = 'https://atelier-ai-app.vercel.app'

describe('safeNextPath', () => {
  it('rejects every off-origin or control-character value with "/"', () => {
    for (const bad of [
      '/%09/evil.com',
      '/%0A/evil.com',
      '/%0d/evil.com',
      '/\t/evil.com',
      '/\n/evil.com',
      '/\r/evil.com',
      '//evil.com',
      '/\\evil.com',
      'https://evil.com',
      'javascript:alert(1)',
    ]) {
      expect(safeNextPath(bad, ORIGIN), JSON.stringify(bad)).toBe('/')
    }
  })

  it('rejects the decoded ?next= values an attacker would send', () => {
    // What the login page actually receives: URLSearchParams decodes %09/%0A/%0D.
    for (const q of ['next=/%09/evil.com', 'next=/%0A/evil.com', 'next=/%0D/evil.com', 'next=%2F%2Fevil.com']) {
      const next = new URLSearchParams(q).get('next')
      expect(safeNextPath(next, ORIGIN), q).toBe('/')
    }
  })

  it('keeps a same-origin path with its search and hash', () => {
    expect(safeNextPath('/?chat=5#x', ORIGIN)).toBe('/?chat=5#x')
    expect(safeNextPath('/?project=3&chat=9', ORIGIN)).toBe('/?project=3&chat=9')
  })

  it('falls back to "/" for a missing or empty value', () => {
    expect(safeNextPath(null, ORIGIN)).toBe('/')
    expect(safeNextPath('', ORIGIN)).toBe('/')
  })
})
