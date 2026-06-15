// Throwaway C2 smoke test — validates the real render+vision path WITHOUT the DB.
// Mirrors src/lib/visionExtraction.ts exactly (unpdf legacy + @napi-rs/canvas scale 3
// + Gemini Flash image part). Delete alongside scripts/spike-vision-extract.mjs.
// Run: node scripts/smoke-c2-render.mjs [path.pdf] [maxPages]
import { config } from 'dotenv'
config({ path: '.env.local' })
import { readFileSync } from 'node:fs'
import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'

const pdfPath = process.argv[2] ?? 'GradingPlanIFC.pdf'
const maxPages = Number(process.argv[3] ?? 2)
const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
if (!apiKey) { console.error('No GOOGLE_GENERATIVE_AI_API_KEY in env'); process.exit(1) }

const PROMPT =
  'You are reading a single page of a construction document (plan/drawing/schedule). ' +
  'Transcribe ALL legible text verbatim — sheet numbers, titles, room names/numbers, dimensions, ' +
  'notes, callouts, and any schedule/table contents (preserve table structure as markdown). ' +
  'Then add a short paragraph describing what the drawing depicts. Do not invent content.'

const google = createGoogleGenerativeAI({ apiKey })
const { definePDFJSModule, getDocumentProxy, renderPageAsImage } = await import('unpdf')
await definePDFJSModule(() => import('pdfjs-dist/legacy/build/pdf.mjs'))

// pdfjs TRANSFERS (detaches) the ArrayBuffer it's given, so every call needs a
// fresh copy. Keep `source` pristine and copy from it for each pdfjs call.
const source = new Uint8Array(readFileSync(pdfPath))
console.log(`Loaded ${pdfPath} (${(source.length / 1024 / 1024).toFixed(2)} MB)`)
const pdf = await getDocumentProxy(new Uint8Array(source))
console.log(`PDF has ${pdf.numPages} pages; rendering up to ${maxPages}...`)

const total = Math.min(pdf.numPages, maxPages)
for (let page = 1; page <= total; page++) {
  const t0 = Date.now()
  const ab = await renderPageAsImage(new Uint8Array(source), page, { canvasImport: () => import('@napi-rs/canvas'), scale: 3 })
  const renderMs = Date.now() - t0
  const { text } = await generateText({
    model: google('gemini-3.5-flash'),
    messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image', image: new Uint8Array(ab) }] }],
    maxOutputTokens: 8000,
  })
  console.log(`\n===== PAGE ${page} (render ${renderMs}ms, image ${(ab.byteLength / 1024).toFixed(0)}KB, extracted ${text.length} chars) =====`)
  console.log(text.slice(0, 800))
}
await pdf.destroy?.()
console.log('\n✅ Render + vision path works.')
