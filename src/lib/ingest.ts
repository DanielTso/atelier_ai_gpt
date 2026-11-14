// Shared post-extraction tail: chunk → embed → save chunks + status. Used by the
// file upload pipeline (documents/process) and web ingestion (documents/web-ingest).
import { commitDocumentIngest } from '@/app/actions'
import { chunkText } from '@/lib/chunking'
import { embedContents } from '@/lib/embedChunks'
import { buildPageMap, pageRangeFor } from '@/lib/pageMap'

export async function ingestText(
  doc: { id: number; projectId: number },
  textContent: string,
  opts: { extractionMethod: 'text' | 'vision' | 'hybrid'; thumbnailPath?: string; pageCount?: number | null; pagesExtracted?: number | null; partial?: boolean; failedPages?: number[] | null },
): Promise<{ status: 'ready' | 'error'; chunkCount: number }> {
  const textChunks = chunkText(textContent)
  // Page provenance: map '# Page n' anchors once over the full text, then stamp each
  // chunk's page range from its char offsets (null when the text has no anchors).
  const pageMap = buildPageMap(textContent)
  // Embed FIRST, with nothing written yet (same contract as the replace path), then
  // swap the chunk set and write the status in one transaction (audit D2). A repeated
  // or concurrent call for the same document replaces the chunk set instead of
  // adding a second one, and a throw part-way leaves the previous chunks intact.
  const { embeddings, embedded, failed, aborted } = await embedContents(textChunks.map(c => c.content))
  if (failed > 0) console.warn(`[ingest] ${failed}/${textChunks.length} chunks failed to embed${aborted ? ' (stopped early: provider failing)' : ''}`)
  const status: 'ready' | 'error' = embedded === 0 && textChunks.length > 0 ? 'error' : 'ready'
  // A partial extraction (char-truncation / page-capping) OR any post-retry embed failure
  // is a fidelity hole — surface it, never hide it.
  const extractionPartial = Boolean(opts.partial) || failed > 0
  // An error row always says why (audit B21); a ready row gets no message, and
  // the commit clears any stale one left by an earlier failure.
  const errorMessage = status === 'error'
    ? aborted
      ? 'Embedding failed: the embedding provider is not responding. Try again later.'
      : 'Embedding failed for every chunk.'
    : undefined
  // Chunks whose embed failed are still stored (embedding null), as before.
  const chunkRows = textChunks.map((c, i) => ({
    projectId: doc.projectId, chunkIndex: c.index, content: c.content, embedding: embeddings[i] ?? null,
    ...(pageRangeFor(pageMap, c.start, c.end) ?? { pageStart: null, pageEnd: null }),
  }))
  await commitDocumentIngest(doc.id, status, {
    ...(errorMessage && { errorMessage }),
    chunkCount: chunkRows.length, charCount: textContent.length,
    thumbnailPath: opts.thumbnailPath, extractionMethod: opts.extractionMethod,
    pageCount: opts.pageCount ?? null, pagesExtracted: opts.pagesExtracted ?? null,
    extractionPartial, failedPages: opts.failedPages ?? null,
  }, chunkRows)
  return { status, chunkCount: chunkRows.length }
}
