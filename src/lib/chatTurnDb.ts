// Server-only DB writes for chat turns that must NOT be callable from the
// browser. Deliberately not in the 'use server' actions module (every export
// there is a network endpoint); import it from route handlers and other server
// modules only (the actions module may import it; it must not re-export it).
import { and, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { messages, messageAttachments, messageEmbeddings, artifacts, artifactVersions } from '@/db/schema'
import { isStorageConfigured, removeObjects } from '@/lib/storage'

// Same cap saveMessage applies (actions.ts MAX_MESSAGE_LEN).
const MAX_MESSAGE_LEN = 200_000

/**
 * The subset of a reply's attachment `paths` whose Storage objects may be removed
 * when the reply is regenerated or deleted (audit R4). A generated image
 * (`attachments/<chatId>/generated/<uuid>.<ext>`) is kept when an artifact of the
 * same chat embeds it — in its current content or in any of its versions (an
 * older one can be restored) — because the artifact outlives the reply. The
 * embedded URL carries the path URL-encoded, so the match is on the file name
 * (the last segment, a UUID), a plain substring of the content. Every other path
 * is returned unchanged. If the lookup fails, every generated path is kept: a
 * kept object is recoverable, a deleted one is not. `deleteChat` sweeps what is
 * kept here.
 */
export async function pathsSafeToRemove(chatId: number, paths: string[]): Promise<string[]> {
  const fileName = (p: string) => p.slice(p.lastIndexOf('/') + 1)
  const isGenerated = (p: string) => p.includes('/generated/')
  const names = [...new Set(paths.filter(isGenerated).map(fileName))]
  if (names.length === 0) return paths
  try {
    const candidates = sql.join(names.map(n => sql`(${n}::text)`), sql`, `)
    const embedded = await db.select({ name: sql<string>`n.name` })
      .from(sql`(VALUES ${candidates}) AS n(name)`)
      .where(sql`EXISTS (SELECT 1 FROM ${artifacts} WHERE ${artifacts.chatId} = ${chatId} AND strpos(${artifacts.content}, n.name) > 0)
        OR EXISTS (SELECT 1 FROM ${artifactVersions} JOIN ${artifacts} ON ${artifacts.id} = ${artifactVersions.artifactId}
          WHERE ${artifacts.chatId} = ${chatId} AND strpos(${artifactVersions.content}, n.name) > 0)`)
    const keep = new Set(embedded.map(r => r.name))
    return paths.filter(p => !(isGenerated(p) && keep.has(fileName(p))))
  } catch (e) {
    console.warn('[attachments] artifact lookup failed; keeping generated images:', e instanceof Error ? e.message : e)
    return paths.filter(p => !isGenerated(p))
  }
}

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
 * removed after the commit, best-effort (the paths are logged on failure) —
 * except generated images an artifact of the chat embeds (`pathsSafeToRemove`).
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
    // A generated image an artifact of this chat embeds stays (pathsSafeToRemove).
    const removable = await pathsSafeToRemove(chatId, storagePaths)
    if (removable.length > 0) {
      await removeObjects(removable).catch(e =>
        console.warn('[attachments] storage cleanup failed for paths:', removable, e instanceof Error ? e.message : e))
    }
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
