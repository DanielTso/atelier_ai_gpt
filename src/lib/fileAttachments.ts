import { formatFileSize } from '@/lib/fileUtils'

// Types and utilities for file attachment message format

// ── Image Attachments (multimodal) ──

export interface AttachedImage {
  name: string
  mediaType: string      // 'image/png', 'image/jpeg', etc.
  size: number
  dataUrl: string        // "data:image/png;base64,..."
}

const IMAGE_MIME_TYPES = new Set([
  'image/png', 'image/jpeg', 'image/gif', 'image/webp',
  'image/avif', 'image/heic', 'image/svg+xml',
])

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB

export function isImageFile(file: File): boolean {
  return IMAGE_MIME_TYPES.has(file.type)
}

export function fileToAttachedImage(file: File): Promise<AttachedImage> {
  if (file.size > MAX_IMAGE_SIZE) {
    return Promise.reject(new Error(`Image too large (${formatFileSize(file.size)}). Maximum is 10MB.`))
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
    result += file.textContent
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
