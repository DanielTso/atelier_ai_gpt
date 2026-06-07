export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
export const MAX_TEXT_LENGTH = 100_000 // 100K characters

export const SUPPORTED_EXTENSIONS = new Set([
  'pdf', 'docx', 'xlsx',
  'txt', 'md', 'csv',
  'py', 'js', 'ts', 'tsx', 'jsx',
  'json', 'html', 'css',
  'java', 'c', 'cpp', 'go', 'rs', 'rb', 'php',
  'sh', 'yaml', 'yml', 'xml', 'sql',
])

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

export async function extractTextFromBuffer(buffer: Buffer, extension: string): Promise<string> {
  if (extension === 'pdf') {
    const { extractText } = await import('unpdf')
    const result = await extractText(new Uint8Array(buffer))
    return result.text.join('\n')
  } else if (extension === 'docx') {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  } else if (extension === 'xlsx') {
    return extractTextFromXlsx(buffer)
  } else {
    // Plain text / code files
    return buffer.toString('utf-8')
  }
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
