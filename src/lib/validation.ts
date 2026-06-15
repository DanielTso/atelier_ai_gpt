import { z } from 'zod'

export const chatRequestSchema = z.object({
  messages: z.array(z.any()).min(1),
  model: z.string().optional(),
  chatId: z.number().nullable().optional(),
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
  projectId: z.number().int().positive(),
  filename: z.string().min(1).max(255),
  contentType: z.string().min(1),
  size: z.number().int().positive(),
})

export const processDocumentRequestSchema = z.object({
  documentId: z.number().int().positive(),
})
