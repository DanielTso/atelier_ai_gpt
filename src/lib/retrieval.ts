import type { UIMessage } from 'ai'
import { generateEmbedding, findSimilarMessages, findSimilarDocumentChunks } from './embeddings'
import { rewriteQuery, type Turn } from './queryRewrite'
import { rerankCandidates } from './rerank'
import { mmr, type MmrItem } from './mmr'
import { getRagConfig } from './ragConfig'
import { extractText } from './messageParts'
import { findChunksByKeyword } from './keywordSearch'
import { rrfFuse } from './rrf'

// Shared shape for both retrieval legs (vector + keyword) so they can be RRF-fused
// and MMR-selected through one code path. Vector candidates carry an extra
// `similarity` field, which is fine — it's just unused by DocCand consumers.
type DocCand = { content: string; chunkId: number; documentId: number; filename: string; pageStart: number | null; pageEnd: number | null; embedding: number[] | null }

export async function retrieveContext(
  messages: UIMessage[],
  scope: { chatId: number; projectId: number | null; excludeDocumentIds?: number[] },
): Promise<{ semanticContext: string | null; documentContext: string | null }> {
  const empty = { semanticContext: null as string | null, documentContext: null as string | null }
  try {
    const cfg = getRagConfig()
    const turns: Turn[] = messages.map(msg => ({ role: msg.role, text: extractText(msg.parts) })).filter(t => t.text)
    const lastUserText = [...turns].reverse().find(t => t.role === 'user')?.text ?? ''
    if (!lastUserText) return empty

    // Skip query-rewrite on the first turn — there's no prior context to resolve,
    // so it's a pure Flash round-trip of overhead.
    const query = (cfg.rewriteEnabled && turns.length > 1) ? await rewriteQuery(turns) : lastUserText
    const queryEmbedding = await generateEmbedding(query, 'query')
    // Exclude messages already in the prompt from semantic results. NOTE: this matches
    // String(msg.id) against the DB messageId, which only aligns for RELOADED messages
    // (whose UI id IS the DB integer id). Just-sent messages carry client UUID ids that
    // never match — they're safe only because they have no embedding yet (embeddings are
    // written async after the exchange), so they aren't retrieval candidates. If that
    // timing ever changes, this dedup must switch to a stable id the route controls.
    const recentIds = new Set(messages.map(msg => String(msg.id)))

    // Message and document retrieval are independent (both only need the query
    // embedding) — run them concurrently so their rerank Flash calls overlap
    // instead of running back-to-back on the chat critical path.
    const messagesP = (async (): Promise<string | null> => {
      try {
        // Only fetch the embedding column when MMR will actually consume it.
        let msgCands = (await findSimilarMessages(
          queryEmbedding,
          { projectId: scope.projectId ?? undefined, chatId: !scope.projectId ? scope.chatId : undefined },
          cfg.topN, cfg.msgThreshold, cfg.mmrEnabled,
        )).filter(c => !recentIds.has(String(c.messageId)))
        if (cfg.mmrEnabled) msgCands = mmr(msgCands as (typeof msgCands[number] & MmrItem)[], cfg.msgTopK * 2, cfg.mmrLambda)
        const msgFinal = cfg.rerankEnabled ? await rerankCandidates(query, msgCands, cfg.msgTopK) : msgCands.slice(0, cfg.msgTopK)
        return msgFinal.length > 0 ? msgFinal.map(s => s.content).join('\n---\n') : null
      } catch (e) {
        // Guard the message path independently so a failure here can't also null out
        // document context (which has its own try/catch below).
        console.warn('[retrieval] message retrieval failed:', e instanceof Error ? e.message : e)
        return null
      }
    })()

    const documentsP = (async (): Promise<string | null> => {
      if (!scope.projectId) return null
      try {
        const [vecCands, kwCands]: [DocCand[], DocCand[]] = await Promise.all([
          findSimilarDocumentChunks(queryEmbedding, scope.projectId, cfg.topN, cfg.docThreshold, cfg.mmrEnabled, scope.excludeDocumentIds),
          cfg.hybridEnabled
            ? findChunksByKeyword(query, scope.projectId, cfg.keywordTopN, scope.excludeDocumentIds).catch(e => {
                // Keyword leg is best-effort: a failure degrades to vector-only.
                console.warn('[retrieval] keyword search failed:', e instanceof Error ? e.message : e)
                return []
              })
            : Promise.resolve([]),
        ])
        // Vector list FIRST so shared ids keep their embedding (and similarity) for MMR.
        let docCands: DocCand[] = rrfFuse([vecCands, kwCands], cfg.rrfK)
        let keywordOnly: DocCand[] = []
        if (cfg.mmrEnabled) {
          // MMR needs embeddings; keyword-only hits have none but are exact
          // matches by construction — keep them alongside the MMR picks.
          const embedded = docCands.filter(c => c.embedding != null)
          const kwTail = docCands.filter(c => c.embedding == null).slice(0, cfg.docTopK)
          const picked = mmr(embedded as unknown as (DocCand & MmrItem)[], cfg.docTopK * 2, cfg.mmrLambda)
          const seen = new Set(picked.map(c => c.chunkId))
          keywordOnly = kwTail.filter(c => !seen.has(c.chunkId))
          docCands = [...picked, ...keywordOnly]
        }
        let docFinal: DocCand[]
        if (cfg.rerankEnabled) {
          docFinal = await rerankCandidates(query, docCands, cfg.docTopK)
        } else {
          // Without rerank, a plain head-slice would consume entirely from the MMR
          // picks (typically docTopK*2 of them) and silently drop the keyword-only
          // tail — reserve slots for the keyword-only exact matches instead.
          const kwIds = new Set(keywordOnly.map(c => c.chunkId))
          docFinal = [
            ...docCands.filter(c => !kwIds.has(c.chunkId)).slice(0, Math.max(0, cfg.docTopK - keywordOnly.length)),
            ...keywordOnly,
          ].slice(0, cfg.docTopK)
        }
        // Self-describing source header so the model can cite exactly what it used:
        // [Source: doc <id> "<filename>" p.<start>[–<end>] §c<chunkId>]. The §c anchor
        // is always present; pages appear only when the chunk was page-stamped.
        return docFinal.length > 0
          ? docFinal.map(c => {
              const pages = c.pageStart != null
                ? ` p.${c.pageStart}${c.pageEnd != null && c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ''}` : ''
              return `[Source: doc ${c.documentId} "${c.filename}"${pages} §c${c.chunkId}]\n${c.content}`
            }).join('\n---\n')
          : null
      } catch (e) {
        console.warn('[retrieval] document retrieval failed:', e instanceof Error ? e.message : e)
        return null // Document retrieval is best-effort
      }
    })()

    const [semanticContext, documentContext] = await Promise.all([messagesP, documentsP])
    return { semanticContext, documentContext }
  } catch (e) {
    console.warn('[retrieval] retrieval pipeline failed:', e instanceof Error ? e.message : e)
    return empty
  }
}
