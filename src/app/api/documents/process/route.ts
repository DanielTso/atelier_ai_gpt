import { NextRequest, NextResponse } from 'next/server'
import { getDocumentById, updateDocumentStatus, saveDocumentChunks, updateChunkEmbedding, createDocumentRevision, deleteDocumentChunks, applyDocumentReplacement } from '@/app/actions'
import { generateEmbedding, ensureEmbeddingModel } from '@/lib/embeddings'
import { chunkText } from '@/lib/chunking'
import { MAX_TEXT_LENGTH, getExtension, isImageExtension, extractTextFromBuffer } from '@/lib/fileExtraction'
import { extractViaVision, extractViaVisionImage } from '@/lib/visionExtraction'
import { downloadToBuffer, uploadBuffer } from '@/lib/storage'
import { generatePdfThumbnail, generateImageThumbnail } from '@/lib/thumbnails'
import { processDocumentRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

const MIN_TEXT = Number(process.env.EXTRACTION_MIN_TEXT_CHARS) || 100

export async function POST(request: NextRequest) {
  try {
    const parsed = processDocumentRequestSchema.safeParse(await request.json())
    if (!parsed.success) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })

    const doc = await getDocumentById(parsed.data.documentId)
    if (!doc || !doc.storagePath) return NextResponse.json({ error: 'Document not found' }, { status: 404 })

    // Replace flow: process the new revision file + metadata (sent by the client);
    // the document's current file/metadata stay until we successfully apply.
    const isReplace = !!parsed.data.storagePath
    const sourcePath = parsed.data.storagePath ?? doc.storagePath
    const effFilename = parsed.data.filename ?? doc.filename
    const effMimeType = parsed.data.mimeType ?? doc.mimeType
    const effFileSize = parsed.data.fileSize ?? doc.fileSize
    const nextRevision = doc.revision + 1

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
        textContent = await extractViaVisionImage(buffer, effMimeType)
        extractionMethod = 'vision'
      } else {
        textContent = await extractTextFromBuffer(buffer, ext)
        if (ext === 'pdf' && textContent.trim().length < MIN_TEXT) {
          const vision = await extractViaVision(buffer)
          if (vision.trim().length > textContent.trim().length) {
            textContent = vision
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
    if (textContent.length > MAX_TEXT_LENGTH) {
      console.warn(`[documents/process] ${doc.filename}: content truncated ${textContent.length} -> ${MAX_TEXT_LENGTH}`)
      textContent = textContent.slice(0, MAX_TEXT_LENGTH)
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

    // Extraction succeeded. On replace, snapshot the superseded revision (its file
    // stays in Storage for the audit trail) and clear its chunks before re-chunking.
    if (isReplace) {
      await createDocumentRevision({
        documentId: doc.id, projectId: doc.projectId, revision: doc.revision,
        filename: doc.filename, mimeType: doc.mimeType, fileSize: doc.fileSize,
        storagePath: doc.storagePath, thumbnailPath: doc.thumbnailPath,
        charCount: doc.charCount, chunkCount: doc.chunkCount, extractionMethod: doc.extractionMethod,
      })
      await deleteDocumentChunks(doc.id)
    }

    const textChunks = chunkText(textContent)
    const saved = await saveDocumentChunks(textChunks.map(c => ({
      documentId: doc.id, projectId: doc.projectId, chunkIndex: c.index, content: c.content,
    })))
    const results = await Promise.allSettled(saved.map(async (chunk) => {
      const embedding = await generateEmbedding(chunk.content, 'document')
      await updateChunkEmbedding(chunk.id, embedding)
    }))
    const embedded = results.filter(r => r.status === 'fulfilled').length
    if (results.length - embedded > 0) {
      console.warn(`[documents/process] ${results.length - embedded}/${saved.length} chunks failed to embed`)
    }
    const status = embedded === 0 && saved.length > 0 ? 'error' : 'ready'
    if (isReplace) {
      // Swap the active revision in place: new file metadata + bump revision.
      await applyDocumentReplacement(doc.id, {
        filename: effFilename, mimeType: effMimeType, fileSize: effFileSize, storagePath: sourcePath,
        thumbnailPath, charCount: textContent.length, chunkCount: saved.length, extractionMethod, revision: nextRevision,
      })
      if (status === 'error') {
        await updateDocumentStatus(doc.id, 'error', { errorMessage: 'New revision saved but embeddings failed.' })
      }
    } else {
      await updateDocumentStatus(doc.id, status, { chunkCount: saved.length, charCount: textContent.length, thumbnailPath, extractionMethod })
    }

    return NextResponse.json({ documentId: doc.id, status, revision: isReplace ? nextRevision : doc.revision, chunkCount: saved.length, charCount: textContent.length })
  } catch (error) {
    return apiError(error, 'Failed to process document', 500, true)
  }
}
