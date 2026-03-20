import { db } from '@/db'
import { settings } from '@/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Detect cloud environment (Vercel/Turso).
 * When TURSO_DATABASE_URL is set, Ollama can't exist — skip all local network calls.
 */
export function isCloudEnvironment(): boolean {
  return !!process.env.TURSO_DATABASE_URL
}

const settingsCache = new Map<string, { value: string | null; expiresAt: number }>()
const SETTINGS_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

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

  const result = await db.select().from(settings).where(eq(settings.key, key)).get()
  let value: string | null = null
  if (result?.value) {
    value = result.value
  } else if (envFallback) {
    value = process.env[envFallback] ?? null
  }

  settingsCache.set(cacheKey, { value, expiresAt: Date.now() + SETTINGS_CACHE_TTL })
  return value
}

export async function getGeminiApiKey(): Promise<string | null> {
  return getServerSetting('gemini-api-key', 'GOOGLE_GENERATIVE_AI_API_KEY')
}

export async function getOllamaBaseUrl(): Promise<string> {
  const url = await getServerSetting('ollama-base-url')
  return url || 'http://localhost:11434'
}

export async function getDefaultModel(): Promise<string | null> {
  return getServerSetting('default-model')
}

export async function getDefaultSystemPrompt(): Promise<string | null> {
  return getServerSetting('default-system-prompt')
}

export async function getDashScopeApiKey(): Promise<string | null> {
  return getServerSetting('dashscope-api-key', 'DASHSCOPE_API_KEY')
}
