import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestDb, testDb } from '../../helpers/test-db'

vi.mock('@/db', () => ({ get db() { return testDb } }))

import { getSetting, getSettings } from '@/app/actions'

describe('sensitive settings are not client-readable', () => {
  beforeEach(async () => {
    await createTestDb()
  })

  it('getSetting throws for anthropic-api-key', async () => {
    await expect(getSetting('anthropic-api-key')).rejects.toThrow('Access denied')
  })

  it('getSetting throws for gemini-api-key', async () => {
    await expect(getSetting('gemini-api-key')).rejects.toThrow('Access denied')
  })

  it('getSettings filters out sensitive keys', async () => {
    const result = await getSettings(['anthropic-api-key', 'gemini-api-key'])
    expect(result).toEqual({})
  })
})
