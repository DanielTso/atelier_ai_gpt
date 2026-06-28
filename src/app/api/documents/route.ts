import { NextRequest, NextResponse } from 'next/server'
import { getProjectDocuments, getDocumentById, deleteDocument, getDocumentRevisions } from '@/app/actions'
import { createSignedDownloadUrls, removeObjects, DOCUMENT_URL_TTL_SECONDS } from '@/lib/storage'
import { apiError } from '@/lib/errors'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const projectId = Number(searchParams.get('projectId'))
    if (!projectId || isNaN(projectId)) {
      return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 })
    }
    const docs = await getProjectDocuments(projectId)
    const originalPaths = docs.map(d => d.storagePath).filter((p): p is string => Boolean(p))
    const thumbnailPaths = docs.map(d => d.thumbnailPath).filter((p): p is string => Boolean(p))
    const [originalUrls, thumbnailUrls] = await Promise.all([
      createSignedDownloadUrls(originalPaths, DOCUMENT_URL_TTL_SECONDS),
      createSignedDownloadUrls(thumbnailPaths, DOCUMENT_URL_TTL_SECONDS),
    ])
    const withUrls = docs.map(d => ({
      ...d,
      url: d.storagePath ? (originalUrls.get(d.storagePath) ?? null) : null,
      thumbnailUrl: d.thumbnailPath ? (thumbnailUrls.get(d.thumbnailPath) ?? null) : null,
    }))
    return NextResponse.json({ documents: withUrls })
  } catch (error) {
    return apiError(error, 'Failed to load documents', 500)
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = Number(searchParams.get('id'))
    if (!id || isNaN(id)) {
      return NextResponse.json({ error: 'Invalid document id' }, { status: 400 })
    }
    const doc = await getDocumentById(id)
    if (doc) {
      // Sweep the current file + all retained revision files (revision rows cascade in the DB).
      const revisions = await getDocumentRevisions(id)
      const paths = [
        doc.storagePath, doc.thumbnailPath,
        ...revisions.flatMap(r => [r.storagePath, r.thumbnailPath]),
      ].filter((p): p is string => Boolean(p))
      await removeObjects(paths).catch((e) => {
        console.warn('[documents] storage cleanup failed:', e instanceof Error ? e.message : e)
      })
    }
    await deleteDocument(id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return apiError(error, 'Failed to delete document', 500)
  }
}
