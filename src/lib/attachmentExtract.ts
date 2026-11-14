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

// Why the Storage path didn't produce a result, when it didn't throw.
type StorageMiss =
  | { kind: 'unavailable' }                    // not configured / upload URL unreachable
  | { kind: 'upload-failed'; reason: string }  // Storage is there, but the upload itself failed

// Storage error text is shown to the user only when it is short and plain; it is
// a Supabase message (e.g. the bucket's size limit), never a secret.
function uploadFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : ''
  return message && message.length <= 200 && !/[<>]/.test(message) ? message : 'the upload failed'
}

/**
 * Normal path: signed upload straight to Storage, then extract by storage path —
 * the file never crosses the platform body limit. Returns a StorageMiss when the
 * caller may fall back to multipart; throws with a user-facing message on a
 * definitive refusal.
 */
async function extractViaStorage(file: File, chatId: number | null, mediaType: string): Promise<AttachedFile | StorageMiss> {
  const unavailable: StorageMiss = { kind: 'unavailable' }
  const urlRes = await fetch('/api/attachments/upload-url', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chatId, filename: file.name, mediaType, size: file.size }),
  }).catch(() => null)
  if (!urlRes) return unavailable
  // 400 = too large / unsupported type: retrying another way can't help.
  if (urlRes.status === 400) throw new Error(await readError(urlRes, `Failed to process ${file.name}`))
  if (!urlRes.ok) return unavailable

  const signed: { path: string; token: string; bucket: string } | null = await urlRes.json().catch(() => null)
  if (!signed) return unavailable
  const { path, token, bucket } = signed
  try {
    const { getBrowserSupabase } = await import('@/lib/storageClient')
    const { error } = await getBrowserSupabase().storage.from(bucket).uploadToSignedUrl(path, token, file)
    if (error) return { kind: 'upload-failed', reason: uploadFailureReason(error) }
  } catch (e) {
    return { kind: 'upload-failed', reason: uploadFailureReason(e) }
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
  if (!('kind' in viaStorage)) return viaStorage

  if (file.size > MULTIPART_EXTRACT_LIMIT) {
    throw new Error(viaStorage.kind === 'upload-failed'
      ? `Couldn't upload ${file.name}: ${viaStorage.reason}`
      : `${file.name} is too large to attach without file storage (max 4 MB)`)
  }
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch('/api/extract', { method: 'POST', body: formData })
  if (!res.ok) throw new Error(await readError(res, `Failed to process ${file.name}`))
  return toAttachedFile(file, await res.json())
}
