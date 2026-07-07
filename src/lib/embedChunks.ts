// Bounded-concurrency, retrying embedding — shared by the new-upload path (embedChunks,
// persists by chunk id) and the replace path (embedContents, returns embeddings so it can
// embed BEFORE the destructive commit). Removing the 100K truncation turns a long contract
// into hundreds of chunks; firing them all at once 429s Gemini and silently drops embeddings.
import { generateEmbedding } from '@/lib/embeddings'
import { updateChunkEmbedding } from '@/app/actions'

const DEFAULT_CONCURRENCY = Number(process.env.EMBED_CONCURRENCY) || 5
const DEFAULT_RETRIES = Number(process.env.EMBED_MAX_RETRIES) || 3
const BACKOFF_BASE_MS = 100

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// Embed one string with retry + exponential backoff (100ms, 200ms, 400ms…). Returns null
// if every attempt fails — a null is a counted, visible failure, never a thrown crash.
async function embedWithRetry(content: string, retries: number): Promise<number[] | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await generateEmbedding(content, 'document')
    } catch (err) {
      if (attempt === retries) {
        console.warn(`[embedChunks] embed failed after ${retries + 1} attempts:`, err instanceof Error ? err.message : err)
        return null
      }
      await sleep(BACKOFF_BASE_MS * 2 ** attempt)
    }
  }
  return null
}

// Bounded worker pool: at most `concurrency` tasks in flight; preserves index order.
async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  task: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (true) {
      const i = next++
      if (i >= items.length) return
      results[i] = await task(items[i], i)
    }
  }
  const n = Math.max(1, Math.min(concurrency, items.length))
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}

export async function embedChunks(
  chunks: { id: number; content: string }[],
  opts: { concurrency?: number; retries?: number } = {},
): Promise<{ embedded: number; failed: number }> {
  const retries = opts.retries ?? DEFAULT_RETRIES
  let embedded = 0
  let failed = 0
  await mapWithConcurrency(chunks, opts.concurrency ?? DEFAULT_CONCURRENCY, async (chunk) => {
    const embedding = await embedWithRetry(chunk.content, retries)
    if (embedding) {
      await updateChunkEmbedding(chunk.id, embedding)
      embedded++
    } else {
      failed++
    }
  })
  return { embedded, failed }
}

export async function embedContents(
  contents: string[],
  opts: { concurrency?: number; retries?: number } = {},
): Promise<{ embeddings: (number[] | null)[]; embedded: number; failed: number }> {
  const retries = opts.retries ?? DEFAULT_RETRIES
  const embeddings = await mapWithConcurrency(contents, opts.concurrency ?? DEFAULT_CONCURRENCY, (content) =>
    embedWithRetry(content, retries),
  )
  const embedded = embeddings.filter(Boolean).length
  return { embeddings, embedded, failed: embeddings.length - embedded }
}
