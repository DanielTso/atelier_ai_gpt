import { describe, it, expect } from 'vitest'
import { withStageTimeout } from '@/lib/stageTimeout'

describe('withStageTimeout', () => {
  it('resolves with the callee value and hands it a live signal', async () => {
    let seen: AbortSignal | undefined
    const v = await withStageTimeout(1000, async signal => { seen = signal; return 42 })
    expect(v).toBe(42)
    expect(seen).toBeInstanceOf(AbortSignal)
    expect(seen!.aborted).toBe(false)
  })

  it('rejects with the callee error', async () => {
    await expect(withStageTimeout(1000, async () => { throw new Error('boom') })).rejects.toThrow('boom')
  })

  it('rejects a synchronous throw from the callee instead of throwing', async () => {
    const p = withStageTimeout(1000, () => { throw new Error('sync boom') })
    await expect(p).rejects.toThrow('sync boom')
  })

  it('times out and aborts the signal when the callee honours it', async () => {
    let seen: AbortSignal | undefined
    const p = withStageTimeout(50, signal => {
      seen = signal
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))))
    })
    await expect(p).rejects.toBeDefined()
    expect(seen!.aborted).toBe(true)
  })

  it('still settles on time when the callee ignores the signal', async () => {
    const t0 = Date.now()
    await expect(withStageTimeout(50, () => new Promise(() => {}))).rejects.toBeDefined()
    expect(Date.now() - t0).toBeLessThan(50 + 500)
  })
})
