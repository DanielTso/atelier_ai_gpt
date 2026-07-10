import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from './settings'
import { splitPdfIntoSegments, splitPdfPageRuns } from './pdfSegments'
import type { PdfSegment } from './pdfSegments'
import { mapWithConcurrency } from './concurrency'
import type { ExtractionResult } from './fileExtraction'

const IMAGE_PROMPT =
  'You are reading a single page of a construction document (plan/drawing/schedule). ' +
  'Transcribe ALL legible text verbatim — sheet numbers, titles, room names/numbers, dimensions, ' +
  'notes, callouts, and any schedule/table contents (preserve table structure as markdown). ' +
  'Then add a short paragraph describing what the drawing depicts. Do not invent content.'

function segmentPrompt(firstPage: number, lastPage: number): string {
  return (
    `You are reading pages ${firstPage}-${lastPage} of a construction document (plans/drawings/schedules/contract). ` +
    'For EACH page: transcribe ALL legible text verbatim — sheet numbers, titles, room names/numbers, dimensions, ' +
    'notes, callouts, and any schedule/table contents (preserve table structure as markdown) — then add a short ' +
    'paragraph describing what the page depicts. ' +
    `Start each page with a heading line "# Page <n>" using the page's ABSOLUTE number: the first page of this file is page ${firstPage}. ` +
    'Do not invent content.'
  )
}

function num(v: string | undefined, d: number) { const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d }

function cfg() {
  return {
    model: process.env.EXTRACTION_MODEL || 'gemini-3.5-flash',
    maxPages: num(process.env.EXTRACTION_MAX_PAGES, 500),
    segmentPages: num(process.env.EXTRACTION_SEGMENT_PAGES, 20),
    segmentConcurrency: num(process.env.EXTRACTION_SEGMENT_CONCURRENCY, 2),
    segmentMaxBytes: num(process.env.EXTRACTION_SEGMENT_MAX_BYTES, 45 * 1024 * 1024),
    maxOutputTokens: num(process.env.EXTRACTION_MAX_OUTPUT_TOKENS, 60000),
    retries: num(process.env.EXTRACTION_SEGMENT_RETRIES, 2),
  }
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** One generateText call per segment (inline PDF file part), bounded-concurrent
 * with retry/backoff. A segment that fails after retries yields text ''. Shared
 * by extractViaVision and extractPagesViaVision. */
async function extractSegments(
  segments: PdfSegment[],
  c: ReturnType<typeof cfg>,
  apiKey: string,
): Promise<{ results: { seg: PdfSegment; text: string }[]; truncated: boolean }> {
  const google = createGoogleGenerativeAI({ apiKey })
  let truncated = false
  const results = await mapWithConcurrency(segments, c.segmentConcurrency, async seg => {
    for (let attempt = 0; attempt <= c.retries; attempt++) {
      try {
        const { text, finishReason } = await generateText({
          model: google(c.model),
          messages: [{
            role: 'user',
            content: [
              { type: 'text', text: segmentPrompt(seg.firstPage, seg.lastPage) },
              { type: 'file', data: seg.bytes, mediaType: 'application/pdf' },
            ],
          }],
          maxOutputTokens: c.maxOutputTokens,
          // Transcription must be deterministic: at the default temperature the same
          // sheet transcribes differently run to run (seen live on SHX notes sheets).
          temperature: 0,
        })
        if (finishReason === 'length') {
          console.warn(`[visionExtraction] segment ${seg.firstPage}-${seg.lastPage} hit the output cap`)
          truncated = true
        }
        return { seg, text: text.trim() }
      } catch (err) {
        if (attempt === c.retries) {
          console.warn(`[visionExtraction] segment ${seg.firstPage}-${seg.lastPage} failed:`, err instanceof Error ? err.message : err)
          return { seg, text: '' }
        }
        await sleep(500 * 2 ** attempt)
      }
    }
    return { seg, text: '' }
  })
  return { results, truncated }
}

async function extractImage(image: Uint8Array, model: string, maxOutputTokens: number, apiKey: string): Promise<string> {
  const google = createGoogleGenerativeAI({ apiKey })
  const { text } = await generateText({
    model: google(model),
    messages: [{ role: 'user', content: [{ type: 'text', text: IMAGE_PROMPT }, { type: 'image', image }] }],
    maxOutputTokens,
    temperature: 0,
  })
  return text.trim()
}

/**
 * Native-PDF segment extraction: split into page-range segments (each far under
 * Gemini's 50MB-per-request PDF cap), one generateText call per segment with the
 * segment inline as a file part, bounded-concurrent with retry. Gemini reads the
 * embedded text layer natively AND sees each page as an image — no rasterizing.
 * Best-effort; empty result if no key. Fidelity: a failed segment, a skipped
 * oversize page, output truncation, or the page cap all surface as partial.
 */
export async function extractViaVision(buffer: Buffer): Promise<ExtractionResult> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) return { text: '', pageCount: null, pagesExtracted: null, partial: false }
  const c = cfg()
  const { segments, pageCount, skippedPages } = await splitPdfIntoSegments(buffer, c.segmentPages, {
    maxPages: c.maxPages, maxSegmentBytes: c.segmentMaxBytes,
  })
  if (pageCount > c.maxPages) console.warn(`[visionExtraction] capping at ${c.maxPages}/${pageCount} pages`)
  const { results, truncated } = await extractSegments(segments, c, apiKey)

  const ok = results.filter(r => r.text)
  const pagesExtracted = ok.reduce((n, r) => n + (r.seg.lastPage - r.seg.firstPage + 1), 0)
  return {
    text: ok.map(r => r.text).join('\n\n'),
    pageCount,
    pagesExtracted,
    partial: truncated || skippedPages > 0 || pagesExtracted < pageCount,
  }
}

/** Vision-extract specific pages (contiguous runs) of a PDF — the hybrid path for
 * SHX/thin-text-layer sheets inside otherwise text-rich sets. Best-effort. */
export async function extractPagesViaVision(
  buffer: Buffer,
  pages: number[],
): Promise<{ segments: { firstPage: number; lastPage: number; text: string }[]; failed: number; truncated: boolean; skippedPages: number }> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey || pages.length === 0) return { segments: [], failed: 0, truncated: false, skippedPages: 0 }
  const c = cfg()
  const { segments, skippedPages } = await splitPdfPageRuns(buffer, pages, {
    pagesPerSegment: c.segmentPages, maxSegmentBytes: c.segmentMaxBytes,
  })
  const { results, truncated } = await extractSegments(segments, c, apiKey)
  const ok = results.filter(r => r.text)
  return {
    segments: ok.map(r => ({ firstPage: r.seg.firstPage, lastPage: r.seg.lastPage, text: r.text })),
    failed: results.length - ok.length,
    truncated,
    skippedPages,
  }
}

/** Vision-extract a single uploaded image. Best-effort; empty result if no key. */
export async function extractViaVisionImage(buffer: Buffer, _mimeType: string): Promise<ExtractionResult> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) return { text: '', pageCount: 1, pagesExtracted: 1, partial: false }
  const { model, maxOutputTokens } = cfg()
  try {
    const text = await extractImage(new Uint8Array(buffer), model, maxOutputTokens, apiKey)
    return { text, pageCount: 1, pagesExtracted: 1, partial: false }
  } catch (err) {
    console.warn('[visionExtraction] image failed:', err instanceof Error ? err.message : err)
    return { text: '', pageCount: 1, pagesExtracted: 1, partial: false }
  }
}
