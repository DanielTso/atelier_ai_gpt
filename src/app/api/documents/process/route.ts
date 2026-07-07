import { NextRequest, NextResponse } from 'next/server'
import { getDocumentById, updateDocumentStatus, createDocumentRevision, commitDocumentReplacement } from '@/app/actions'
import { generateEmbedding, ensureEmbeddingModel } from '@/lib/embeddings'
import { chunkText } from '@/lib/chunking'
import { ingestText } from '@/lib/ingest'
import { MAX_FILE_SIZE, DOCUMENT_MAX_CHARS, getExtension, isImageExtension, isSupported, extractTextFromBuffer } from '@/lib/fileExtraction'
import { extractViaVision, extractViaVisionImage } from '@/lib/visionExtraction'
import { downloadToBuffer, uploadBuffer, sanitizeStorageName } from '@/lib/storage'
import { generatePdfThumbnail, generateImageThumbnail } from '@/lib/thumbnails'
import { processDocumentRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

// A 30-page vision run is serial (bounded concurrency deferred to Batch B), so give
// the function a generous budget. Pairs with the stale-processing reaper: even if the
// platform still kills the function, a stuck row is flipped to error on the next list.
export const maxDuration = 800

const MIN_TEXT = Number(process.env.EXTRACTION_MIN_TEXT_CHARS) || 100

export async function POST(request: NextRequest) {
  try {
    const parsed = processDocumentRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const doc = await getDocumentById(parsed.data.documentId)
    if (!doc || !doc.storagePath) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    // Replace flow: marked by the client sending the new file's metadata. The new
    // revision's storage path is DERIVED here (same construction as upload-url),
    // never taken from the request — so a caller can't process an arbitrary object.
    const isReplace = !!parsed.data.filename
    const effFilename = parsed.data.filename ?? doc.filename
    const effMimeType = parsed.data.mimeType ?? doc.mimeType
    const effFileSize = parsed.data.fileSize ?? doc.fileSize
    const nextRevision = doc.revision + 1
    const sourcePath = isReplace
      ? `documents/${doc.projectId}/${doc.id}/rev${nextRevision}/${sanitizeStorageName(effFilename)}`
      : doc.storagePath

    // Replace flow: the client declares the new file's type/size, so re-validate it
    // here the same way /api/documents/upload-url does before issuing the signed URL.
    // (The storage path is already derived server-side above, so traversal isn't the
    // risk — this just keeps the two halves of the upload flow on one validation
    // contract and refuses to route an unsupported/oversized object into the extractor.)
    if (isReplace) {
      const replExt = getExtension(effFilename)
      const replIsImage = isImageExtension(replExt) || effMimeType.startsWith('image/')
      if (!replIsImage && !isSupported(effFilename, effMimeType)) {
        return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
      }
      if (effFileSize > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'File too large' }, { status: 400 })
      }
    }

    const { available } = await ensureEmbeddingModel()
    if (!available) {
      await updateDocumentStatus(doc.id, 'error', { errorMessage: 'No embedding provider available.' })
      return NextResponse.json({ error: 'No embedding provider available. Set a Gemini API key.' }, { status: 503 })
    }

    await updateDocumentStatus(doc.id, 'processing')
    const ext = getExtension(effFilename)
    const isImage = isImageExtension(ext) || effMimeType.startsWith('image/')

    let buffer: Buffer
    try {
      buffer = await downloadToBuffer(sourcePath)
    } catch (e) {
      await updateDocumentStatus(doc.id, 'error', { errorMessage: 'Failed to download uploaded file.' })
      return apiError(e, 'Failed to download uploaded file', 500, false)
    }

    let textContent = ''
    let extractionMethod: 'text' | 'vision' = 'text'
    try {
      if (isImage) {
        const r = await extractViaVisionImage(buffer, effMimeType)
        textContent = r.text
        extractionMethod = 'vision'
      } else {
        const r = await extractTextFromBuffer(buffer, ext)
        textContent = r.text
        if (ext === 'pdf' && textContent.trim().length < MIN_TEXT) {
          const v = await extractViaVision(buffer)
          if (v.text.trim().length > textContent.trim().length) {
            textContent = v.text
            extractionMethod = 'vision'
          }
        }
      }
    } catch (e) {
      // A corrupt PDF/DOCX/XLSX can throw in the extractor — reach a terminal
      // status rather than leaving the row stuck in 'processing'.
      await updateDocumentStatus(doc.id, 'error', { errorMessage: 'Failed to extract document content.' })
      return apiError(e, 'Failed to extract document content', 500, false)
    }
    if (textContent.length > DOCUMENT_MAX_CHARS) {
      console.warn(`[documents/process] ${doc.filename}: content truncated ${textContent.length} -> ${DOCUMENT_MAX_CHARS}`)
      textContent = textContent.slice(0, DOCUMENT_MAX_CHARS)
    }
    if (!textContent.trim()) {
      await updateDocumentStatus(doc.id, 'error', { errorMessage: 'No text content could be extracted.' })
      return NextResponse.json({ error: 'No text content could be extracted.' }, { status: 400 })
    }

    let thumbnailPath: string | undefined
    try {
      const thumb = isImage
        ? await generateImageThumbnail(buffer)
        : ext === 'pdf' ? await generatePdfThumbnail(buffer) : undefined
      if (thumb) {
        // Revision-scoped path on replace so the prior thumbnail is retained.
        thumbnailPath = `documents/${doc.projectId}/${doc.id}/${isReplace ? `rev${nextRevision}/` : ''}thumb.webp`
        await uploadBuffer(thumbnailPath, thumb, 'image/webp')
      }
    } catch (e) {
      console.warn('[documents/process] thumbnail failed:', e instanceof Error ? e.message : e)
      thumbnailPath = undefined
    }

    if (isReplace) {
      const textChunks = chunkText(textContent)
      // Replace: embed FIRST (no destructive writes yet), then snapshot the old
      // revision and atomically swap (delete old chunks + insert new + update row).
      // If embedding/commit fails the prior revision stays fully intact.
      const embRes = await Promise.allSettled(textChunks.map(c => generateEmbedding(c.content, 'document')))
      const chunkRows = textChunks.map((c, i) => {
        const r = embRes[i]
        return { chunkIndex: c.index, content: c.content, embedding: r && r.status === 'fulfilled' ? r.value : null }
      })
      const embedded = embRes.filter(r => r.status === 'fulfilled').length
      if (textChunks.length - embedded > 0) {
        console.warn(`[documents/process] ${textChunks.length - embedded}/${textChunks.length} chunks failed to embed`)
      }
      const status: 'ready' | 'error' = embedded === 0 && textChunks.length > 0 ? 'error' : 'ready'

      await createDocumentRevision({
        documentId: doc.id, projectId: doc.projectId, revision: doc.revision,
        filename: doc.filename, mimeType: doc.mimeType, fileSize: doc.fileSize,
        storagePath: doc.storagePath, thumbnailPath: doc.thumbnailPath,
        charCount: doc.charCount, chunkCount: doc.chunkCount, extractionMethod: doc.extractionMethod,
      })
      await commitDocumentReplacement(doc.id, doc.projectId, chunkRows, {
        filename: effFilename, mimeType: effMimeType, fileSize: effFileSize, storagePath: sourcePath,
        thumbnailPath, charCount: textContent.length, chunkCount: chunkRows.length, extractionMethod,
        revision: nextRevision, status,
        errorMessage: status === 'error' ? 'New revision saved but embeddings failed.' : null,
      })
      return NextResponse.json({ documentId: doc.id, status, revision: nextRevision, chunkCount: chunkRows.length, charCount: textContent.length })
    }

    // New upload: chunk → save → embed → status via the shared ingestion tail.
    const { status, chunkCount } = await ingestText({ id: doc.id, projectId: doc.projectId }, textContent, { extractionMethod, thumbnailPath })
    return NextResponse.json({ documentId: doc.id, status, revision: doc.revision, chunkCount, charCount: textContent.length })
  } catch (error) {
    return apiError(error, 'Failed to process document', 500)
  }
}
