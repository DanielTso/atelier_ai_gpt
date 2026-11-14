import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

const { clearModelRegistryCache } = vi.hoisted(() => ({ clearModelRegistryCache: vi.fn() }))
vi.mock('@/lib/models/registry', () => ({ clearModelRegistryCache }))

import { setSetting, setSettings } from '@/app/actions'

// C6 review: a stale registry is the last LIVE catalog fetched under some key.
// After the Anthropic key changes, that catalog belongs to the old key, so the
// save drops it as well as the cache.
describe('settings saves invalidate the model registry', () => {
  beforeEach(async () => {
    await createTestDb()
    clearModelRegistryCache.mockClear()
  })

  it('setSetting of the Anthropic key also drops the last good catalog', async () => {
    await setSetting('anthropic-api-key', 'sk-new')
    expect(clearModelRegistryCache).toHaveBeenCalledExactlyOnceWith({ includeLastGood: true })
  })

  it('setSetting of any other key keeps the last good catalog', async () => {
    await setSetting('model-pricing-overrides', '{}')
    expect(clearModelRegistryCache).toHaveBeenCalledExactlyOnceWith({ includeLastGood: false })
  })

  it('setSettings drops the last good catalog when the batch includes the Anthropic key', async () => {
    await setSettings([{ key: 'gemini-api-key', value: 'g' }, { key: 'anthropic-api-key', value: 'sk-new' }])
    expect(clearModelRegistryCache).toHaveBeenCalledExactlyOnceWith({ includeLastGood: true })
    clearModelRegistryCache.mockClear()
    await setSettings([{ key: 'gemini-api-key', value: 'g2' }])
    expect(clearModelRegistryCache).toHaveBeenCalledExactlyOnceWith({ includeLastGood: false })
  })
})
