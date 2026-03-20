import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cosineSimilarity } from '@/lib/embeddings'

describe('cosineSimilarity', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1.0)
  })

  it('returns ~0 for orthogonal vectors', () => {
    const a = [1, 0, 0]
    const b = [0, 1, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(0.0)
  })

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0, 0]
    const b = [-1, 0, 0]
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1.0)
  })

  it('returns 0 and warns on dimension mismatch', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = [1, 2, 3]
    const b = [1, 2]
    const result = cosineSimilarity(a, b)
    expect(result).toBe(0)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('dimension mismatch')
    )
  })

  it('returns 0 for zero vectors', () => {
    const a = [0, 0, 0]
    const b = [1, 2, 3]
    expect(cosineSimilarity(a, b)).toBe(0)
  })
})
