import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from './settings'

const EXTRACTION_PROMPT =
  'You are reading a single page of a construction document (plan/drawing/schedule). ' +
  'Transcribe ALL legible text verbatim — sheet numbers, titles, room names/numbers, dimensions, ' +
  'notes, callouts, and any schedule/table contents (preserve table structure as markdown). ' +
  'Then add a short paragraph describing what the drawing depicts. Do not invent content.'

function num(v: string | undefined, d: number) { const n = v ? Number(v) : NaN; return Number.isFinite(n) ? n : d }

function cfg() {
  return {
    model: process.env.EXTRACTION_MODEL || 'gemini-3.5-flash',
    maxPages: num(process.env.EXTRACTION_MAX_PAGES, 30),
    scale: num(process.env.EXTRACTION_RENDER_SCALE, 3),
    maxOutputTokens: num(process.env.EXTRACTION_MAX_OUTPUT_TOKENS, 8000),
  }
}

async function extractImage(image: Uint8Array, model: string, maxOutputTokens: number, apiKey: string): Promise<string> {
  const google = createGoogleGenerativeAI({ apiKey })
  const { text } = await generateText({
    model: google(model),
    messages: [{ role: 'user', content: [{ type: 'text', text: EXTRACTION_PROMPT }, { type: 'image', image }] }],
    maxOutputTokens,
  })
  return text.trim()
}

/** Render each PDF page and vision-extract it. Best-effort; '' if no key. */
export async function extractViaVision(buffer: Buffer): Promise<string> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) return ''
  const { model, maxPages, scale, maxOutputTokens } = cfg()
  const { definePDFJSModule, getDocumentProxy, renderPageAsImage } = await import('unpdf')
  await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))
  const data = new Uint8Array(buffer)
  const pdf = await getDocumentProxy(data)
  const total = Math.min(pdf.numPages, maxPages)
  if (pdf.numPages > maxPages) {
    console.warn(`[visionExtraction] capping at ${maxPages}/${pdf.numPages} pages`)
  }
  const parts: string[] = []
  for (let page = 1; page <= total; page++) {
    try {
      const ab = await renderPageAsImage(data, page, { canvasImport: () => import('@napi-rs/canvas'), scale })
      const text = await extractImage(new Uint8Array(ab), model, maxOutputTokens, apiKey)
      if (text) parts.push(`# Page ${page}\n${text}`)
    } catch (err) {
      console.warn(`[visionExtraction] page ${page} failed:`, err instanceof Error ? err.message : err)
    }
  }
  return parts.join('\n\n')
}

/** Vision-extract a single uploaded image. Best-effort; '' if no key. */
export async function extractViaVisionImage(buffer: Buffer, _mimeType: string): Promise<string> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) return ''
  const { model, maxOutputTokens } = cfg()
  try {
    return await extractImage(new Uint8Array(buffer), model, maxOutputTokens, apiKey)
  } catch (err) {
    console.warn('[visionExtraction] image failed:', err instanceof Error ? err.message : err)
    return ''
  }
}
