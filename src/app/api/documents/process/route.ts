import { NextRequest, NextResponse } from 'next/server'
import { getDocumentById, updateDocumentStatus, claimDocumentForProcessing, createDocumentRevision, commitDocumentReplacement } from '@/app/actions'
import { ensureEmbeddingModel } from '@/lib/embeddings'
import { chunkText } from '@/lib/chunking'
import { buildPageMap, pageRangeFor, spliceHybridPages } from '@/lib/pageMap'
import { embedContents } from '@/lib/embedChunks'
import { ingestText } from '@/lib/ingest'
import { MAX_FILE_SIZE, DOCUMENT_MAX_CHARS, getExtension, isImageUpload, isSupported, extractTextFromBuffer } from '@/lib/fileExtraction'
import type { ExtractionResult } from '@/lib/fileExtraction'
import { extractViaVision, extractViaVisionImage, extractPagesViaVision } from '@/lib/visionExtraction'
import { downloadToBuffer, uploadBuffer, removeObjects, sanitizeStorageName } from '@/lib/storage'
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

// The status a failed request leaves behind (audit B8, B25). A replace never
// touches the previous revision until its final commit, so the document keeps the
// status it had before the request: upload-url no longer changes it, so that is
// `doc.status` as read here. A row an older deploy left 'uploading' carries no
// prior status, so fall back to "it had chunks before the request". A first
// upload has no previous revision to fall back to.
function failureStatus(doc: { status: string; chunkCount: number | null }, isReplace: boolean): 'ready' | 'error' {
  if (!isReplace) return 'error'
  if (doc.status === 'ready' || doc.status === 'error') return doc.status
  return (doc.chunkCount ?? 0) > 0 ? 'ready' : 'error'
}

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
      const replIsImage = isImageUpload(replExt, effMimeType)
      if (!replIsImage && !isSupported(effFilename, effMimeType)) {
        return NextResponse.json({ error: 'Unsupported file type' }, { status: 400 })
      }
      if (effFileSize > MAX_FILE_SIZE) {
        return NextResponse.json({ error: 'File too large' }, { status: 400 })
      }
    }

    // Claim the document (audit D2): only one call processes it at a time, so a
    // re-click or a retry while the first call is still running is refused here
    // instead of extracting again and writing a second chunk set. The claim only
    // succeeds if the row still has the status and revision read above, so the
    // rev<N+1> paths derived from `doc` can't belong to a replace that committed
    // in between.
    const busy = () => NextResponse.json({ error: 'This document is already being processed.' }, { status: 409 })
    if (doc.status === 'processing') return busy()
    if (!(await claimDocumentForProcessing(doc.id, { status: doc.status, revision: doc.revision }))) return busy()

    // From here on every exit, including a throw, must leave a settled status
    // (audit B8, X8): a failed replace keeps the previous revision's status, a
    // failed first upload is 'error'. A failed replace also removes the rev<N>
    // objects it would have committed, the uploaded file included (audit X12):
    // nothing references them, and a retry uploads them again.
    const fallbackStatus = failureStatus(doc, isReplace)
    const revObjects: string[] = isReplace ? [sourcePath] : []
    let commitStarted = false
    const fail = async (errorMessage: string) => {
      if (fallbackStatus === 'ready') await updateDocumentStatus(doc.id, 'ready')
      else await updateDocumentStatus(doc.id, 'error', { errorMessage })
      // Once the commit was sent its outcome is unknown, and the rev objects may
      // now be the live revision: never delete them then.
      if (isReplace && !commitStarted) {
        await removeObjects(revObjects).catch(e =>
          console.warn('[documents/process] rev cleanup failed:', e instanceof Error ? e.message : e))
      }
    }

    try {
      const { available } = await ensureEmbeddingModel()
      if (!available) {
        await fail('No embedding provider available.')
        return NextResponse.json({ error: 'No embedding provider available. Set a Gemini API key.' }, { status: 503 })
      }

      const ext = getExtension(effFilename)
      const isImage = isImageUpload(ext, effMimeType)

      let buffer: Buffer
      try {
        buffer = await downloadToBuffer(sourcePath)
      } catch (e) {
        await fail('Failed to download uploaded file.')
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
        await fail('Failed to extract document content.')
        return apiError(e, 'Failed to extract document content', 500, false)
      }

      let failedPages: number[] = extraction.failedPages ?? []

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
            failedPages = [...failedPages, ...hybrid.failedPages]
            if (hybrid.segments.length > 0) {
              // Every page gets a "# Page n" anchor, text-path pages included, so
              // each chunk is stamped with its real page (audit X1).
              textContent = spliceHybridPages(extraction.pageTexts, hybrid.segments)
              extractionMethod = 'hybrid'
            }
            if (hybrid.failed > 0 || hybrid.truncated || hybrid.skippedPages.length > 0) extraction = { ...extraction, partial: true }
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
        await fail('No text content could be extracted.')
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
          if (isReplace) revObjects.push(thumbnailPath)
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
        if (isReplace) revObjects.push(extractedTxtPath)
      } catch (e) {
        console.warn('[documents/process] extracted.txt upload failed:', e instanceof Error ? e.message : e)
      }

      if (isReplace) {
        const textChunks = chunkText(textContent)
        // Page provenance: map '# Page n' anchors once, stamp each chunk's page range
        // from its char offsets (null when the text has no anchors) — same contract as
        // the new-upload path in ingestText.
        const pageMap = buildPageMap(textContent)
        // Replace: embed FIRST (no destructive writes yet), then snapshot the old
        // revision and atomically swap (delete old chunks + insert new + update row).
        // A commit/transaction failure rolls back, leaving the prior revision intact.
        const { embeddings, embedded, failed, aborted } = await embedContents(textChunks.map(c => c.content))
        const chunkRows = textChunks.map((c, i) => ({
          chunkIndex: c.index, content: c.content, embedding: embeddings[i],
          ...(pageRangeFor(pageMap, c.start, c.end) ?? { pageStart: null, pageEnd: null }),
        }))
        if (failed > 0) console.warn(`[documents/process] ${failed}/${textChunks.length} chunks failed to embed`)
        if ((embedded === 0 && textChunks.length > 0) || aborted) {
          // TOTAL embed failure (e.g. Gemini outage mid-re-upload), or the pool stopped
          // early because the provider looks down: abort before any destructive write
          // so the previous, fully embedded revision's chunk index stays active.
          await fail('Replace failed: embeddings unavailable.')
          return NextResponse.json(
            { error: 'Replace failed: embeddings unavailable; the previous revision is still active.' },
            { status: 502 },
          )
        }
        // A partial extraction (char-truncation / page-capping) OR any post-retry embed
        // failure is a fidelity hole — surface it, never hide it.
        const extractionPartial = extraction.partial || failed > 0

        await createDocumentRevision({
          documentId: doc.id, projectId: doc.projectId, revision: doc.revision,
          filename: doc.filename, mimeType: doc.mimeType, fileSize: doc.fileSize,
          storagePath: doc.storagePath, thumbnailPath: doc.thumbnailPath,
          charCount: doc.charCount, chunkCount: doc.chunkCount, extractionMethod: doc.extractionMethod,
        })
        // Reaching here means at least one chunk embedded (or the doc is empty), so the
        // committed revision is always usable: status 'ready', partial covers the rest.
        commitStarted = true
        await commitDocumentReplacement(doc.id, doc.projectId, chunkRows, {
          filename: effFilename, mimeType: effMimeType, fileSize: effFileSize, storagePath: sourcePath,
          thumbnailPath, charCount: textContent.length, chunkCount: chunkRows.length, extractionMethod,
          revision: nextRevision, status: 'ready',
          errorMessage: null,
          pageCount: extraction.pageCount, pagesExtracted: extraction.pagesExtracted, extractionPartial,
          failedPages: failedPages.length ? failedPages : null,
        })
        return NextResponse.json({ documentId: doc.id, status: 'ready', revision: nextRevision, chunkCount: chunkRows.length, charCount: textContent.length })
      }

      // New upload: chunk → save → embed → status via the shared ingestion tail.
      const { status, chunkCount } = await ingestText(
        { id: doc.id, projectId: doc.projectId }, textContent,
        { extractionMethod, thumbnailPath, pageCount: extraction.pageCount, pagesExtracted: extraction.pagesExtracted, partial: extraction.partial, failedPages: failedPages.length ? failedPages : null },
      )
      return NextResponse.json({ documentId: doc.id, status, revision: doc.revision, chunkCount, charCount: textContent.length })
    } catch (error) {
      await fail('Failed to process document.').catch(() => {})
      return apiError(error, 'Failed to process document', 500)
    }
  } catch (error) {
    return apiError(error, 'Failed to process document', 500)
  }
}
