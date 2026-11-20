// Best-effort sweeps of chat-attachment Storage prefixes that no DB row anchors:
// `attachments/<chatId|compose>/pending/` (uploads awaiting /api/extract, which
// deletes them — unless the extract call never arrives) and, on chat delete,
// `attachments/<chatId>/generated/` (images kept because an artifact embeds them).
import { isStorageConfigured, listObjects, removeObjects } from '@/lib/storage'

// A pending upload is extracted seconds after it lands; one still there after an
// hour was abandoned (tab closed, network drop).
export const PENDING_ATTACHMENT_MAX_AGE_MS = 60 * 60 * 1000

/**
 * Remove the objects directly under `prefix` created more than `olderThanMs` ago
 * (every listed object when `olderThanMs` is 0; otherwise one with no creation
 * time is kept). Resolves to the number removed — 0 on any failure, logged — and
 * never throws. No-op when Storage is not configured.
 */
export async function sweepPrefix(prefix: string, olderThanMs: number, now = Date.now()): Promise<number> {
  if (!isStorageConfigured()) return 0
  const folder = prefix.replace(/\/+$/, '')
  // Never sweep the bucket root.
  if (!folder) return 0
  try {
    const listed = await listObjects(folder)
    const stale = listed.filter(o => {
      // Only objects directly inside the prefix.
      if (!o.name || o.name.includes('/')) return false
      if (olderThanMs === 0) return true
      if (!o.createdAt) return false
      const created = Date.parse(o.createdAt)
      return Number.isFinite(created) && now - created > olderThanMs
    })
    if (stale.length === 0) return 0
    await removeObjects(stale.map(o => `${folder}/${o.name}`))
    return stale.length
  } catch (e) {
    console.warn('[attachments] sweep failed for prefix:', folder, e instanceof Error ? e.message : e)
    return 0
  }
}
