import { NextRequest, NextResponse } from 'next/server'
import { getDocumentById, updateDocumentStatus, createDocumentRevision, commitDocumentReplacement } from '@/app/actions'
import { ensureEmbeddingModel } from '@/lib/embeddings'
import { chunkText } from '@/lib/chunking'
import { embedContents } from '@/lib/embedChunks'
import { ingestText } from '@/lib/ingest'
import { MAX_FILE_SIZE, DOCUMENT_MAX_CHARS, getExtension, isImageExtension, isSupported, extractTextFromBuffer } from '@/lib/fileExtraction'
import type { ExtractionResult } from '@/lib/fileExtraction'
import { extractViaVision, extractViaVisionImage, extractPagesViaVision } from '@/lib/visionExtraction'
import { downloadToBuffer, uploadBuffer, sanitizeStorageName } from '@/lib/storage'
import { generatePdfThumbnail, generateImageThumbnail } from '@/lib/thumbnails'
import { processDocumentRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

// Vision extraction is now segmented (≤500 pages → up to 25 segment calls, 2
// concurrent); this budget covers the worst case. Pairs with the stale-processing
// reaper: even if the platform still kills the function, a stuck row is flipped to
// error on the next list.
export const maxDuration = 800

const MIN_TEXT = Number(process.env.EXTRACTION_MIN_TEXT_CHARS) || 100
const MIN_CHARS_PER_PAGE = Number(process.env.EXTRACTION_MIN_CHARS_PER_PAGE) || 200
const HYBRID_MIN_CHARS = Number(process.env.EXTRACTION_HYBRID_PAGE_MIN_CHARS) || 500
const HYBRID_MAX_PAGES = Number(process.env.EXTRACTION_HYBRID_MAX_PAGES) || 80

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
    let extractionMethod: 'text' | 'vision' | 'hybrid' = 'text'
    let extraction: ExtractionResult = { text: '', pageCount: null, pagesExtracted: null, partial: false }
    try {
      if (isImage) {
        extraction = await extractViaVisionImage(buffer, effMimeType)
        textContent = extraction.text
        extractionMethod = 'vision'
      } else {
        extraction = await extractTextFromBuffer(buffer, ext)
        textContent = extraction.text
        // Vision fallback when the text layer is thin ABSOLUTELY (scanned doc) or thin
        // PER PAGE (CAD plan set: 120 pages of drawings with only title-block text —
        // enough chars to pass an absolute floor, but the drawings were never read).
        const trimmedLen = textContent.trim().length
        const sparsePerPage = extraction.pageCount != null && extraction.pageCount > 0 &&
          trimmedLen / extraction.pageCount < MIN_CHARS_PER_PAGE
        if (ext === 'pdf' && (trimmedLen < MIN_TEXT || sparsePerPage)) {
          // Vision is a stricter parser (pdf-lib): a PDF pdfjs read fine can throw
          // here. Isolate the fallback so a vision failure never discards usable text
          // — keep the existing textContent/extraction and ingest that instead.
          try {
            const v = await extractViaVision(buffer)
            if (v.text.trim().length > textContent.trim().length) {
              extraction = v
              textContent = v.text
              extractionMethod = 'vision'
            }
          } catch (e) {
            console.warn('[documents/process] vision fallback failed:', e instanceof Error ? e.message : e)
          }
        }
      }
    } catch (e) {
      // A corrupt PDF/DOCX/XLSX can throw in the extractor — reach a terminal
      // status rather than leaving the row stuck in 'processing'.
      await updateDocumentStatus(doc.id, 'error', { errorMessage: 'Failed to extract document content.' })
      return apiError(e, 'Failed to extract document content', 500, false)
    }

    // Per-page hybrid: a text-rich set can still contain SHX sheets whose notes text
    // is stroke geometry (title-block-only text layer). Vision-extract just those
    // pages and splice them in — never fatal, plain text path survives any failure.
    if (ext === 'pdf' && extractionMethod === 'text' && extraction.pageTexts) {
      const sparse = extraction.pageTexts
        .map((t, i) => ({ page: i + 1, len: t.trim().length }))
        .filter(p => p.len < HYBRID_MIN_CHARS)
        .map(p => p.page)
      if (sparse.length > 0 && sparse.length <= HYBRID_MAX_PAGES) {
        try {
          const hybrid = await extractPagesViaVision(buffer, sparse)
          if (hybrid.segments.length > 0) {
            const byStart = new Map(hybrid.segments.map(s => [s.firstPage, s]))
            const covered = new Set(hybrid.segments.flatMap(s =>
              Array.from({ length: s.lastPage - s.firstPage + 1 }, (_, k) => s.firstPage + k)))
            const parts: string[] = []
            extraction.pageTexts.forEach((t, i) => {
              const page = i + 1
              const seg = byStart.get(page)
              if (seg) parts.push(seg.text)
              else if (!covered.has(page)) parts.push(t)
            })
            textContent = parts.join('\n')
            extractionMethod = 'hybrid'
          }
          if (hybrid.failed > 0 || hybrid.truncated || hybrid.skippedPages > 0) extraction = { ...extraction, partial: true }
        } catch (e) {
          console.warn('[documents/process] hybrid extraction failed:', e instanceof Error ? e.message : e)
        }
      } else if (sparse.length > HYBRID_MAX_PAGES) {
        console.warn(`[documents/process] ${sparse.length} sparse pages > cap ${HYBRID_MAX_PAGES} — hybrid skipped`)
      }
    }

    if (textContent.length > DOCUMENT_MAX_CHARS) {
      console.warn(`[documents/process] ${doc.filename}: content truncated ${textContent.length} -> ${DOCUMENT_MAX_CHARS}`)
      textContent = textContent.slice(0, DOCUMENT_MAX_CHARS)
      extraction = { ...extraction, partial: true }
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

    // Persist the FULL extracted text as a faithful artifact (also Phase 2's whole-doc input).
    // Best-effort: chunks are the retrieval path, so a failure here never fails ingestion.
    try {
      const extractedTxtPath = `documents/${doc.projectId}/${doc.id}/${isReplace ? `rev${nextRevision}/` : ''}extracted.txt`
      await uploadBuffer(extractedTxtPath, Buffer.from(textContent, 'utf-8'), 'text/plain')
    } catch (e) {
      console.warn('[documents/process] extracted.txt upload failed:', e instanceof Error ? e.message : e)
    }

    if (isReplace) {
      const textChunks = chunkText(textContent)
      // Replace: embed FIRST (no destructive writes yet), then snapshot the old
      // revision and atomically swap (delete old chunks + insert new + update row).
      // A commit/transaction failure rolls back, leaving the prior revision intact. A
      // TOTAL embed failure still swaps in the new (unembedded) revision with status
      // 'error' — the old file is kept as a revision snapshot, but its chunk index is
      // replaced. (Retry/backoff makes total failure unlikely; aborting the swap to
      // preserve the last good index is a deferred follow-up.)
      const { embeddings, embedded, failed } = await embedContents(textChunks.map(c => c.content))
      const chunkRows = textChunks.map((c, i) => ({ chunkIndex: c.index, content: c.content, embedding: embeddings[i] }))
      if (failed > 0) console.warn(`[documents/process] ${failed}/${textChunks.length} chunks failed to embed`)
      const status: 'ready' | 'error' = embedded === 0 && textChunks.length > 0 ? 'error' : 'ready'
      // A partial extraction (char-truncation / page-capping) OR any post-retry embed
      // failure is a fidelity hole — surface it, never hide it.
      const extractionPartial = extraction.partial || failed > 0

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
        pageCount: extraction.pageCount, pagesExtracted: extraction.pagesExtracted, extractionPartial,
      })
      return NextResponse.json({ documentId: doc.id, status, revision: nextRevision, chunkCount: chunkRows.length, charCount: textContent.length })
    }

    // New upload: chunk → save → embed → status via the shared ingestion tail.
    const { status, chunkCount } = await ingestText(
      { id: doc.id, projectId: doc.projectId }, textContent,
      { extractionMethod, thumbnailPath, pageCount: extraction.pageCount, pagesExtracted: extraction.pagesExtracted, partial: extraction.partial },
    )
    return NextResponse.json({ documentId: doc.id, status, revision: doc.revision, chunkCount, charCount: textContent.length })
  } catch (error) {
    return apiError(error, 'Failed to process document', 500)
  }
}
