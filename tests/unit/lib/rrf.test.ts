import { describe, it, expect } from 'vitest'
import { rrfFuse } from '@/lib/rrf'

const item = (chunkId: number, extra: object = {}) => ({ chunkId, ...extra })

describe('rrfFuse', () => {
  it('scores shared items above single-list items', () => {
    const a = [item(1), item(2)]
    const b = [item(2), item(3)]
    const fused = rrfFuse([a, b], 60)
    expect(fused[0].chunkId).toBe(2) // in both lists
    expect(fused.map(f => f.chunkId)).toEqual([2, 1, 3])
  })
  it('keeps the FIRST list\'s payload for shared ids', () => {
    const a = [item(1, { embedding: [0.1] })]
    const b = [item(1, { embedding: null })]
    const fused = rrfFuse([a, b])
    expect((fused[0] as unknown as { embedding: unknown }).embedding).toEqual([0.1])
  })
  it('computes standard RRF scores (1/(k+rank+1))', () => {
    const fused = rrfFuse([[item(1)], [item(1)]], 60)
    expect(fused[0].rrfScore).toBeCloseTo(2 / 61)
  })
})
