export const MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB
export const MAX_TEXT_LENGTH = 100_000 // 100K characters

export const SUPPORTED_EXTENSIONS = new Set([
  'pdf', 'docx',
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
  } else {
    // Plain text / code files
    return buffer.toString('utf-8')
  }
}
