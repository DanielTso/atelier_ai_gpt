// Phase C — C2 spike (THROWAWAY). Tests whether a vision model can usefully
// "read" a real construction plan page. Delete this file once C2's approach is chosen.
//
// What it does: renders page 1 of a PDF to a PNG (via unpdf + pdfjs-dist + @napi-rs/canvas),
// sends it to a Gemini vision model, and prints the extracted text.
//
// PREREQS (the spike needs deps the app doesn't carry yet — install them just to run this):
//   npm i -D pdfjs-dist @napi-rs/canvas
//   (ai, unpdf, @ai-sdk/google are already project deps)
//
// RUN:
//   GOOGLE_GENERATIVE_AI_API_KEY=your_key node scripts/spike-vision-extract.mjs path/to/real-plan.pdf
//   # optional: EXTRACTION_MODEL=gemini-3.1-pro-preview (default) / try a Claude vision model later
//
// JUDGE THE OUTPUT: does it capture dimensions, sheet/room labels, schedule tables, callouts?
//   ✅ usable  -> proceed to C2 with this Gemini model, unpdf server-side render
//   ⚠️ weak    -> set EXTRACTION_MODEL to a Claude vision model and re-run
//   ❌ render fails / @napi-rs/canvas won't load -> use the client-side pdf.js render fallback

import { readFile, writeFile } from 'node:fs/promises'

const pdfPath = process.argv[2]
if (!pdfPath) {
  console.error('Usage: node scripts/spike-vision-extract.mjs <path-to-plan.pdf>')
  process.exit(1)
}
if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  console.error('Set GOOGLE_GENERATIVE_AI_API_KEY in the environment.')
  process.exit(1)
}

const MODEL = process.env.EXTRACTION_MODEL || 'gemini-3.1-pro-preview'
const PROMPT =
  'You are reading a single page of a construction document (plan/drawing/schedule). ' +
  'Transcribe ALL legible text verbatim — sheet numbers, titles, room names/numbers, ' +
  'dimensions, notes, callouts, and any schedule/table contents (preserve table structure). ' +
  'Then add a short paragraph describing what the drawing depicts. Do not invent content.'

async function main() {
  // 1) Render page 1 to a PNG buffer.
  let pngBytes
  try {
    const { definePDFJSModule, renderPageAsImage } = await import('unpdf')
    await definePDFJSModule(() => import('pdfjs-dist'))
    const buffer = new Uint8Array(await readFile(pdfPath))
    const ab = await renderPageAsImage(buffer, 1, {
      canvasImport: () => import('@napi-rs/canvas'),
      scale: 2,
    })
    pngBytes = new Uint8Array(ab)
    await writeFile('spike-page1.png', pngBytes)
    console.log(`[render] OK — wrote spike-page1.png (${pngBytes.length} bytes)`)
  } catch (err) {
    console.error('[render] FAILED — unpdf/pdfjs-dist/@napi-rs/canvas issue:', err?.message || err)
    console.error('  -> Did you `npm i -D pdfjs-dist @napi-rs/canvas`? If it still fails, this is the')
    console.error('     signal to use the client-side pdf.js render fallback (see the Phase C spec).')
    process.exit(2)
  }

  // 2) Send to the vision model.
  try {
    const { generateText } = await import('ai')
    const { createGoogleGenerativeAI } = await import('@ai-sdk/google')
    const google = createGoogleGenerativeAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY })
    const { text, usage } = await generateText({
      model: google(MODEL),
      messages: [{ role: 'user', content: [{ type: 'text', text: PROMPT }, { type: 'image', image: pngBytes }] }],
      maxOutputTokens: 2000,
    })
    console.log(`\n===== EXTRACTION (${MODEL}) =====\n`)
    console.log(text)
    console.log(`\n===== END (tokens: ${JSON.stringify(usage)}) =====`)
  } catch (err) {
    console.error('[vision] FAILED:', err?.message || err)
    console.error('  -> If the model id is rejected, set EXTRACTION_MODEL to a current vision-capable model.')
    process.exit(3)
  }
}

main()
