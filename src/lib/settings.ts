import { db } from '@/db'
import { settings } from '@/db/schema'
import { eq } from 'drizzle-orm'

const settingsCache = new Map<string, { value: string | null; expiresAt: number }>()
const SETTINGS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes
// Cache a NEGATIVE (null) result only briefly: an env key added to an already-running
// process (or set after first read) should not appear "missing" for a full 5 minutes.
const SETTINGS_NULL_CACHE_TTL = 30 * 1000 // 30 seconds

/**
 * Clear the settings cache. Call after saving settings to ensure changes take effect immediately.
 */
export function clearSettingsCache() {
  settingsCache.clear()
}

/**
 * Get a setting from DB first, falling back to an environment variable.
 * Results are cached for 5 minutes.
 */
export async function getServerSetting(key: string, envFallback?: string): Promise<string | null> {
  const cacheKey = envFallback ? `${key}:${envFallback}` : key
  const cached = settingsCache.get(cacheKey)
  if (cached && Date.now() < cached.expiresAt) {
    return cached.value
  }

  const [result] = await db.select().from(settings).where(eq(settings.key, key))
  let value: string | null = null
  if (result?.value) {
    value = result.value
  } else if (envFallback) {
    value = process.env[envFallback] ?? null
  }

  const ttl = value === null ? SETTINGS_NULL_CACHE_TTL : SETTINGS_CACHE_TTL
  settingsCache.set(cacheKey, { value, expiresAt: Date.now() + ttl })
  return value
}

export async function getGeminiApiKey(): Promise<string | null> {
  return getServerSetting('gemini-api-key', 'GOOGLE_GENERATIVE_AI_API_KEY')
}

export async function getAnthropicApiKey(): Promise<string | null> {
  return getServerSetting('anthropic-api-key', 'ANTHROPIC_API_KEY')
}

export async function getTavilyApiKey(): Promise<string | null> {
  return getServerSetting('tavily-api-key', 'TAVILY_API_KEY')
}
