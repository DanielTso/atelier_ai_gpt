import { NextRequest, NextResponse, after } from 'next/server'
import { isStorageConfigured, createSignedUploadUrl, storageBucketName, sanitizeStorageName } from '@/lib/storage'
import { MAX_FILE_SIZE, isSupported } from '@/lib/fileExtraction'
import { buildPendingAttachmentPath, pendingAttachmentPrefix } from '@/lib/attachmentPaths'
import { sweepPrefix, PENDING_ATTACHMENT_MAX_AGE_MS } from '@/lib/attachmentSweep'
import { attachmentUploadUrlRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

// Step 1 of a chat attachment's text extraction: mint a signed upload so the
// browser sends the file straight to Storage, never through a Vercel function
// body (4.5 MB limit). The client then calls POST /api/extract { storagePath }.
// Images never come here — they go inline with the chat message.
export async function POST(request: NextRequest) {
  try {
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'File storage is not configured. Set Supabase Storage env vars.' }, { status: 503 })
    }
    const parsed = attachmentUploadUrlRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { chatId, filename, mediaType, size } = parsed.data

    if (size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` }, { status: 400 })
    }
    if (!isSupported(filename, mediaType)) {
      return NextResponse.json({ error: `Unsupported file type: ${filename}. Supported: PDF, Word (.docx), Excel (.xlsx), and text/code files.` }, { status: 400 })
    }

    const path = buildPendingAttachmentPath(chatId, sanitizeStorageName(filename))
    const { token } = await createSignedUploadUrl(path)
    const response = NextResponse.json({ path, token, bucket: storageBucketName })

    // Sweep this scope's abandoned pending uploads (an extract call that never
    // arrived) once the response is out. Best-effort: never affects the response.
    // Outside a request scope (unit tests) after() throws; run it un-awaited.
    const sweep = () => sweepPrefix(pendingAttachmentPrefix(chatId), PENDING_ATTACHMENT_MAX_AGE_MS).catch(() => 0)
    try {
      after(sweep)
    } catch {
      void sweep()
    }
    return response
  } catch (error) {
    return apiError(error, 'Failed to start upload', 500, true)
  }
}
