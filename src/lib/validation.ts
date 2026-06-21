import { z } from 'zod'

// Allow-list of model IDs the app will route to. Prevents an unauthenticated /
// crafted request from selecting an arbitrary (e.g. far more expensive) model.
// User-selectable models (see /api/models) + the internal housekeeping model.
export const MODEL_IDS = [
  'claude-opus-4-8',
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
