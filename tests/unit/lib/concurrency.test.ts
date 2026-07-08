import { describe, it, expect } from 'vitest'
import { mapWithConcurrency } from '@/lib/concurrency'

describe('mapWithConcurrency', () => {
  it('preserves index order regardless of completion order', async () => {
    const delays = [30, 0, 10]
    const out = await mapWithConcurrency(delays, 3, async (d, i) => {
      await new Promise(r => setTimeout(r, d))
      return `item-${i}`
    })
    expect(out).toEqual(['item-0', 'item-1', 'item-2'])
  })

  it('never exceeds the concurrency bound', async () => {
    let inFlight = 0
    let peak = 0
    await mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
    })
    expect(peak).toBeLessThanOrEqual(2)
  })

  it('handles an empty list', async () => {
    expect(await mapWithConcurrency([], 4, async () => 1)).toEqual([])
  })
})
