// Shared post-extraction tail: chunk → save → embed → status. Used by the file
// upload pipeline (documents/process) and web ingestion (documents/web-ingest)
// so both share one source of truth. Server-only (imports server actions).
import { saveDocumentChunks, updateChunkEmbedding, updateDocumentStatus } from '@/app/actions'
import { generateEmbedding } from '@/lib/embeddings'
import { chunkText } from '@/lib/chunking'

export async function ingestText(
  doc: { id: number; projectId: number },
  textContent: string,
  opts: { extractionMethod: 'text' | 'vision'; thumbnailPath?: string },
): Promise<{ status: 'ready' | 'error'; chunkCount: number }> {
  const textChunks = chunkText(textContent)
  const saved = await saveDocumentChunks(textChunks.map(c => ({
    documentId: doc.id, projectId: doc.projectId, chunkIndex: c.index, content: c.content,
  })))
  const results = await Promise.allSettled(saved.map(async (chunk) => {
    const embedding = await generateEmbedding(chunk.content, 'document')
    await updateChunkEmbedding(chunk.id, embedding)
  }))
  const embedded = results.filter(r => r.status === 'fulfilled').length
  if (results.length - embedded > 0) {
    console.warn(`[ingest] ${results.length - embedded}/${saved.length} chunks failed to embed`)
  }
  const status: 'ready' | 'error' = embedded === 0 && saved.length > 0 ? 'error' : 'ready'
  await updateDocumentStatus(doc.id, status, {
    chunkCount: saved.length, charCount: textContent.length,
    thumbnailPath: opts.thumbnailPath, extractionMethod: opts.extractionMethod,
  })
  return { status, chunkCount: saved.length }
}
