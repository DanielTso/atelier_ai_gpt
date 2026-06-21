export interface Model {
  name: string
  model: string
  digest: string
}

export type DocumentStatus = 'uploading' | 'processing' | 'ready' | 'error'

/** A document as returned by GET /api/documents (row + signed URLs), as the UI consumes it. */
export interface DocumentSummary {
  id: number
  filename: string
  mimeType: string
  fileSize: number
  chunkCount: number | null
  status: DocumentStatus
  errorMessage: string | null
  url: string | null
  thumbnailUrl: string | null
  extractionMethod: 'text' | 'vision' | null
  revision: number
  updatedAt: string | null
}

export interface ArtifactSummary {
  id: number
  chatId: number
  type: string
  title: string
  status: string
  downloadUrl: string | null
  createdAt: Date | null
  /** D2: source that produced the file (for preview/edit) + active version. */
  format?: string | null
  content?: string | null
  version?: number
}

/** A single artifact version (D2), as the workspace panel consumes it. */
export interface ArtifactVersionSummary {
  id: number
  version: number
  type: string
  title: string
  format: string | null
  content: string | null
  downloadUrl: string | null
  createdAt: Date | string | null
}

/** A pending auto-memory suggestion as the rail consumes it. */
export interface MemorySuggestion {
  id: number
  text: string
  createdAt: string | Date | null
}
