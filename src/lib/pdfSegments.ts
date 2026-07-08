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

// Emit the range [firstPage, lastPage] into `segments`; if its serialized
// bytes exceed the cap, halve recursively. A single page still over the cap is
// skipped and reported via `onSkip` — the caller surfaces it as partial (no
// silent loss). Shared by splitPdfIntoSegments and splitPdfPageRuns.
async function emitRange(
  src: PDFDocument,
  firstPage: number,
  lastPage: number,
  maxSegmentBytes: number,
  segments: PdfSegment[],
  onSkip: () => void,
): Promise<void> {
  const bytes = await buildSegment(src, firstPage, lastPage)
  if (bytes.length <= maxSegmentBytes) {
    segments.push({ bytes, firstPage, lastPage })
    return
  }
  if (firstPage === lastPage) {
    console.warn(`[pdfSegments] page ${firstPage} exceeds ${maxSegmentBytes} bytes — skipped`)
    onSkip()
    return
  }
  const mid = Math.floor((firstPage + lastPage) / 2)
  await emitRange(src, firstPage, mid, maxSegmentBytes, segments, onSkip)
  await emitRange(src, mid + 1, lastPage, maxSegmentBytes, segments, onSkip)
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

  for (let first = 1; first <= limit; first += per) {
    await emitRange(src, first, Math.min(first + per - 1, limit), maxSegmentBytes, segments, () => { skippedPages++ })
  }
  return { segments, pageCount, skippedPages }
}

// Build segments from an arbitrary 1-based page list: dedupe + sort + drop
// out-of-bounds pages, walk contiguous runs, chunk each run at
// `pagesPerSegment`, and pass every chunk through the same byte-cap
// halving/skip recursion as splitPdfIntoSegments.
export async function splitPdfPageRuns(
  buffer: Buffer,
  pages: number[],
  opts: { pagesPerSegment?: number; maxSegmentBytes?: number } = {},
): Promise<{ segments: PdfSegment[]; skippedPages: number }> {
  const maxSegmentBytes = opts.maxSegmentBytes ?? DEFAULT_MAX_SEGMENT_BYTES
  const per = Math.max(1, opts.pagesPerSegment ?? 20)
  const src = await PDFDocument.load(new Uint8Array(buffer), { ignoreEncryption: true })
  const pageCount = src.getPageCount()
  const wanted = [...new Set(pages)].filter(p => p >= 1 && p <= pageCount).sort((a, b) => a - b)

  const segments: PdfSegment[] = []
  let skippedPages = 0
  // walk contiguous runs
  let i = 0
  while (i < wanted.length) {
    let j = i
    while (j + 1 < wanted.length && wanted[j + 1] === wanted[j] + 1) j++
    const first = wanted[i]
    const last = wanted[j]
    for (let start = first; start <= last; start += per) {
      await emitRange(src, start, Math.min(start + per - 1, last), maxSegmentBytes, segments, () => { skippedPages++ })
    }
    i = j + 1
  }
  return { segments, skippedPages }
}
