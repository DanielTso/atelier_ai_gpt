import { z } from 'zod'

// Shape guard ONLY. This is not an allow-list — it just rejects garbage before
// it reaches a provider call (empty string, absurd length, or characters no
// model id ever has). The real allow-list is the live model registry
// (`registry.byId`, consulted via `resolveRequestedModel()` in
// src/lib/models/registry.ts), which knows exactly which ids Anthropic/Gemini
// currently serve plus legacy pins, and degrades an unknown/stale id to the
// current default instead of rejecting the request. A hardcoded enum here
// would 400 the moment a persisted id (e.g. a project's `default_model`) falls
// out of date — that was the bug this replaces.
const modelIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9.-]*$/i, 'invalid model id')

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
  model: modelIdSchema.optional(),
  chatId: z.number().nullable().optional(),
  effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
  // Grounded & Cited Answers: grounded restricts answers to project documents;
  // excludedDocumentIds scopes retrieval/manifest/read_document per chat.
  grounded: z.boolean().optional(),
  excludedDocumentIds: z.array(z.number().int().positive()).max(200).optional(),
})

export const summarizeRequestSchema = z.object({
  chatId: z.number(),
  cutoffMessageId: z.number(),
  // Accepted for wire compatibility (useSummarization.ts still sends it) but
  // intentionally ignored server-side — the route hardcodes gemini-3.5-flash.
  model: modelIdSchema.optional(),
})

export const generateTitleRequestSchema = z.object({
  chatId: z.number(),
  messages: z.array(uiMessageSchema).min(1),
  // Accepted for wire compatibility (useChatTitle.ts still sends it) but
  // intentionally ignored server-side — the route hardcodes gemini-3.5-flash.
  model: modelIdSchema.optional(),
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
  // Ignored: the route files the embedding under the chat's DB project. Kept
  // optional for one release so older clients still validate.
  projectId: z.number().nullable().optional(),
  content: z.string().min(1),
})

export const classifyRequestSchema = z.object({
  chatId: z.number(),
  messages: z.array(uiMessageSchema).min(1),
  // Accepted for wire compatibility (tolerates a caller-supplied model) but
  // intentionally ignored server-side — the route hardcodes gemini-3.5-flash.
  model: modelIdSchema.optional(),
})

export const memorySuggestRequestSchema = z.object({
  // Ignored: the route derives the project from `chatId`. Kept optional for one
  // release so older clients still validate.
  projectId: z.number().int().positive().optional(),
  chatId: z.number().int().positive(),
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

// Chat attachment that is uploaded straight to Storage only to be text-extracted
// (keeps large files off Vercel's 4.5 MB request-body limit). chatId is null
// while composing the first message of a chat that doesn't exist yet.
export const attachmentUploadUrlRequestSchema = z.object({
  chatId: z.number().int().positive().nullable(),
  filename: z.string().min(1).max(255),
  mediaType: z.string().min(1).max(255),
  size: z.number().int().positive(),
})

// POST /api/extract with a JSON body: extract from a pending attachment upload.
// The path is checked against the chat's pending prefix in the route.
export const extractRequestSchema = z.object({
  chatId: z.number().int().positive().nullable(),
  storagePath: z.string().min(1).max(1024),
  mediaType: z.string().max(255).optional(),
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
