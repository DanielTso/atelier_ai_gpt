// Raw shape of a row from GET https://api.anthropic.com/v1/models. `capabilities`
// is intentionally untyped here (an untyped nested tree of `{ supported: boolean }`
// leaves) — Task 2's normalize step maps it defensively into ModelCapabilities.
export interface RawAnthropicModel {
  id: string
  display_name: string
  created_at: string
  max_input_tokens?: number | null
  max_tokens?: number | null
  capabilities?: unknown
}

interface AnthropicModelsPage {
  data?: RawAnthropicModel[]
  has_more?: boolean
  first_id?: string | null
  last_id?: string | null
}

const ANTHROPIC_MODELS_URL = 'https://api.anthropic.com/v1/models'
const ANTHROPIC_VERSION = '2023-06-01'
const FETCH_TIMEOUT_MS = 5000
const PAGE_LIMIT = 100
// Safety cap so a misbehaving/looping API (e.g. has_more never clears) can't
// hang a request path forever — throw instead of paginating indefinitely.
const MAX_PAGES = 10

/**
 * fetch() with a hard timeout via AbortController. This is the repo's first
 * outbound-fetch-with-timeout convention: house style elsewhere (queryRewrite.ts,
 * rerank.ts) wraps provider-SDK calls that already carry their own timeouts;
 * a raw fetch to a third-party REST endpoint needs its own guard so a slow/
 * hanging Anthropic API can never block a request indefinitely.
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Fetch the full Anthropic models catalog under our own API key, paginating
 * via `after_id`/`has_more` (NOT page/next_page — the Anthropic API's cursor
 * pagination). Throws (never returns a partial/empty list silently) on a
 * non-2xx response or if pagination exceeds MAX_PAGES; callers (Task 2's
 * registry) are expected to catch and degrade to STATIC_SEED.
 */
export async function fetchAllAnthropicModels(apiKey: string): Promise<RawAnthropicModel[]> {
  const all: RawAnthropicModel[] = []
  let afterId: string | undefined

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(ANTHROPIC_MODELS_URL)
    url.searchParams.set('limit', String(PAGE_LIMIT))
    if (afterId) url.searchParams.set('after_id', afterId)

    const res = await fetchWithTimeout(url.toString(), {
      headers: { 'x-api-key': apiKey, 'anthropic-version': ANTHROPIC_VERSION },
    })

    if (!res.ok) {
      throw new Error(`Anthropic models API returned ${res.status}`)
    }

    const body = (await res.json()) as AnthropicModelsPage
    all.push(...(body.data ?? []))

    if (!body.has_more || !body.last_id) return all
    afterId = body.last_id
  }

  throw new Error(`Anthropic models API pagination exceeded MAX_PAGES (${MAX_PAGES})`)
}
