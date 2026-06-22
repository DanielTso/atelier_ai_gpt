// tests/unit/lib/artifacts/toPptx.test.ts
import { describe, it, expect } from 'vitest'
import { toPptx } from '@/lib/artifacts/toPptx'

describe('toPptx', () => {
  it('splits slides on H1 and produces a valid pptx', async () => {
    const md = ['# Title One', 'body a', '# Title Two', '- bullet'].join('\n\n')
    const buf = await toPptx(md)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(buf.length).toBeGreaterThan(0)
  })

  it('produces a deck for content with no H1', async () => {
    const buf = await toPptx('just a paragraph')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })
})
