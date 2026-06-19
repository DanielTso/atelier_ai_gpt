import { NextRequest, NextResponse } from 'next/server'
import { createUploadingDocument, updateDocumentStoragePath, getDocumentById, updateDocumentStatus } from '@/app/actions'
import { isStorageConfigured, createSignedUploadUrl, storageBucketName } from '@/lib/storage'
import { MAX_FILE_SIZE, isSupported, isImageExtension, getExtension } from '@/lib/fileExtraction'
import { uploadUrlRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

function sanitize(name: string): string {
  // Replace path/special chars, and collapse an all-dots name (".", "..") to "_"
  // so it can't normalize to a parent prefix in the storage path.
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_')
}

export async function POST(request: NextRequest) {
  try {
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'File storage is not configured. Set Supabase Storage env vars.' }, { status: 503 })
    }
    const parsed = uploadUrlRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { projectId, filename, contentType, size, replaceDocumentId } = parsed.data

    if (size > MAX_FILE_SIZE) {
      return NextResponse.json({ error: `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.` }, { status: 400 })
    }
    const ext = getExtension(filename)
    const isImage = isImageExtension(ext) || contentType.startsWith('image/')
    if (!isSupported(filename, contentType) && !isImage) {
      return NextResponse.json({ error: `Unsupported file type: ${filename}.` }, { status: 400 })
    }

    // Replace flow: upload a new revision of an existing document. Keep the old
    // file/path reachable (do NOT overwrite doc.storagePath) — the process step
    // snapshots it and the new path is returned to the client for the process call.
    if (replaceDocumentId) {
      const existing = await getDocumentById(replaceDocumentId)
      if (!existing) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      const newPath = `documents/${existing.projectId}/${existing.id}/rev${existing.revision + 1}/${sanitize(filename)}`
      await updateDocumentStatus(existing.id, 'uploading')
      const { token } = await createSignedUploadUrl(newPath)
      return NextResponse.json({ documentId: existing.id, path: newPath, token, bucket: storageBucketName })
    }

    if (!projectId) return NextResponse.json({ error: 'projectId is required for a new upload' }, { status: 400 })
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
