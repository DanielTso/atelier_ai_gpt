import { formatFileSize } from '@/lib/fileUtils'

// Types and utilities for file attachment message format

// ── Image Attachments (multimodal) ──

export interface AttachedImage {
  name: string
  mediaType: string      // 'image/png', 'image/jpeg', etc.
  size: number
  dataUrl: string        // "data:image/png;base64,..."
}

// The only image types Claude reads. Anything else sent as an image part is
// rejected by the provider — and since the attachment is persisted and replayed,
// every later turn in that chat would fail too (U11).
export const CHAT_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
const IMAGE_MIME_TYPES = new Set<string>(CHAT_IMAGE_TYPES)

// Image formats people commonly try to attach that Claude can't read. Checked by
// extension too: Windows often reports an empty MIME type for .heic.
const UNSUPPORTED_IMAGE_EXTENSIONS = new Set(['svg', 'heic', 'heif', 'avif', 'bmp', 'tif', 'tiff', 'ico'])

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB, after client-side downscaling

// Chat images travel inline as base64 data URLs in the /api/chat JSON body, and
// Vercel rejects request bodies over 4.5 MB before the function runs. 3 MB of
// base64 leaves room for the transcript and the rest of the request (U4).
export const CHAT_IMAGE_BUDGET_BYTES = 3 * 1024 * 1024
export const IMAGE_BUDGET_MESSAGE = 'Images too large to send together (max 3 MB)'

// Some platforms (Windows drag-and-drop, certain file pickers) report an empty
// MIME type; the extension then decides, for the supported types only.
const IMAGE_TYPE_BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
}

function imageTypeFromExtension(name: string): string | undefined {
  return IMAGE_TYPE_BY_EXTENSION[name.split('.').pop()?.toLowerCase() ?? '']
}

export function isImageFile(file: File): boolean {
  if (IMAGE_MIME_TYPES.has(file.type)) return true
  return file.type === '' && imageTypeFromExtension(file.name) !== undefined
}

/**
 * A supported image with its media type filled in from the extension when the
 * platform left it empty — otherwise its data URL would read
 * `data:application/octet-stream` and the provider would reject it.
 */
export function withImageMediaType(file: File): File {
  if (file.type !== '') return file
  const type = imageTypeFromExtension(file.name)
  return type ? new File([file], file.name, { type, lastModified: file.lastModified }) : file
}

/** An image Claude can't read (SVG, HEIC, AVIF, …) — refuse it rather than treat it as a document. */
export function isUnsupportedImage(file: File): boolean {
  if (isImageFile(file)) return false
  if (file.type.startsWith('image/')) return true
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  return UNSUPPORTED_IMAGE_EXTENSIONS.has(ext)
}

/** Bytes the images add to the chat request: the length of their base64 data URLs. */
export function imagePayloadBytes(images: AttachedImage[]): number {
  return images.reduce((sum, img) => sum + img.dataUrl.length, 0)
}

export function exceedsImageBudget(images: AttachedImage[]): boolean {
  return imagePayloadBytes(images) > CHAT_IMAGE_BUDGET_BYTES
}

