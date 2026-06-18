import { embed } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { sql, and, eq, gt, desc, cosineDistance } from 'drizzle-orm'
import { db } from '@/db'
import { messageEmbeddings, documentChunks, documents } from '@/db/schema'
import { getGeminiApiKey } from './settings'
import { saveMessageEmbedding } from '@/app/actions'

const GEMINI_EMBEDDING_MODEL = 'gemini-embedding-001'

export type EmbeddingProvider = 'gemini' | null

let embeddingModelCache: { result: { available: boolean; provider: EmbeddingProvider }; expiresAt: number } | null = null
const EMBEDDING_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Check if an embedding provider is available.
 * Returns 'gemini' if a Gemini API key is configured, null otherwise.
 */
export async function ensureEmbeddingModel(): Promise<{ available: boolean; provider: EmbeddingProvider }> {
  if (embeddingModelCache && Date.now() < embeddingModelCache.expiresAt) {
    return embeddingModelCache.result
  }

  const apiKey = await getGeminiApiKey()
  if (apiKey) {
    const result = { available: true, provider: 'gemini' as EmbeddingProvider }
    embeddingModelCache = { result, expiresAt: Date.now() + EMBEDDING_CACHE_TTL }
    return result
  }

  const result = { available: false, provider: null }
  embeddingModelCache = { result, expiresAt: Date.now() + EMBEDDING_CACHE_TTL }
  return result
}

/**
 * Generate an embedding using Google Gemini gemini-embedding-001.
 * Returns a 768-dimensional float array.
 */
export async function generateEmbedding(
  text: string,
  taskType: 'query' | 'document' = 'document'
): Promise<number[]> {
  const apiKey = await getGeminiApiKey()
  if (!apiKey) {
    throw new Error('Gemini API key not configured')
  }

  const google = createGoogleGenerativeAI({ apiKey })
  const { embedding } = await embed({
    model: google.textEmbeddingModel(GEMINI_EMBEDDING_MODEL),
    value: text,
    providerOptions: {
      google: {
        outputDimensionality: 768,
        taskType: taskType === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT',
      },
    },
  })

  return embedding
}

/**
 * Find messages semantically similar to the query embedding.
 * Searches within the specified scope (chat or project).
 */
export async function findSimilarMessages(
  queryEmbedding: number[],
  scope: { chatId?: number; projectId?: number },
  topK: number = 5,
  threshold: number = 0.7
): Promise<{ content: string; similarity: number; chatId: number; messageId: number; embedding: number[] }[]> {
  const similarity = sql<number>`1 - (${cosineDistance(messageEmbeddings.embedding, queryEmbedding)})`
  const scopeFilter = scope.projectId
    ? eq(messageEmbeddings.projectId, scope.projectId)
    : scope.chatId
      ? eq(messageEmbeddings.chatId, scope.chatId)
      : undefined
  return db.select({
    content: messageEmbeddings.content,
    similarity,
    chatId: messageEmbeddings.chatId,
    messageId: messageEmbeddings.messageId,
    embedding: messageEmbeddings.embedding,
  }).from(messageEmbeddings)
    .where(scopeFilter ? and(scopeFilter, gt(similarity, threshold)) : gt(similarity, threshold))
    .orderBy(desc(similarity))
    .limit(topK)
}

/**
 * Find document chunks semantically similar to the query embedding.
 * Searches within a specific project's uploaded documents.
 */
export async function findSimilarDocumentChunks(
  queryEmbedding: number[],
  projectId: number,
  topK: number = 3,
  threshold: number = 0.5
): Promise<{ content: string; similarity: number; chunkId: number; documentId: number; filename: string; embedding: number[] | null }[]> {
  const similarity = sql<number>`1 - (${cosineDistance(documentChunks.embedding, queryEmbedding)})`
  return db.select({
    content: documentChunks.content,
    similarity,
    chunkId: documentChunks.id,
    documentId: documentChunks.documentId,
    filename: documents.filename,
    embedding: documentChunks.embedding,
  }).from(documentChunks)
    .innerJoin(documents, eq(documentChunks.documentId, documents.id))
    .where(and(eq(documentChunks.projectId, projectId), gt(similarity, threshold)))
    .orderBy(desc(similarity))
    .limit(topK)
}

/**
 * Generate an embedding for a message and store it in the database.
 * Silently fails if no embedding provider is available.
 */
export async function embedAndStore(
  messageId: number,
  chatId: number,
  projectId: number | null,
  content: string
): Promise<void> {
  const embedding = await generateEmbedding(content)
  await saveMessageEmbedding(messageId, chatId, projectId, content, embedding)
}
