'use client'

import type { AttachedFile } from '@/lib/fileAttachments'
import { readError } from '@/lib/readError'

// Vercel rejects request bodies over 4.5 MB before the function runs, so the
// multipart fallback is only attempted for files that fit with headroom.
export const MULTIPART_EXTRACT_LIMIT = 4 * 1024 * 1024

interface ExtractResponse {
  charCount: number
  textContent: string
  truncated: boolean
}

function toAttachedFile(file: File, data: ExtractResponse): AttachedFile {
  return {
    name: file.name,
    type: file.type,
    size: file.size,
    charCount: data.charCount,
    textContent: data.textContent,
    truncated: data.truncated,
  }
}

/**
 * Normal path: signed upload straight to Storage, then extract by storage path —
 * the file never crosses the platform body limit. Returns null when Storage is
 * unavailable (not configured, or the upload itself failed) so the caller can
 * fall back; throws with a user-facing message on a definitive refusal.
 */
async function extractViaStorage(file: File, chatId: number | null, mediaType: string): Promise<AttachedFile | null> {
  const urlRes = await fetch('/api/attachments/upload-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chatId, filename: file.name, mediaType, size: file.size }),
  }).catch(() => null)
  if (!urlRes) return null
  // 400 = too large / unsupported type: retrying another way can't help.
  if (urlRes.status === 400) throw new Error(await readError(urlRes, `Failed to process ${file.name}`))
  if (!urlRes.ok) return null

  const signed: { path: string; token: string; bucket: string } | null = await urlRes.json().catch(() => null)
  if (!signed) return null
  const { path, token, bucket } = signed
  try {
    const { getBrowserSupabase } = await import('@/lib/storageClient')
    const { error } = await getBrowserSupabase().storage.from(bucket).uploadToSignedUrl(path, token, file)
    if (error) return null
  } catch {
    return null
  }

  const res = await fetch('/api/extract', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chatId, storagePath: path, mediaType }),
  })
  if (!res.ok) throw new Error(await readError(res, `Failed to process ${file.name}`))
  return toAttachedFile(file, await res.json())
}

/**
 * Extract a non-image chat attachment's text. Throws an Error whose message is
 * ready to show the user (size limits included).
 */
export async function extractAttachedFile(file: File, chatId: number | null): Promise<AttachedFile> {
  const mediaType = file.type || 'application/octet-stream'
  const viaStorage = await extractViaStorage(file, chatId, mediaType)
  if (viaStorage) return viaStorage

  if (file.size > MULTIPART_EXTRACT_LIMIT) {
    throw new Error(`${file.name} is too large to attach without file storage (max 4 MB)`)
  }
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/extract', { method: 'POST', body: formData })
  if (!res.ok) throw new Error(await readError(res, `Failed to process ${file.name}`))
  return toAttachedFile(file, await res.json())
}