export function fileToAttachedImage(file: File): Promise<AttachedImage> {
  if (file.size > MAX_IMAGE_SIZE) {
    return Promise.reject(new Error(`Image too large: ${file.name} (${formatFileSize(file.size)}). Maximum is 10MB.`))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve({
        name: file.name,
        mediaType: file.type,
        size: file.size,
        dataUrl: reader.result as string,
      })
    }
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

// ── Text File Attachments ──

export interface AttachedFile {
  name: string
  type: string
  size: number
  charCount: number
  textContent: string
  truncated: boolean
}

export interface FileMetadata {
  name: string
  type: string
  size: number
  chars: number
}

/**
 * Sanitize a filename for safe embedding in HTML comments.
 */
function sanitizeFilename(name: string): string {
  return name.replace(/-->/g, '__').replace(/</g, '_').replace(/>/g, '_').slice(0, 255)
}

/**
 * Neutralize our own comment sentinels if they appear inside file content. A file
 * whose body literally contains `<!-- /FILECONTENT -->` (or a `<!-- FILES:` /
 * `<!-- FILECONTENT:` marker) could otherwise forge/close the delimiter block, so
 * parseFileMetadata/stripFilePrefix mis-parse the message and the displayed text
 * diverges from what was sent to the model. We defang ONLY our markers (break the
 * `<!--` opener that precedes FILES/FILECONTENT), leaving any other `<!-- … -->`
 * HTML comments in the content intact.
 */
function sanitizeFileContent(content: string): string {
  return content.replace(/<!--(\s*\/?(?:FILECONTENT|FILES)\b)/gi, '<!-_$1')
}

/**
 * Build a message string with file content embedded using HTML comment delimiters.
 * Format:
 *   <!-- FILES:[{...metadata}] -->
 *   <!-- FILECONTENT:filename -->
 *   [text]
 *   <!-- /FILECONTENT -->
 *
 *   User's typed message
 */
export function buildFileMessage(text: string, files: AttachedFile[]): string {
  const metadata: FileMetadata[] = files.map(f => ({
    name: f.name,
    type: f.type,
    size: f.size,
    chars: f.charCount,
  }))

  let result = `<!-- FILES:${JSON.stringify(metadata)} -->\n`

  for (const file of files) {
    result += `<!-- FILECONTENT:${sanitizeFilename(file.name)} -->\n`
    result += sanitizeFileContent(file.textContent)
    result += `\n<!-- /FILECONTENT -->\n`
  }

  if (text) {
    result += `\n${text}`
  }

  return result
}

/**
 * Extract FileMetadata array from a message that contains file attachments.
 * Returns null if the message doesn't contain file metadata.
 */
export function parseFileMetadata(content: string): FileMetadata[] | null {
  const match = content.match(/^<!-- FILES:(\[.*?\]) -->/)
  if (!match) return null

  try {
    return JSON.parse(match[1]) as FileMetadata[]
  } catch {
    return null
  }
}

/**
 * Strip file metadata and content blocks from a message,
 * returning only the user's typed text for display.
 */
export function stripFilePrefix(content: string): string {
  // Remove the FILES metadata line
  let result = content.replace(/^<!-- FILES:\[.*?\] -->\n?/, '')
  // Remove all FILECONTENT blocks
  result = result.replace(/<!-- FILECONTENT:.*? -->\n[\s\S]*?\n<!-- \/FILECONTENT -->\n?/g, '')
  return result.trim()
}

/**
 * Get a human-readable label for a file type based on MIME type or extension.
 */
export function getFileTypeLabel(mime: string, name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''

  if (mime === 'application/pdf' || ext === 'pdf') return 'PDF'
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext === 'docx') return 'DOCX'
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || ext === 'xlsx') return 'XLSX'
  if (ext === 'md') return 'MD'
  if (ext === 'csv') return 'CSV'
  if (ext === 'json') return 'JSON'
  if (ext === 'html') return 'HTML'
  if (ext === 'css') return 'CSS'
  if (ext === 'xml') return 'XML'
  if (ext === 'yaml' || ext === 'yml') return 'YAML'
  if (ext === 'sql') return 'SQL'
  if (ext === 'sh') return 'Shell'
  if (ext === 'py') return 'Python'
  if (ext === 'js') return 'JavaScript'
  if (ext === 'ts') return 'TypeScript'
  if (ext === 'tsx') return 'TSX'
  if (ext === 'jsx') return 'JSX'
  if (ext === 'java') return 'Java'
  if (ext === 'c') return 'C'
  if (ext === 'cpp') return 'C++'
  if (ext === 'go') return 'Go'
  if (ext === 'rs') return 'Rust'
  if (ext === 'rb') return 'Ruby'
  if (ext === 'php') return 'PHP'
  if (mime.startsWith('text/')) return 'Text'
  return ext.toUpperCase() || 'File'
}

// Re-export formatFileSize from fileUtils for backward compatibility
export { formatFileSize }
