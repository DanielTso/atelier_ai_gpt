import { describe, it, expect } from 'vitest'
import { chatRequestSchema } from '@/lib/validation'

const baseBody = {
  messages: [{ id: '1', role: 'user', parts: [{ type: 'text', text: 'Hi' }] }],
}

describe('chatRequestSchema — model id shape guard', () => {
  it('accepts a well-shaped unknown/legacy model id (shape validation is not the allow-list)', () => {
    // resolveRequestedModel() is the real gate (registry.byId) — this schema
    // only rejects garbage shapes, so a stale/unknown-but-well-formed id must
    // pass here and fall back further downstream, not 400 at the edge.
    const result = chatRequestSchema.safeParse({ ...baseBody, model: 'claude-mystery-9' })
    expect(result.success).toBe(true)
  })

  it('rejects an empty model string', () => {
    const result = chatRequestSchema.safeParse({ ...baseBody, model: '' })
    expect(result.success).toBe(false)
  })

  it('rejects a model string over 64 characters', () => {
    const result = chatRequestSchema.safeParse({ ...baseBody, model: 'a'.repeat(65) })
    expect(result.success).toBe(false)
  })

  it('accepts a model string at exactly 64 characters', () => {
    const result = chatRequestSchema.safeParse({ ...baseBody, model: 'a'.repeat(64) })
    expect(result.success).toBe(true)
  })

  it('rejects a bad-charset model id (space)', () => {
    const result = chatRequestSchema.safeParse({ ...baseBody, model: 'claude opus' })
    expect(result.success).toBe(false)
  })

  it('rejects a bad-charset model id (underscore)', () => {
    const result = chatRequestSchema.safeParse({ ...baseBody, model: 'claude_opus_4' })
    expect(result.success).toBe(false)
  })

  it('rejects a model id starting with a disallowed character (hyphen)', () => {
    const result = chatRequestSchema.safeParse({ ...baseBody, model: '-claude-opus' })
    expect(result.success).toBe(false)
  })
})

describe('chatRequestSchema — effort enum', () => {
  it('accepts xhigh', () => {
    const result = chatRequestSchema.safeParse({ ...baseBody, effort: 'xhigh' })
    expect(result.success).toBe(true)
  })

  it('still accepts the pre-existing levels', () => {
    for (const level of ['low', 'medium', 'high', 'max']) {
      const result = chatRequestSchema.safeParse({ ...baseBody, effort: level })
      expect(result.success).toBe(true)
    }
  })

  it('rejects an unknown effort level', () => {
    const result = chatRequestSchema.safeParse({ ...baseBody, effort: 'ultra' })
    expect(result.success).toBe(false)
  })
})
