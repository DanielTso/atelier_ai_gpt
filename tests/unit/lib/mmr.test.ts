import { describe, it, expect } from 'vitest'
import { mmr } from '@/lib/mmr'

const item = (id: string, embedding: number[], similarity: number) => ({ id, embedding, similarity })

describe('mmr', () => {
  it('drops a near-duplicate in favour of a diverse-but-relevant item', () => {
    const a = item('a', [1, 0, 0], 0.95)
    const aDup = item('aDup', [0.99, 0.01, 0], 0.94)
    const b = item('b', [0, 1, 0], 0.80)
    const picked = mmr([a, aDup, b], 2, 0.7).map(x => x.id)
    expect(picked[0]).toBe('a')
    expect(picked).toContain('b')
    expect(picked).not.toContain('aDup')
  })

  it('returns at most topK and preserves items when all distinct', () => {
    const items = [item('a', [1,0,0], 0.9), item('b', [0,1,0], 0.8), item('c', [0,0,1], 0.7)]
    expect(mmr(items, 2, 0.7)).toHaveLength(2)
    expect(mmr(items, 10, 0.7)).toHaveLength(3)
  })

  it('handles empty input', () => {
    expect(mmr([], 3, 0.7)).toEqual([])
  })

  it('ranks by an explicit relevance when one is given, over raw similarity', () => {
    // Fused rank says c is the most relevant even though its cosine is lowest.
    const a = { ...item('a', [1, 0, 0], 0.95), relevance: 0.4 }
    const b = { ...item('b', [0, 1, 0], 0.9), relevance: 0.5 }
    const c = { ...item('c', [0, 0, 1], 0.6), relevance: 1 }
    expect(mmr([a, b, c], 1, 0.7).map(x => x.id)).toEqual(['c'])
  })
})
