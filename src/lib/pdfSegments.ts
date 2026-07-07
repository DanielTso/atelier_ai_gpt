// Split a PDF into page-range segments for native Gemini document extraction.
// Gemini caps PDFs at 50MB per REQUEST (inline and Files API alike), and dense
// transcription output for a whole plan set exceeds the 65K output cap — so
// extraction is segmented: each segment is a small standalone PDF built with
// pdf-lib, sent inline in its own generateText call.
import { PDFDocument } from 'pdf-lib'

export interface PdfSegment {
  bytes: Uint8Array
  firstPage: number // 1-based, absolute in the source document
  lastPage: number // inclusive
}

const DEFAULT_MAX_SEGMENT_BYTES = 45 * 1024 * 1024 // headroom under Gemini's 50MB PDF cap

async function buildSegment(src: PDFDocument, firstPage: number, lastPage: number): Promise<Uint8Array> {
  const out = await PDFDocument.create()
  const indices = Array.from({ length: lastPage - firstPage + 1 }, (_, i) => firstPage - 1 + i)
  const pages = await out.copyPages(src, indices)
  for (const p of pages) out.addPage(p)
  return out.save()
}

export async function splitPdfIntoSegments(
  buffer: Buffer,
  pagesPerSegment: number,
  opts: { maxPages?: number; maxSegmentBytes?: number } = {},
): Promise<{ segments: PdfSegment[]; pageCount: number; skippedPages: number }> {
  const maxSegmentBytes = opts.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES
  const src = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true })
  const pageCount = src.getPageCount()
  const limit = Math.min(pageCount, Math.max(1, opts.maxPages ?? pageCount))
  const per = Math.max(1, pagesPerSegment)

  const segments: PdfSegment[] = []
  let skippedPages = 0

  // Emit the range [first, last]; if its serialized bytes exceed the cap, halve
  // recursively. A single page still over the cap is skipped and counted — the
  // caller surfaces it as partial (no silent loss).
  async function emit(firstPage: number, lastPage: number): Promise<void> {
    const bytes = await buildSegment(src, firstPage, lastPage)
    if (bytes.length <= maxSegmentBytes) {
      segments.push({ bytes, firstPage, lastPage })
      return
    }
    if (firstPage === lastPage) {
      console.warn(`[pdfSegments] page ${firstPage} exceeds ${maxSegmentBytes} bytes — skipped`)
      skippedPages++
      return
    }
    const mid = Math.floor((firstPage + lastPage) / 2)
    await emit(firstPage, mid)
    await emit(mid + 1, lastPage)
  }

  for (let first = 1; first <= limit; first += per) {
    await emit(first, Math.min(first + per - 1, limit))
  }
  return { segments, pageCount, skippedPages }
}
