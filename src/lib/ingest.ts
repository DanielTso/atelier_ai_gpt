// Shared post-extraction tail: chunk → save → embed → status. Used by the file
// upload pipeline (documents/process) and web ingestion (documents/web-ingest).
import { saveDocumentChunks, updateDocumentStatus } from '@/app/actions'
import { chunkText } from '@/lib/chunking'
import { embedChunks } from '@/lib/embedChunks'

export async function ingestText(
  doc: { id: number; projectId: number },
  textContent: string,
  opts: { extractionMethod: 'text' | 'vision'; thumbnailPath?: string; pageCount?: number | null; pagesExtracted?: number | null; partial?: boolean },
): Promise<{ status: 'ready' | 'error'; chunkCount: number }> {
  const textChunks = chunkText(textContent)
  const saved = await saveDocumentChunks(textChunks.map(c => ({
    documentId: doc.id, projectId: doc.projectId, chunkIndex: c.index, content: c.content,
  })))
  const { embedded, failed } = await embedChunks(saved)
  if (failed > 0) console.warn(`[ingest] ${failed}/${saved.length} chunks failed to embed`)
  const status: 'ready' | 'error' = embedded === 0 && saved.length > 0 ? 'error' : 'ready'
  // A partial extraction (char-truncation / page-capping) OR any post-retry embed failure
  // is a fidelity hole — surface it, never hide it.
  const extractionPartial = Boolean(opts.partial) || failed > 0
  await updateDocumentStatus(doc.id, status, {
    chunkCount: saved.length, charCount: textContent.length,
    thumbnailPath: opts.thumbnailPath, extractionMethod: opts.extractionMethod,
    pageCount: opts.pageCount ?? null, pagesExtracted: opts.pagesExtracted ?? null,
    extractionPartial,
  })
  return { status, chunkCount: saved.length }
}
