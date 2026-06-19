import { NextRequest, NextResponse } from 'next/server'
import { getProjectDocuments, getDocumentById, deleteDocument, getDocumentRevisions } from '@/app/actions'
import { createSignedDownloadUrl, removeObjects } from '@/lib/storage'

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const projectId = Number(searchParams.get('projectId'))
  if (!projectId || isNaN(projectId)) {
    return NextResponse.json({ error: 'Invalid projectId' }, { status: 400 })
  }
  const docs = await getProjectDocuments(projectId)
  const withUrls = await Promise.all(docs.map(async (d) => {
    const [url, thumbnailUrl] = await Promise.all([
      d.storagePath ? createSignedDownloadUrl(d.storagePath).catch(() => null) : Promise.resolve(null),
      d.thumbnailPath ? createSignedDownloadUrl(d.thumbnailPath).catch(() => null) : Promise.resolve(null),
    ])
    return { ...d, url, thumbnailUrl }
  }))
  return NextResponse.json({ documents: withUrls })
}

export async function DELETE(request: NextRequest) {
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
}
