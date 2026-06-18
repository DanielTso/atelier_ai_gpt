import { describe, it, expect } from 'vitest'
import { buildProjectPreamble } from '@/lib/projectPreamble'

describe('buildProjectPreamble', () => {
  it('returns empty string when both are blank', () => {
    expect(buildProjectPreamble(null, null)).toBe('')
    expect(buildProjectPreamble('', '  ')).toBe('')
  })
  it('includes memory and instructions with clear delimiters', () => {
    const out = buildProjectPreamble('Vernon hub', 'Be terse')
    expect(out).toContain('Project memory:')
    expect(out).toContain('Vernon hub')
    expect(out).toContain('Project instructions:')
    expect(out).toContain('Be terse')
  })
  it('omits the empty section', () => {
    expect(buildProjectPreamble('only memory', null)).toContain('Project memory:')
    expect(buildProjectPreamble('only memory', null)).not.toContain('Project instructions:')
  })
})
