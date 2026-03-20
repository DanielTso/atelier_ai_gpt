import { embed } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getOllamaBaseUrl, getGeminiApiKey, isCloudEnvironment } from './settings'
import { saveMessageEmbedding, getEmbeddingsForChat, getEmbeddingsForProject, getAllEmbeddings, getDocumentChunksForProject } from '@/app/actions'

const EMBEDDING_MODEL = 'nomic-embed-text'
const GEMINI_EMBEDDING_MODEL = 'text-embedding-004'

export type EmbeddingProvider = 'ollama' | 'gemini' | null

let embeddingModelCache: { result: { available: boolean; provider: EmbeddingProvider }; expiresAt: number } | null = null
const EMBEDDING_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

export function clearEmbeddingModelCache() {
  embeddingModelCache = null
}

/**
 * Check if an embedding provider is available.
 * Returns the provider name ('ollama' or 'gemini') or null if none available.
 */
export async function ensureEmbeddingModel(): Promise<{ available: boolean; provider: EmbeddingProvider }> {
  if (embeddingModelCache && Date.now() < embeddingModelCache.expiresAt) {
    return embeddingModelCache.result
  }

  // Skip Ollama on cloud — go straight to Gemini
  if (!isCloudEnvironment()) {
    try {
      const baseUrl = await getOllamaBaseUrl()
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(1000),
      })
      if (res.ok) {
        const data = await res.json()
        const models: { name: string }[] = data.models || []
        if (models.some(m => m.name.startsWith(EMBEDDING_MODEL))) {
          const result = { available: true, provider: 'ollama' as EmbeddingProvider }
          embeddingModelCache = { result, expiresAt: Date.now() + EMBEDDING_CACHE_TTL }
          return result
        }
      }
    } catch {
      // Ollama unavailable, try Gemini
    }
  }

  // Gemini fallback (or primary on cloud)
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
 * Generate an embedding using Ollama's nomic-embed-text model.
 * Returns a 768-dimensional float array.
 */
async function generateEmbeddingWithOllama(text: string): Promise<number[]> {
  const baseUrl = await getOllamaBaseUrl()
  const res = await fetch(`${baseUrl}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      prompt: text,
    }),
    signal: AbortSignal.timeout(10000),
  })

  if (!res.ok) {
    throw new Error(`Ollama embedding failed: ${res.status} ${res.statusText}`)
  }

  const data = await res.json()
  return data.embedding
}

/**
 * Generate an embedding using Google Gemini text-embedding-004.
 * Returns a 768-dimensional float array (matching nomic-embed-text).
 */
async function generateEmbeddingWithGemini(
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
 * Generate an embedding vector for the given text.
 * Tries Ollama first, falls back to Gemini if unavailable.
 * Returns a 768-dimensional float array.
 */
export async function generateEmbedding(
  text: string,
  taskType: 'query' | 'document' = 'document'
): Promise<number[]> {
  // Skip Ollama on cloud — use Gemini directly
  if (!isCloudEnvironment()) {
    try {
      return await generateEmbeddingWithOllama(text)
    } catch {
      // Ollama unavailable, try Gemini
    }
  }

  return generateEmbeddingWithGemini(text, taskType)
}

/**
 * Compute cosine similarity between two vectors.
 * Returns a value between -1 and 1 (1 = identical direction).
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    console.warn(`[Embeddings] Vector dimension mismatch: ${a.length} vs ${b.length}`)
    return 0
  }

  let dotProduct = 0
  let normA = 0
  let normB = 0

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  if (denominator === 0) return 0

  return dotProduct / denominator
}

/**
 * Find messages semantically similar to the query embedding.
 * Searches within the specified scope (chat, project, or all).
 */
export async function findSimilarMessages(
  queryEmbedding: number[],
  scope: { chatId?: number; projectId?: number },
  topK: number = 5,
  threshold: number = 0.7
): Promise<{ content: string; similarity: number; chatId: number; messageId: number }[]> {
  // Load embeddings based on scope
  let embeddings
  if (scope.projectId) {
    embeddings = await getEmbeddingsForProject(scope.projectId)
  } else if (scope.chatId) {
    embeddings = await getEmbeddingsForChat(scope.chatId)
  } else {
    embeddings = await getAllEmbeddings()
  }

  // Compute similarities
  const scored = embeddings.map(e => {
    const vector = JSON.parse(e.embedding) as number[]
    return {
      content: e.content,
      similarity: cosineSimilarity(queryEmbedding, vector),
      chatId: e.chatId,
      messageId: e.messageId,
    }
  })

  // Filter and sort
  return scored
    .filter(s => s.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
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
): Promise<{ content: string; similarity: number; chunkId: number; documentId: number; filename: string }[]> {
  const chunks = await getDocumentChunksForProject(projectId)

  const scored = chunks.map(c => {
    const vector = JSON.parse(c.embedding!) as number[]
    return {
      content: c.content,
      similarity: cosineSimilarity(queryEmbedding, vector),
      chunkId: c.id,
      documentId: c.documentId,
      filename: c.filename,
    }
  })

  return scored
    .filter(s => s.similarity >= threshold)
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
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
