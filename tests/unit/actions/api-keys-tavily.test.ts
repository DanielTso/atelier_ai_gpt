import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

import { getSetting, getSettings } from '@/app/actions'

describe('tavily-api-key is a sensitive, server-only setting', () => {
  beforeEach(async () => {
    await createTestDb()
  })

  it('getSetting throws for tavily-api-key', async () => {
    await expect(getSetting('tavily-api-key')).rejects.toThrow('Access denied')
  })

  it('getSettings filters out tavily-api-key', async () => {
    const result = await getSettings(['tavily-api-key'])
    expect(result).toEqual({})
  })

  it('getApiKeyStatus reports tavily configured from the DB', async () => {
    const { getApiKeyStatus, setSetting } = await import('@/app/actions')
    delete process.env.TAVILY_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GOOGLE_GENERATIVE_AI_API_KEY
    await setSetting('tavily-api-key', 'tvly-test')
    const status = await getApiKeyStatus()
    expect(status.tavily).toBe(true)
    expect(status.anthropic).toBe(false)
  })
})
