// Storage paths for chat attachments that are uploaded only to be text-extracted
// (POST /api/attachments/upload-url → uploadToSignedUrl → POST /api/extract).
// The object is transient: /api/extract deletes it once the text is out.
//
//   attachments/<chatId>/pending/<uuid>-<sanitized name>
//
// Before the first message of a new chat there is no chat id yet (the chat is
// created on send), so those uploads use the `compose` segment instead.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PENDING_NAME = new RegExp(`^${UUID}-([A-Za-z0-9._-]{1,255})$`)

export function pendingAttachmentPrefix(chatId: number | null): string {
  return `attachments/${chatId ?? 'compose'}/pending/`
}

/** `sanitizedName` must already be a single safe path segment (sanitizeStorageName). */
export function buildPendingAttachmentPath(chatId: number | null, sanitizedName: string, uuid: string = crypto.randomUUID()): string {
  return `${pendingAttachmentPrefix(chatId)}${uuid}-${sanitizedName}`
}

/**
 * The original (sanitized) file name when `path` is a pending upload for this
 * chat, else null. The whole remainder must be one `<uuid>-<name>` segment, so a
 * path into another chat, a saved message attachment, a project document or a
 * `..` traversal is refused before anything is read.
 */
export function parsePendingAttachmentPath(path: string, chatId: number | null): { filename: string } | null {
  const prefix = pendingAttachmentPrefix(chatId)
  if (!path.startsWith(prefix)) return null
  const match = PENDING_NAME.exec(path.slice(prefix.length))
  if (!match || /^\.+$/.test(match[1])) return null
  return { filename: match[1] }
}
