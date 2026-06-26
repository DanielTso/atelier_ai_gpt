// tests/unit/lib/artifacts/toDocx.test.ts
import { describe, it, expect } from 'vitest'
import { toDocx } from '@/lib/artifacts/toDocx'

describe('toDocx', () => {
  it('renders headings, bold, lists, and tables without throwing', async () => {
    const md = [
      '# Scope of Work',
      '',
      'Intro with **bold** text.',
      '',
      '## Items',
      '- first',
      '- second',
      '',
      '| Task | Days |',
      '| - | - |',
      '| Mobilize | 3 |',
    ].join('\n')
    const buf = await toDocx(md)
    expect(buf.length).toBeGreaterThan(0)
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('produces a valid file for empty input', async () => {
    const buf = await toDocx('')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
  })

  it('renders a markdown link as a hyperlink without throwing', async () => {
    const buf = await toDocx('See the [docs](https://example.com) for details.')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(buf.length).toBeGreaterThan(0)
  })

  it('renders an ordered list without throwing', async () => {
    const buf = await toDocx('1. first\n2. second\n3. third')
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK')
    expect(buf.length).toBeGreaterThan(0)
  })
})
