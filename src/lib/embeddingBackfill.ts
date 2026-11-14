// Message-embedding backfill (handoff 2026-11-12 item 4, audit B13). A chat message
// is embedded once, by /api/embed, right after its turn; when that call fails (the
// 2026-10-16 Gemini credits outage) the message keeps no message_embeddings row and
// is invisible to semantic retrieval. This embeds those messages.
//
// Deliberately NOT a server action: it calls the embedding provider for up to 1,000
// messages per run, so it is an operator step, run with scripts/backfill-embeddings.ts
// (`--dry-run` first). Running it against production is owner-approved.
import { and, asc, count, eq, gte, inArray, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { chats, messageEmbeddings, messages } from '@/db/schema'
import { capEmbedText, embedContents, EMBED_MAX_CHARS } from '@/lib/embedChunks'

export const BACKFILL_MAX_LIMIT = 1000

export interface BackfillResult {
  /** Messages embedded and stored this run. */
  embedded: number
  /** Messages attempted this run that did not end up stored (they stay missing). */
  failed: number
  /** Messages selected but never attempted: the provider failed several times in a row and the run stopped. */
  skipped: number
  /** Messages still missing an embedding after the run. */
  remaining: number
}

// A user/assistant message with real text and no message_embeddings row.
function missingEmbeddingFilter(since?: Date) {
  return and(
    isNull(messageEmbeddings.id),
    inArray(messages.role, ['user', 'assistant']),
    sql`${messages.content} ~ '\\S'`,
    since ? gte(messages.createdAt, since) : undefined,
  )
}

/** How many messages lack an embedding (read-only; no provider call). */
export async function countMissingEmbeddings(since?: Date): Promise<number> {
  const [row] = await db.select({ value: count() })
    .from(messages)
    .leftJoin(messageEmbeddings, eq(messageEmbeddings.messageId, messages.id))
    .where(missingEmbeddingFilter(since))
  return row?.value ?? 0
}

/**
 * Embeds up to `limit` messages that have no embedding, oldest first, filed under
 * each chat's DB project (as /api/embed does). Idempotent: an embedded message is
 * never selected again, so a second run reports `embedded: 0`. A message that fails
 * stays missing for the next run. When the provider fails `EMBED_FAIL_FAST_AFTER`
 * times in a row the run stops and the untried messages come back as `skipped`, so
 * an outage reads as "provider down" instead of the same rows failing every run.
 */
export async function backfillMissingEmbeddings(
  { since, limit = 200 }: { since?: Date; limit?: number } = {}
): Promise<BackfillResult> {
  const validSince = since === undefined || (since instanceof Date && !Number.isNaN(since.getTime()))
  if (!Number.isInteger(limit) || limit < 1 || limit > BACKFILL_MAX_LIMIT || !validSince) {
    throw new Error('Invalid backfill options')
  }

  const rows = await db.select({
    id: messages.id,
    chatId: messages.chatId,
    projectId: chats.projectId,
    // Only the prefix that can be embedded: a message can be 500k characters, and
    // a batch of them should not be pulled into memory whole. `left` counts code
    // points, which is never fewer UTF-16 units, so capEmbedText still sees enough.
    content: sql<string>`left(${messages.content}, ${EMBED_MAX_CHARS + 1})`,
  })
    .from(messages)
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .leftJoin(messageEmbeddings, eq(messageEmbeddings.messageId, messages.id))
    .where(missingEmbeddingFilter(since))
    .orderBy(asc(messages.createdAt), asc(messages.id))
    .limit(limit)

  let embedded = 0
  let failed = 0
  let skipped = 0
  if (rows.length > 0) {
    const texts = rows.map(r => capEmbedText(r.content))
    const result = await embedContents(texts)
    skipped = result.skipped
    failed = result.failed - result.skipped
    for (let i = 0; i < rows.length; i++) {
      const embedding = result.embeddings[i]
      if (!embedding) continue
      const row = rows[i]
      try {
        await db.insert(messageEmbeddings).values({
          messageId: row.id,
          chatId: row.chatId,
          projectId: row.projectId ?? null,
          content: texts[i],
          embedding,
        }).onConflictDoUpdate({
          target: messageEmbeddings.messageId,
          set: { content: texts[i], embedding, createdAt: new Date() },
        })
        embedded++
      } catch (err) {
        // e.g. the message was deleted mid-run (FK violation). Leave it; count it.
        console.warn(`[backfill] could not store the embedding for message ${row.id}:`, err instanceof Error ? err.message : err)
        failed++
      }
    }
  }

  return { embedded, failed, skipped, remaining: await countMissingEmbeddings(since) }
}
