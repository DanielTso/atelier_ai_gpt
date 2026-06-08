import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'
import { settings } from '@/db/schema'

vi.mock('@/db', () => ({
  get db() {
    return testDb
  },
}))

import { getServerSetting, clearSettingsCache } from '@/lib/settings'
import { setSetting } from '@/app/actions'

describe('settings caching', () => {
  beforeEach(async () => {
    await createTestDb()
    clearSettingsCache()
  })

  it('returns env fallback when no DB value exists', async () => {
    process.env.TEST_SETTING = 'env-value'
    const value = await getServerSetting('test-key', 'TEST_SETTING')
    expect(value).toBe('env-value')
    delete process.env.TEST_SETTING
  })

  it('returns DB value over env fallback', async () => {
    process.env.TEST_SETTING = 'env-value'
    await setSetting('test-key', 'db-value')
    clearSettingsCache() // clear cache after writing
    const value = await getServerSetting('test-key', 'TEST_SETTING')
    expect(value).toBe('db-value')
    delete process.env.TEST_SETTING
  })

  it('returns cached value on second call without hitting DB', async () => {
    await setSetting('cached-key', 'original')
    clearSettingsCache()

    const first = await getServerSetting('cached-key')
    expect(first).toBe('original')

    // Update DB directly (bypassing setSetting to avoid cache clear)
    await testDb.insert(settings)
      .values({ key: 'cached-key', value: 'updated', updatedAt: new Date() })
      .onConflictDoUpdate({ target: settings.key, set: { value: 'updated' } })

    // Cache should still return 'original'
    const second = await getServerSetting('cached-key')
    expect(second).toBe('original')
  })

  it('clearSettingsCache forces fresh DB read', async () => {
    await setSetting('clear-key', 'value-1')
    clearSettingsCache()

    const first = await getServerSetting('clear-key')
    expect(first).toBe('value-1')

    await setSetting('clear-key', 'value-2')
    // setSetting calls clearSettingsCache internally
    const second = await getServerSetting('clear-key')
    expect(second).toBe('value-2')
  })

  it('getAnthropicApiKey reads DB key over env', async () => {
    const { getAnthropicApiKey } = await import('@/lib/settings')
    process.env.ANTHROPIC_API_KEY = 'env-anthropic'
    await setSetting('anthropic-api-key', 'db-anthropic')
    clearSettingsCache()
    expect(await getAnthropicApiKey()).toBe('db-anthropic')
    delete process.env.ANTHROPIC_API_KEY
  })

  it('getAnthropicApiKey falls back to env when no DB key', async () => {
    const { getAnthropicApiKey } = await import('@/lib/settings')
    clearSettingsCache()
    process.env.ANTHROPIC_API_KEY = 'env-only-anthropic'
    expect(await getAnthropicApiKey()).toBe('env-only-anthropic')
    delete process.env.ANTHROPIC_API_KEY
  })
})
