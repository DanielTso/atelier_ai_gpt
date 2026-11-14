// Server-only Tavily wrapper (map + extract). Never import from client code —
// the API key is read here via getTavilyApiKey() and must not reach the browser.
import { tavily } from '@tavily/core'
import { getTavilyApiKey } from '@/lib/settings'
import { promptSafeLabel } from '@/lib/promptSafe'

const MAP_LIMIT = Number(process.env.WEB_MAP_LIMIT) || 100
const MAP_MAX_DEPTH = Number(process.env.WEB_MAP_MAX_DEPTH) || 2

export async function isTavilyConfigured(): Promise<boolean> {
  return Boolean(await getTavilyApiKey())
}

async function client() {
  const apiKey = await getTavilyApiKey()
  if (!apiKey) throw new Error('Tavily API key not configured')
  return tavily({ apiKey })
}

export async function mapSite(url: string, opts?: { maxDepth?: number; limit?: number }): Promise<string[]> {
  const c = await client()
  const limit = Math.min(Math.max(1, opts?.limit ?? MAP_LIMIT), MAP_LIMIT)
  const maxDepth = Math.min(Math.max(1, opts?.maxDepth ?? MAP_MAX_DEPTH), 3)
  const res = await c.map(url, { maxDepth, limit })
  return Array.isArray(res.results) ? res.results : []
}

export async function extractUrl(url: string): Promise<{ url: string; title: string; markdown: string }> {
  const c = await client()
  const res = await c.extract([url], { format: 'markdown' })
  const markdown = (res.results?.[0]?.rawContent ?? '').trim()
  if (!markdown) throw new Error('No content extracted')
  return { url, title: deriveTitle(markdown, url), markdown }
}

// The title becomes the document filename, which is interpolated into the system
// prompt — so it is made prompt-safe here (quotes, brackets, controls stripped).
function deriveTitle(markdown: string, url: string): string {
  const h1 = markdown.match(/^#\s+(.+)$/m)
  const fromHeading = h1?.[1] ? promptSafeLabel(h1[1], 200) : ''
  if (fromHeading) return fromHeading
  try {
    const u = new URL(url)
    return promptSafeLabel(`${u.host}${u.pathname}`.replace(/\/$/, ''), 200) || promptSafeLabel(url, 200)
  } catch {
    return promptSafeLabel(url, 200)
  }
}
