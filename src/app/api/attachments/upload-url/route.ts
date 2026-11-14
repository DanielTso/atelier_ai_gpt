import { NextRequest, NextResponse } from 'next/server'
import { isStorageConfigured, createSignedUploadUrl, storageBucketName, sanitizeStorageName } from '@/lib/storage'
import { MAX_FILE_SIZE, isSupported } from '@/lib/fileExtraction'
import { buildPendingAttachmentPath } from '@/lib/attachmentPaths'
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
    return NextResponse.json({ path, token, bucket: storageBucketName })
  } catch (error) {
    return apiError(error, 'Failed to start upload', 500, true)
  }
}
