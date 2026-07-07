// Construction plan sets are routinely large (the IFC sample is ~17MB). The
// direct-to-Storage upload flow (upload-url → uploadToSignedUrl → process)
// bypasses Vercel's request-body limit, so this constant is the app-side gate.
// NOTE: Supabase must also allow it — the `atelier-files` bucket `file_size_limit`
// AND the project-global Storage upload limit must be >= this value, or the
// signed upload is rejected server-side regardless of this constant.
export const MAX_FILE_SIZE = 200 * 1024 * 1024 // 200MB
export const DOCUMENT_MAX_CHARS = Number(process.env.DOCUMENT_MAX_CHARS) || 2_000_000 // char ceiling; text past this is dropped + flagged partial

export interface ExtractionResult {
  text: string
  pageCount: number | null
  pagesExtracted: number | null
  partial: boolean
}

export const SUPPORTED_EXTENSIONS = new Set([
  'pdf', 'docx', 'xlsx',
  'txt', 'md', 'csv',
  'py', 'js', 'ts', 'tsx', 'jsx',
  'json', 'html', 'css',
  'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php',
  'sh', 'yaml', 'yml', 'xml', 'sql',
])

// Images are NOT in SUPPORTED_EXTENSIONS: the shared text extractor (/api/extract)
// has no image handling and would emit garbage UTF-8. Image support is opt-in per
// route — /api/documents accepts these via vision extraction (see its guard).
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp'])
export function isImageExtension(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext)
}

export const TEXT_MIME_PREFIXES = ['text/', 'application/json', 'application/xml']

export function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() ?? ''
}

export function isSupported(filename: string, mimeType: string): boolean {
  const ext = getExtension(filename)
  if (SUPPORTED_EXTENSIONS.has(ext)) return true
  if (TEXT_MIME_PREFIXES.some(p => mimeType.startsWith(p))) return true
  return false
}

/**
 * Shared pre-extraction validation (size cap + supported type). Returns a user-facing
 * error message, or null if the file is acceptable. Keeps the size/type contract in one
 * place for callers like /api/extract.
 */
export function validateUploadedFile(filename: string, mimeType: string, size: number): string | null {
  if (size > MAX_FILE_SIZE) {
    return `File too large. Maximum size is ${MAX_FILE_SIZE / (1024 * 1024)}MB.`
  }
  if (!isSupported(filename, mimeType)) {
    return `Unsupported file type: ${filename}. Supported: PDF, Word (.docx), Excel (.xlsx), and text/code files.`
  }
  return null
}

export async function extractTextFromBuffer(buffer: Buffer, extension: string): Promise<ExtractionResult> {
  let text = ''
  let pageCount: number | null = null
  let truncated = false
  if (extension === 'pdf') {
    const { extractText } = await import('unpdf')
    const result = await extractText(new Uint8Array(buffer))
    pageCount = typeof result.totalPages === 'number' ? result.totalPages : null
    // Accumulate page-by-page and stop at DOCUMENT_MAX_CHARS so a huge PDF can't build a
    // multi-megabyte string on top of the ≤200MB buffer already in memory.
    const pages = Array.isArray(result.text) ? result.text : [String(result.text)]
    for (let i = 0; i < pages.length; i++) {
      text += (text ? '\n' : '') + pages[i]
      if (text.length >= DOCUMENT_MAX_CHARS) {
        // Broke on the cap: partial if we overshot OR there are still pages left. This catches
        // the exact-boundary case (text lands on the cap with more pages) that a bare
        // `length > MAX` check would silently drop — no silent loss.
        truncated = text.length > DOCUMENT_MAX_CHARS || i < pages.length - 1
        break
      }
    }
  } else if (extension === 'docx') {
    const mammoth = await import('mammoth')
    text = (await mammoth.extractRawText({ buffer })).value
  } else if (extension === 'xlsx') {
    text = await extractTextFromXlsx(buffer)
  } else {
    text = buffer.toString('utf-8')
  }
  if (text.length > DOCUMENT_MAX_CHARS) { text = text.slice(0, DOCUMENT_MAX_CHARS); truncated = true }
  // Text path partial = char-truncation only; it doesn't page-cap, so pagesExtracted stays null.
  return { text, pageCount, pagesExtracted: null, partial: truncated }
}

/**
 * Flatten an exceljs cell value to a plain string. Cell values can be primitives,
 * Dates, rich-text objects, hyperlinks, formula results, or error markers.
 */
function formatCell(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>
    if (typeof v.text === 'string') return v.text // hyperlink / simple rich text
    if (Array.isArray(v.richText)) {
      return (v.richText as { text?: string }[]).map(r => r.text ?? '').join('')
    }
    if ('result' in v) return formatCell(v.result) // formula → cached result
    if ('error' in v) return String(v.error)
    return ''
  }
  return String(value)
}

/**
 * Extract worksheet contents from an .xlsx workbook as tab-separated rows,
 * grouped per sheet, suitable for feeding to an LLM.
 */
async function extractTextFromXlsx(buffer: Buffer): Promise<string> {
  // exceljs is CommonJS — under a dynamic import the export lives on `.default`
  // (raw Node); some bundlers also hoist it to the namespace root, so fall back.
  const mod = await import('exceljs')
  const ExcelJS = mod.default ?? mod
  const workbook = new ExcelJS.Workbook()
  // Pass a fresh ArrayBuffer view; exceljs reads the xlsx zip from it.
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer)

  const parts: string[] = []
  workbook.eachSheet(sheet => {
    const rows: string[] = []
    sheet.eachRow({ includeEmpty: false }, row => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : []
      rows.push(values.map(formatCell).join('\t'))
    })
    if (rows.length > 0) {
      parts.push(`# Sheet: ${sheet.name}\n${rows.join('\n')}`)
    }
  })

  return parts.join('\n\n')
}
