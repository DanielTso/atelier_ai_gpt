import { describe, it, expect } from 'vitest'
import { sanitizeStorageName } from '@/lib/storage'

// sanitizeStorageName is the anti-traversal control for the derived Storage object
// path `documents/<projectId>/<docId>/<sanitize(filename)>`. These lock the contract
// so a future loosening of the regex (e.g. allowing '/') can't silently reopen
// path traversal in the private bucket.
describe('sanitizeStorageName', () => {
  it('collapses dot-only names so they cannot become a parent reference', () => {
    expect(sanitizeStorageName('.')).toBe('_')
    expect(sanitizeStorageName('..')).toBe('_')
    expect(sanitizeStorageName('...')).toBe('_')
  })

  it('strips path separators so the result stays a single segment', () => {
    expect(sanitizeStorageName('a/b/c.pdf')).toBe('a_b_c.pdf')
    for (const name of ['../../etc/passwd', '..\\..\\win.ini', '/abs/path', 'x/../../y']) {
      const out = sanitizeStorageName(name)
      expect(out).not.toMatch(/[/\\]/) // no separators survive → cannot escape the prefix
    }
  })

  it('preserves safe filename characters and replaces the rest with underscore', () => {
    expect(sanitizeStorageName('plan-v2.0_final.pdf')).toBe('plan-v2.0_final.pdf')
    expect(sanitizeStorageName('My File (1).PDF')).toBe('My_File__1_.PDF')
  })

  it('replaces unicode/whitespace with underscore (charset-safe)', () => {
    expect(sanitizeStorageName('rapport été.pdf')).toMatch(/^[a-zA-Z0-9._-]+$/)
    expect(sanitizeStorageName('a b\tc.pdf')).toMatch(/^[a-zA-Z0-9._-]+$/)
  })
})
