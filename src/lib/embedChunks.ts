// Bounded-concurrency, retrying embedding — shared by the new-upload path (embedChunks,
// persists by chunk id), the replace path (embedContents, returns embeddings so it can
// embed BEFORE the destructive commit) and the message backfill (backfillMissingEmbeddings).
// Removing the 100K truncation turns a long contract into hundreds of chunks; firing them
// all at once 429s Gemini and silently drops embeddings.
import { generateEmbedding } from '@/lib/embeddings'
import { updateChunkEmbedding } from '@/app/actions'
import { mapWithConcurrency } from '@/lib/concurrency'

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : fallback
}

const DEFAULT_CONCURRENCY = Number(process.env.EMBED_CONCURRENCY) || 5
const DEFAULT_RETRIES = Number(process.env.EMBED_MAX_RETRIES) || 3
// Circuit breaker (audit B11, ingest half): after this many embeds fail in a row the
// provider is treated as down and the rest of the batch is skipped (counted as failed)
// instead of each item running its own retry ladder. Without it a 1,000-chunk document
// under a full outage outlives maxDuration and ends as "Processing timed out".
const DEFAULT_FAIL_FAST_AFTER = positiveInt(process.env.EMBED_FAIL_FAST_AFTER, 5)
const BACKOFF_BASE_MS = 100

// Longest text sent to the embedding model for a chat message (/api/embed and the
// backfill). gemini-embedding-001 reads ~2,048 tokens (about 8,000 characters) and
// ignores the rest, so a longer input only costs request size; the stored row keeps
// the same capped text so the vector and the retrievable content agree.
export const EMBED_MAX_CHARS = positiveInt(process.env.EMBED_MAX_CHARS, 8000)

/** `text` cut to EMBED_MAX_CHARS, never ending on half of a surrogate pair. */
export function capEmbedText(text: string): string {
  if (text.length <= EMBED_MAX_CHARS) return text
  let capped = text.slice(0, EMBED_MAX_CHARS)
  const last = capped.charCodeAt(capped.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) capped = capped.slice(0, -1)
  return capped
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface PoolOpts { concurrency?: number; retries?: number; failFastAfter?: number }

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

// One breaker per batch. A success resets the streak, so scattered failures never trip
// it; once tripped, every item not yet started resolves to null without a provider call.
function breakerEmbed(opts: PoolOpts) {
  const retries = opts.retries ?? DEFAULT_RETRIES
  const failFastAfter = opts.failFastAfter ?? DEFAULT_FAIL_FAST_AFTER
  const state = { streak: 0, tripped: false }
  const embedOne = async (content: string): Promise<number[] | null> => {
    if (state.tripped) return null
    const embedding = await embedWithRetry(content, retries)
    if (embedding) {
      state.streak = 0
    } else if (++state.streak >= failFastAfter && !state.tripped) {
      state.tripped = true
      console.warn(`[embedChunks] ${failFastAfter} consecutive embed failures, skipping the rest of the batch`)
    }
    return embedding
  }
  return { embedOne, aborted: () => state.tripped }
}

export async function embedChunks(
  chunks: { id: number; content: string }[],
  opts: PoolOpts = {},
): Promise<{ embedded: number; failed: number; aborted: boolean }> {
  const { embedOne, aborted } = breakerEmbed(opts)
  let embedded = 0
  let failed = 0
  await mapWithConcurrency(chunks, opts.concurrency ?? DEFAULT_CONCURRENCY, async (chunk) => {
    const embedding = await embedOne(chunk.content)
    if (embedding) {
      try {
        await updateChunkEmbedding(chunk.id, embedding)
        embedded++
      } catch (err) {
        // The embedding generated fine but persisting it failed (DB hiccup). Count it as a
        // failure — never let one chunk's write error reject the pool and crash the ingest.
        console.warn(`[embedChunks] persist failed for chunk ${chunk.id}:`, err instanceof Error ? err.message : err)
        failed++
      }
    } else {
      failed++
    }
  })
  return { embedded, failed, aborted: aborted() }
}

export async function embedContents(
  contents: string[],
  opts: PoolOpts = {},
): Promise<{ embeddings: (number[] | null)[]; embedded: number; failed: number; aborted: boolean }> {
  const { embedOne, aborted } = breakerEmbed(opts)
  const embeddings = await mapWithConcurrency(contents, opts.concurrency ?? DEFAULT_CONCURRENCY, embedOne)
  const embedded = embeddings.filter(Boolean).length
  return { embeddings, embedded, failed: embeddings.length - embedded, aborted: aborted() }
}
