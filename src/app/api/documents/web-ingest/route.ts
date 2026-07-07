import { NextRequest, NextResponse } from 'next/server'
import { isTavilyConfigured, extractUrl } from '@/lib/tavily'
import { ingestText } from '@/lib/ingest'
import { createUploadingDocument, updateDocumentStatus, updateDocumentStoragePath, getDocumentById } from '@/app/actions'
import { ensureEmbeddingModel } from '@/lib/embeddings'
import { isStorageConfigured, uploadBuffer, createSignedDownloadUrl, DOCUMENT_URL_TTL_SECONDS } from '@/lib/storage'
import { DOCUMENT_MAX_CHARS } from '@/lib/fileExtraction'
import { webIngestRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

// Tavily extract + chunk + embed can run long on a large page; give it headroom.
export const maxDuration = 800

export async function POST(request: NextRequest) {
  let docId: number | null = null
  try {
    const parsed = webIngestRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    const { url, projectId } = parsed.data

    if (!(await isTavilyConfigured())) return NextResponse.json({ error: 'Set a Tavily API key in Settings.' }, { status: 503 })
    if (!isStorageConfigured()) return NextResponse.json({ error: 'Storage is not configured.' }, { status: 503 })
    if (!(await ensureEmbeddingModel()).available) return NextResponse.json({ error: 'No embedding provider available. Set a Gemini API key.' }, { status: 503 })

    let title: string
    let markdown: string
    try {
      ({ title, markdown } = await extractUrl(url))
    } catch (e) {
      const empty = e instanceof Error && e.message === 'No content extracted'
      return NextResponse.json(
        { error: empty ? 'No content could be extracted from that URL.' : 'Failed to fetch that URL.' },
        { status: empty ? 422 : 502 },
      )
    }

    let text = `Source: ${url}\n\n${markdown}`
    // Over the ceiling → drop the tail AND flag partial (no silent loss, same as file ingest).
    const partial = text.length > DOCUMENT_MAX_CHARS
    if (partial) text = text.slice(0, DOCUMENT_MAX_CHARS)

    const [doc] = await createUploadingDocument({
      projectId, filename: title, mimeType: 'text/markdown', fileSize: Buffer.byteLength(text, 'utf-8'),
    })
    docId = doc.id
    await updateDocumentStatus(doc.id, 'processing')

    const storagePath = `documents/${projectId}/${doc.id}/source.md`
    await uploadBuffer(storagePath, Buffer.from(text, 'utf-8'), 'text/markdown')
    await updateDocumentStoragePath(doc.id, storagePath)

    const { status } = await ingestText({ id: doc.id, projectId }, text, { extractionMethod: 'text', partial })

    const fresh = await getDocumentById(doc.id)
    const signedUrl = await createSignedDownloadUrl(storagePath, DOCUMENT_URL_TTL_SECONDS).catch(() => null)
    return NextResponse.json({ document: { ...fresh, url: signedUrl, thumbnailUrl: null }, status })
  } catch (error) {
    if (docId) await updateDocumentStatus(docId, 'error', { errorMessage: 'Failed to ingest URL.' }).catch(() => {})
    return apiError(error, 'Failed to ingest URL', 500)
  }
}
