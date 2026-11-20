// Server-only DB writes for chat turns that must NOT be callable from the
// browser. Deliberately not in the 'use server' actions module (every export
// there is a network endpoint); import it from route handlers only.
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { messages, messageAttachments, messageEmbeddings } from '@/db/schema'
import { isStorageConfigured, removeObjects } from '@/lib/storage'

// Same cap saveMessage applies (actions.ts MAX_MESSAGE_LEN).
const MAX_MESSAGE_LEN = 200_000

/**
 * Regenerate (audit D2): save the new reply IN PLACE of the reply it replaces —
 * same row id, same `created_at` (getChatMessages orders by it) — and return the
 * row id. Called by `/api/chat`'s turn recorder at its first write — once the
 * reply has savable content — so a regenerate that fails, or is stopped before
 * its first token, persists nothing and the old reply survives; from then on the
 * row holds the new (partial) text, kept current by `updateAssistantReplyContent`.
 *
 * One transaction: drop the old reply's attachment rows and embedding (they
 * describe the old text), then rewrite its content. The UPDATE is scoped to this
 * chat's assistant row, so it can never touch anything else; if it matches no
 * row (deleted meanwhile, e.g. by message Delete in another tab), a fresh
 * assistant row is inserted instead. The old attachments' Storage objects are
 * removed after the commit, best-effort (the paths are logged on failure).
 */
export async function replaceAssistantReply(chatId: number, replaceMessageDbId: number, text: string): Promise<number> {
  const content = text.slice(0, MAX_MESSAGE_LEN)
  const { id, storagePaths } = await db.transaction(async (tx) => {
    const attachmentRows = await tx.select({ storagePath: messageAttachments.storagePath })
      .from(messageAttachments)
      .where(eq(messageAttachments.messageId, replaceMessageDbId))
    // Scope the child deletes to a row that really is this chat's reply.
    const [target] = await tx.select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, replaceMessageDbId), eq(messages.chatId, chatId), eq(messages.role, 'assistant')))
    if (target) {
      await tx.delete(messageAttachments).where(eq(messageAttachments.messageId, target.id))
      await tx.delete(messageEmbeddings).where(eq(messageEmbeddings.messageId, target.id))
    }
    const [updated] = await tx.update(messages)
      .set({ content })
      .where(and(eq(messages.id, replaceMessageDbId), eq(messages.chatId, chatId), eq(messages.role, 'assistant')))
      .returning({ id: messages.id })
    if (updated) {
      const paths = attachmentRows.map(r => r.storagePath).filter((p): p is string => Boolean(p))
      return { id: updated.id, storagePaths: paths }
    }
    const [inserted] = await tx.insert(messages)
      .values({ chatId, role: 'assistant', content })
      .returning({ id: messages.id })
    return { id: inserted.id, storagePaths: [] as string[] }
  })

  // Same "recently active" bump an ordinary saveMessage gives the chat's project.
  await db.execute(sql`UPDATE projects SET updated_at = now() WHERE id = (SELECT project_id FROM chats WHERE id = ${chatId})`)
    .catch(e => console.error('[replaceAssistantReply] project touch failed:', e))

  if (storagePaths.length > 0 && isStorageConfigured()) {
    await removeObjects(storagePaths).catch(e =>
      console.warn('[attachments] storage cleanup failed for paths:', storagePaths, e instanceof Error ? e.message : e))
  }
  return id
}

/**
 * Streaming checkpoint (audit R2): rewrite the content of the assistant row the
 * turn recorder already wrote — nothing else (no attachment, embedding or
 * project changes). Scoped to this chat's assistant row, like
 * `replaceAssistantReply`. If the row is gone (deleted meanwhile, e.g. by message
 * Delete in another tab) this is a logged no-op: a deleted reply is never
 * resurrected by a later checkpoint.
 */
export async function updateAssistantReplyContent(chatId: number, id: number, text: string): Promise<void> {
  const [updated] = await db.update(messages)
    .set({ content: text.slice(0, MAX_MESSAGE_LEN) })
    .where(and(eq(messages.id, id), eq(messages.chatId, chatId), eq(messages.role, 'assistant')))
    .returning({ id: messages.id })
  if (!updated) console.warn(`[chat] assistant message ${id} of chat ${chatId} is gone; reply text not updated`)
}
