import { NextRequest, NextResponse } from 'next/server'
import { createUploadingDocument, updateDocumentStoragePath } from '@/app/actions'
import { isStorageConfigured, createSignedUploadUrl, storageBucketName } from '@/lib/storage'
import { MAX_FILE_SIZE, isSupported, isImageExtension, getExtension } from '@/lib/fileExtraction'
import { uploadUrlRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_')
}

export async function POST(request: NextRequest) {
  try {
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'File storage is not configured. Set Supabase Storage env vars.' }, { status: 503 })
    }
    const parsed = uploadUrlRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { projectId, filename, contentType, size } = parsed.data

    if (size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` }, { status: 400 })
    }
    const ext = getExtension(filename)
    const isImage = isImageExtension(ext) || contentType.startsWith('image/')
    if (!isSupported(filename, contentType) && !isImage) {
      return NextResponse.json({ error: `Unsupported file type: ${filename}.` }, { status: 400 })
    }

    const [doc] = await createUploadingDocument({
      projectId, filename, mimeType: contentType || 'application/octet-stream', fileSize: size,
    })
    const path = `documents/${projectId}/${doc.id}/${sanitize(filename)}`
    await updateDocumentStoragePath(doc.id, path)
    const { token } = await createSignedUploadUrl(path)

    return NextResponse.json({ documentId: doc.id, path, token, bucket: storageBucketName })
  } catch (error) {
    return apiError(error, 'Failed to start upload', 500, true)
  }
}
