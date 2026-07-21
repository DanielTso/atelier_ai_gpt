import { z } from 'zod'

// Allow-list of model IDs the app will route to. Prevents an unauthenticated /
// crafted request from selecting an arbitrary (e.g. far more expensive) model.
// User-selectable models (see /api/models) + the internal housekeeping model.
export const MODEL_IDS = [
  'claude-opus-4-8',
  'claude-fable-5',
  'claude-sonnet-5',
  // Retired from the picker (superseded by Sonnet 5) but kept here so chats
  // already pinned to it keep routing instead of being rejected by this enum.
  'claude-sonnet-4-6',
  'claude-haiku-4-5',
  'gemini-3.1-flash-image',
  'gemini-3.5-flash',
] as const

const modelEnum = z.enum(MODEL_IDS)

// Loose-but-real shape for AI SDK UI messages: require a string role, allow the
// usual optional content/parts, and passthrough the rest (id, etc.). Replaces the
// former `z.array(z.any())` so the LLM routes at least validate message structure.
export const uiMessageSchema = z.object({
  role: z.string(),
  content: z.string().optional(),
  parts: z.array(z.any()).optional(),
}).passthrough()

export const chatRequestSchema = z.object({
  messages: z.array(uiMessageSchema).min(1),
  model: modelEnum.optional(),
  chatId: z.number().nullable().optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
  // Grounded & Cited Answers: grounded restricts answers to project documents;
  // excludedDocumentIds scopes retrieval/manifest/read_document per chat.
  grounded: z.boolean().optional(),
  excludedDocumentIds: z.array(z.number().int().positive()).max(200).optional(),
})

export const summarizeRequestSchema = z.object({
  chatId: z.number(),
  cutoffMessageId: z.number(),
  model: modelEnum.optional(),
})

export const generateTitleRequestSchema = z.object({
  chatId: z.number(),
  messages: z.array(uiMessageSchema).min(1),
  model: modelEnum.optional(),
})

export const suggestFollowupsRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string(),
  })).min(1).max(4),
})

export const embedRequestSchema = z.object({
  messageId: z.number(),
  chatId: z.number(),
  projectId: z.number().nullable().optional(),
  content: z.string().min(1),
})

export const classifyRequestSchema = z.object({
  chatId: z.number(),
  messages: z.array(uiMessageSchema).min(1),
  model: modelEnum.optional(),
})

export const memorySuggestRequestSchema = z.object({
  projectId: z.number().int().positive(),
  chatId: z.number().int().positive().optional(),
  messages: z.array(uiMessageSchema).min(1),
})

export const uploadUrlRequestSchema = z.object({
  // Required for a new upload; omitted for a replace (derived from the existing doc).
  projectId: z.number().int().positive().optional(),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
  // When set, this upload replaces an existing document with a new revision.
  replaceDocumentId: z.number().int().positive().optional(),
})

// D2.2 — edit an artifact's source (markdown string or sheets array) → new version.
export const artifactEditRequestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  content: z.union([z.string(), z.array(z.any())]),
})

// D2.2 — regenerate an artifact via Claude from a natural-language instruction.
export const artifactRegenerateRequestSchema = z.object({
  instruction: z.string().min(1).max(2000),
})

export const processDocumentRequestSchema = z.object({
  documentId: z.number().int().positive(),
  // Replace flow: the presence of `filename` marks this as a replace. The new
  // revision's storage path is DERIVED server-side from the document row (never
  // trusted from the client), so a caller can't point processing at an arbitrary
  // object in the bucket.
  filename: z.string().min(1).max(255).optional(),
  mimeType: z.string().min(1).optional(),
  fileSize: z.number().int().positive().optional(),
})

export const imageGenerateRequestSchema = z.object({
  prompt: z.string().min(1).max(1500),
  aspectRatio: z.enum(['1:1', '16:9', '9:16', '4:3', '3:4']).optional(),
  projectId: z.number().int().positive().optional(),
})

export const webMapRequestSchema = z.object({
  url: z.string().url(),
  maxDepth: z.number().int().min(1).max(3).optional(),
  limit: z.number().int().min(1).max(100).optional(),
})

export const webIngestRequestSchema = z.object({
  url: z.string().url(),
  projectId: z.number().int().positive(),
})
