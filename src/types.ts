/**
 * Reasoning-effort ladder. Single source of truth — `providers.ts` (server) and
 * `usePersonas.ts` (client) both re-export this; they each used to declare their
 * own copy. `xhigh` sits between `high` and `max` and is supported by Opus 5,
 * Sonnet 5, and Fable 5 (Anthropic's recommended default for coding/agentic
 * work); which levels a given model actually accepts comes from the registry's
 * per-model capabilities, never from this union.
 */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Per-model capability flags, derived from Anthropic's live `capabilities` tree. */
export interface ModelCapabilities {
  supportsEffort: boolean
  effortLevels: Effort[]
  supportsThinking: boolean
  supportsImageInput: boolean
  supportsStructuredOutputs: boolean
}

/**
 * Token pricing in USD per million tokens. `estimated` is true when the rate was
 * inferred from the model's family rather than known exactly — the UI marks those.
 * Models that aren't token-priced at all (image generation) carry the 0/0 sentinel.
 */
export interface ModelPricing {
  inputPerMTok: number
  outputPerMTok: number
  estimated: boolean
}

export interface Model {
  name: string
  model: string
  digest: string
  provider: 'anthropic' | 'google'
  family: string
  capabilities: ModelCapabilities
  pricing: ModelPricing
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
  extractionMethod: 'text' | 'vision' | 'hybrid' | null
  pageCount?: number | null
  pagesExtracted?: number | null
  extractionPartial?: boolean
  failedPages: number[] | null
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
  // Gallery-only metadata (populated by getAllArtifacts; absent on per-chat lists).
  editedAt?: Date | null
  chatTitle?: string | null
  projectName?: string | null
}

export const ARTIFACT_TYPE_LABELS: Record<string, string> = {
  html: 'HTML', pdf: 'PDF', xlsx: 'Spreadsheet', docx: 'Document', pptx: 'Slides', code: 'Code',
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

/** A generated image row as the Images gallery consumes it (row + short-lived signed url). */
export interface GeneratedImageSummary {
  id: number
  projectId: number | null
  prompt: string
  aspectRatio: string | null
  mediaType: string
  url: string | null
  fileSize: number
  createdAt: Date | null
}

/** A pending auto-memory suggestion as the rail consumes it. */
export interface MemorySuggestion {
  id: number
  text: string
  createdAt: string | Date | null
}

/** A chat row on a project's landing page (title + first-message snippet), as
 * returned by getProjectChatPreviews. Single source of truth — previously
 * duplicated inline in page.tsx and ProjectLandingPage. */
export interface ChatPreview {
  id: number
  title: string
  preview: string | null
  createdAt: Date | null
}

/** The chat actions ChatContextMenu surfaces on an active (non-archived) chat row.
 * Shared by the sidebar (SidebarActions extends this) and the project landing
 * page's chat list, so both call sites stay assignable to one narrow shape. */
export interface ChatRowActions {
  moveChat: (chatId: number, projectId: number | null) => void
  renameChat: (chatId: number) => void
  archiveChat: (chatId: number) => void
  deleteChat: (chatId: number) => void
}
