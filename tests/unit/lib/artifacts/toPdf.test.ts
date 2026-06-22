// tests/unit/lib/artifacts/toPdf.test.ts
import { describe, it, expect } from 'vitest'
import { toPdf } from '@/lib/artifacts/toPdf'

describe('toPdf', () => {
  it('produces a valid multi-block PDF', async () => {
    const md = ['# Report', 'Para with **bold**.', '## Section', '- a', '- b'].join('\n\n')
    const buf = await toPdf(md)
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
    expect(buf.length).toBeGreaterThan(400)
  })

  it('handles long content across pages without throwing', async () => {
    const md = Array.from({ length: 120 }, (_, i) => `Line ${i} with some wrapped text content here.`).join('\n\n')
    const buf = await toPdf(md)
    expect(buf.subarray(0, 4).toString('latin1')).toBe('%PDF')
  })
})
