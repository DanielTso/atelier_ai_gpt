import { NextRequest, NextResponse } from 'next/server'
import { createUploadingDocument, updateDocumentStoragePath, getDocumentById, deleteDocument } from '@/app/actions'
import { isStorageConfigured, createSignedUploadUrl, storageBucketName, sanitizeStorageName as sanitize } from '@/lib/storage'
import { MAX_FILE_SIZE, isSupported, isImageUpload, getExtension } from '@/lib/fileExtraction'
import { uploadUrlRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

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
    // Allow-listed raster formats only — a client-declared image/* MIME must not
    // smuggle in svg (scriptable) or formats the vision pipeline can't process.
    const isImage = isImageUpload(ext, contentType)
    if (!isSupported(filename, contentType) && !isImage) {
      return NextResponse.json({ error: `Unsupported file type: ${filename}.` }, { status: 400 })
    }

    // Replace flow: upload a new revision of an existing document. Keep the old
    // file/path reachable (do NOT overwrite doc.storagePath) — the process step
    // snapshots it and the new path is returned to the client for the process call.
    // The status is left alone (audit X7): the previous revision stays active and
    // listed while the browser uploads, so an abandoned replace changes nothing.
    // /api/documents/process claims the document when the upload has landed.
    if (replaceDocumentId) {
      const existing = await getDocumentById(replaceDocumentId)
      if (!existing) return NextResponse.json({ error: 'Document not found' }, { status: 404 })
      const newPath = `documents/${existing.projectId}/${existing.id}/rev${existing.revision + 1}/${sanitize(filename)}`
      // upsert: replacing a revision may be retried at the same rev path.
      const { token } = await createSignedUploadUrl(newPath, { upsert: true })
      return NextResponse.json({ documentId: existing.id, path: newPath, token, bucket: storageBucketName })
    }

    if (!projectId) return NextResponse.json({ error: 'projectId is required for a new upload' }, { status: 400 })
    const [doc] = await createUploadingDocument({
      projectId, filename, mimeType: contentType || 'application/octet-stream', fileSize: size,
    })
    // The path needs the row id, so the row comes first; if setting the path or
    // signing fails, delete the row rather than leave an 'uploading' orphan for
    // the 60-minute reaper (audit B25).
    const path = `documents/${projectId}/${doc.id}/${sanitize(filename)}`
    let token: string
    try {
      await updateDocumentStoragePath(doc.id, path)
      token = (await createSignedUploadUrl(path)).token
    } catch (e) {
      await deleteDocument(doc.id).catch(() => {})
      throw e
    }

    return NextResponse.json({ documentId: doc.id, path, token, bucket: storageBucketName })
  } catch (error) {
    return apiError(error, 'Failed to start upload', 500, true)
  }
}
