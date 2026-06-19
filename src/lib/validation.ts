import { z } from 'zod'

export const chatRequestSchema = z.object({
  messages: z.array(z.any()).min(1),
  model: z.string().optional(),
  chatId: z.number().nullable().optional(),
  effort: z.enum(['low', 'medium', 'high', 'max']).optional(),
})

export const summarizeRequestSchema = z.object({
  chatId: z.number(),
  cutoffMessageId: z.number(),
  model: z.string().optional(),
})

export const generateTitleRequestSchema = z.object({
  chatId: z.number(),
  messages: z.array(z.object({
    role: z.string(),
    content: z.string().optional(),
    parts: z.array(z.any()).optional(),
  })).min(1),
  model: z.string().optional(),
})

export const embedRequestSchema = z.object({
  messageId: z.number(),
  chatId: z.number(),
  projectId: z.number().nullable().optional(),
  content: z.string().min(1),
})

export const classifyRequestSchema = z.object({
  chatId: z.number(),
  messages: z.array(z.any()).min(1),
  model: z.string().optional(),
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
  // Replace flow: process this new revision file (and its metadata) instead of
  // the document's current file. All four are sent together by the client.
  storagePath: z.string().min(1).optional(),
  filename: z.string().min(1).max(255).optional(),
  mimeType: z.string().min(1).optional(),
  fileSize: z.number().int().positive().optional(),
})
