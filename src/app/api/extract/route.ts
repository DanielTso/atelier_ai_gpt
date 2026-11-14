import { NextRequest, NextResponse } from 'next/server'
import { getExtension, validateUploadedFile, extractTextFromBuffer, isSupported, MAX_FILE_SIZE, CHAT_ATTACHMENT_MAX_CHARS } from '@/lib/fileExtraction'
import { isStorageConfigured, downloadToBuffer, removeObjects } from '@/lib/storage'
import { parsePendingAttachmentPath } from '@/lib/attachmentPaths'
import { extractRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

// The storage path accepts files up to MAX_FILE_SIZE (200 MB): give a large PDF's
// text extraction room beyond the default function timeout.
export const maxDuration = 300

// Chat-attachment text is capped at CHAT_ATTACHMENT_MAX_CHARS (see fileExtraction.ts);
// the cap also keeps this response under the platform's response-size limit.
function extractResponse(filename: string, mimeType: string, text: string, partial: boolean) {
  const truncated = partial || text.length > CHAT_ATTACHMENT_MAX_CHARS
  const textContent = text.length > CHAT_ATTACHMENT_MAX_CHARS ? text.slice(0, CHAT_ATTACHMENT_MAX_CHARS) : text
  return NextResponse.json({ filename, mimeType, textContent, charCount: textContent.length, truncated })
}

// Two ways in:
// - JSON `{ chatId, storagePath, mediaType? }` — the file was uploaded straight to
//   Storage (POST /api/attachments/upload-url), so it never crossed Vercel's
//   4.5 MB request-body limit. This is the normal path for chat attachments.
// - multipart `file` — the fallback when Storage isn't configured; the client
//   only uses it for files of at most 4 MB.
export async function POST(request: NextRequest) {
  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    return extractFromStorage(request)
  }
  try {
    const formData = await request.formData()
    const file = formData.get('file') as File | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    const validationError = validateUploadedFile(file.name, file.type, file.size)
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 })
    }

    const ext = getExtension(file.name)
    const buffer = Buffer.from(await file.arrayBuffer())
    const { text, partial } = await extractTextFromBuffer(buffer, ext)
    return extractResponse(file.name, file.type, text, partial)
  } catch (error) {
    return apiError(error, 'Failed to extract text from file', 500)
  }
}

async function extractFromStorage(request: NextRequest) {
  let storagePath: string | null = null
  try {
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'File storage is not configured. Set Supabase Storage env vars.' }, { status: 503 })
    }
    const parsed = extractRequestSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { chatId, mediaType = '' } = parsed.data

    // Only this chat's pending uploads — never another chat's files, a saved
    // message attachment or a project document.
    const pending = parsePendingAttachmentPath(parsed.data.storagePath, chatId)
    if (!pending) return NextResponse.json({ error: 'Invalid storage path' }, { status: 400 })
    storagePath = parsed.data.storagePath
    const { filename } = pending

    if (!isSupported(filename, mediaType)) {
      return NextResponse.json({ error: `Unsupported file type: ${filename}. Supported: PDF, Word (.docx), Excel (.xlsx), and text/code files.` }, { status: 400 })
    }

    const buffer = await downloadToBuffer(storagePath)
    // The signed upload was minted for a declared size; check what actually landed.
    if (buffer.length > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` }, { status: 400 })
    }
    const { text, partial } = await extractTextFromBuffer(buffer, getExtension(filename))
    return extractResponse(filename, mediaType, text, partial)
  } catch (error) {
    return apiError(error, 'Failed to extract text from file', 500)
  } finally {
    // The object only existed to be extracted — the text travels in the message.
    if (storagePath) await removeObjects([storagePath]).catch(() => {})
  }
}
