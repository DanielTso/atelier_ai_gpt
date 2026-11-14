import type { UIMessage } from 'ai'
import { generateEmbedding, findSimilarMessages, findSimilarDocumentChunks } from './embeddings'
import { rewriteQuery, type Turn } from './queryRewrite'
import { rerankCandidates } from './rerank'
import { mmr, type MmrItem } from './mmr'
import { getRagConfig } from './ragConfig'
import { extractText } from './messageParts'
import { findChunksByKeyword } from './keywordSearch'
import { rrfFuse } from './rrf'
import { promptSafeLabel } from './promptSafe'
import { withStageTimeout } from './stageTimeout'

// Shared shape for both retrieval legs (vector + keyword) so they can be RRF-fused
// and MMR-selected through one code path. Vector candidates carry an extra
// `similarity` field, which is fine — it's just unused by DocCand consumers.
type DocCand = { content: string; chunkId: number; documentId: number; filename: string; pageStart: number | null; pageEnd: number | null; embedding: number[] | null }
type Fused = DocCand & { rrfScore: number }

export type RetrievalScope = {
  chatId: number
  projectId: number | null
  excludeDocumentIds?: number[]
  // Messages already in the prompt, left out of semantic retrieval (audit B9).
  // `excludeChatId`: the chat's whole history is in the prompt, so none of its rows.
  // `excludeMessageIds`: exactly the DB ids of the messages sent (the route's
  // recentTail); rows trimmed off the front stay retrievable, since no other layer
  // carries them.
  excludeChatId?: number
  excludeMessageIds?: number[]
}

/**
 * Orders the MMR picks and the keyword-matched chunks into one list by fused
 * score, keeping each list's own order (MMR's diversity order, RRF order). Rerank
 * receives this list, and its fallback (failure, timeout, or rerank disabled) is a
 * head slice of it — so a head slice must already be the best fused set.
 */
function mergeByFusedScore(picked: Fused[], exempt: Fused[]): Fused[] {
  const out: Fused[] = []
  let i = 0
  let j = 0
  while (i < picked.length || j < exempt.length) {
    if (j >= exempt.length || (i < picked.length && picked[i]!.rrfScore >= exempt[j]!.rrfScore)) out.push(picked[i++]!)
    else out.push(exempt[j++]!)
  }
  return out
}

export async function retrieveContext(
  messages: UIMessage[],
  scope: RetrievalScope,
): Promise<{ semanticContext: string | null; documentContext: string | null }> {
  const empty = { semanticContext: null as string | null, documentContext: null as string | null }
  try {
    const cfg = getRagConfig()
    const turns: Turn[] = messages.map(msg => ({ role: msg.role, text: extractText(msg.parts) })).filter(t => t.text)
    const lastUserText = [...turns].reverse().find(t => t.role === 'user')?.text ?? ''
    if (!lastUserText) return empty

    // Every Gemini stage below is best-effort, fails fast (maxRetries 0) and is
    // bounded by RAG_STAGE_TIMEOUT_MS; a stage that fails or times out degrades to
    // the stage before it (audit B11).
    const timeoutMs = cfg.stageTimeoutMs

    // Skip query-rewrite on the first turn — there's no prior context to resolve,
    // so it's a pure Flash round-trip of overhead.
    const query = (cfg.rewriteEnabled && turns.length > 1)
      ? await withStageTimeout(timeoutMs, signal => rewriteQuery(turns, { abortSignal: signal })).catch(e => {
          console.warn('[retrieval] query rewrite failed:', e instanceof Error ? e.message : e)
          return lastUserText
        })
      : lastUserText

    // The query embedding feeds the message leg and the vector half of the document
    // leg. Its failure must not take the keyword leg down with it (audit B10): null
    // here skips the vector queries only.
    const embeddingP: Promise<number[] | null> = withStageTimeout(
      timeoutMs, signal => generateEmbedding(query, 'query', { abortSignal: signal, maxRetries: 0 }),
    ).catch(e => {
      console.warn('[retrieval] query embedding failed:', e instanceof Error ? e.message : e)
      return null
    })

    const rerank = <T extends { content: string }>(cands: T[], topK: number): Promise<T[]> =>
      withStageTimeout(timeoutMs, signal => rerankCandidates(query, cands, topK, { abortSignal: signal })).catch(e => {
        console.warn('[retrieval] rerank failed:', e instanceof Error ? e.message : e)
        return cands.slice(0, topK)
      })

    // Message and document retrieval are independent — run them concurrently so
    // their rerank Flash calls overlap instead of running back-to-back on the chat
    // critical path.
    const messagesP = (async (): Promise<string | null> => {
      // A standalone chat searches only its own rows; with its whole history in
      // the prompt there is nothing left to find.
      if (!scope.projectId && scope.excludeChatId === scope.chatId) return null
      try {
        const queryEmbedding = await embeddingP
        if (!queryEmbedding) return null
        // Only fetch the embedding column when MMR will actually consume it.
        let msgCands = await findSimilarMessages(
          queryEmbedding,
          {
            projectId: scope.projectId ?? undefined,
            chatId: !scope.projectId ? scope.chatId : undefined,
            ...(scope.excludeChatId != null && { excludeChatId: scope.excludeChatId }),
            ...(scope.excludeMessageIds && scope.excludeMessageIds.length > 0 && { excludeMessageIds: scope.excludeMessageIds }),
          },
          cfg.topN, cfg.msgThreshold, cfg.mmrEnabled,
        )
        if (cfg.mmrEnabled) msgCands = mmr(msgCands as (typeof msgCands[number] & MmrItem)[], cfg.msgTopK * 2, cfg.mmrLambda)
        const msgFinal = cfg.rerankEnabled ? await rerank(msgCands, cfg.msgTopK) : msgCands.slice(0, cfg.msgTopK)
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
      const projectId = scope.projectId
      try {
        // The keyword leg needs no embedding, so it starts at once, alongside it.
        const kwP: Promise<DocCand[]> = cfg.hybridEnabled
          ? findChunksByKeyword(query, projectId, cfg.keywordTopN, scope.excludeDocumentIds).catch(e => {
              // Keyword leg is best-effort: a failure degrades to vector-only.
              console.warn('[retrieval] keyword search failed:', e instanceof Error ? e.message : e)
              return []
            })
          : Promise.resolve([])
        const vecP: Promise<DocCand[]> = embeddingP.then(queryEmbedding => queryEmbedding
          ? findSimilarDocumentChunks(queryEmbedding, projectId, cfg.topN, cfg.docThreshold, cfg.mmrEnabled, scope.excludeDocumentIds)
          : [])
        const [vecCands, kwCands] = await Promise.all([vecP, kwP])
        // Vector list FIRST so shared ids keep their embedding (and similarity) for MMR.
        let docCands: Fused[] = rrfFuse<DocCand>([vecCands, kwCands], cfg.rrfK)
        if (cfg.mmrEnabled) {
          // Audit B5: chunks the keyword leg found (keyword-only hits, which have
          // no embedding, AND chunks both legs found) are exempt from MMR, so a
          // chunk found by both legs can never fare worse than one found by
          // keyword alone. The rest go through MMR; when fusion ran, its relevance
          // is the normalised RRF score instead of raw similarity, so MMR keeps the
          // fused order and only trades it against diversity.
          const kwIds = new Set(kwCands.map(c => c.chunkId))
          const exempt = docCands.filter(c => kwIds.has(c.chunkId)).slice(0, cfg.docTopK)
          const exemptIds = new Set(exempt.map(c => c.chunkId))
          const maxRrf = docCands[0]?.rrfScore ?? 1
          const pool = docCands
            .filter(c => c.embedding != null && !exemptIds.has(c.chunkId))
            .map(c => (kwCands.length > 0 ? { ...c, relevance: c.rrfScore / maxRrf } : c))
          const picked = mmr(pool as unknown as (Fused & MmrItem)[], cfg.docTopK * 2, cfg.mmrLambda)
          docCands = mergeByFusedScore(picked, exempt)
        }
        const docFinal: DocCand[] = cfg.rerankEnabled
          ? await rerank(docCands, cfg.docTopK)
          : docCands.slice(0, cfg.docTopK)
        // Self-describing source header so the model can cite exactly what it used:
        // [Source: doc <id> "<filename>" p.<start>[–<end>] §c<chunkId>]. The §c anchor
        // is always present; pages appear only when the chunk was page-stamped. The
        // filename is untrusted, so it is sanitized before interpolation.
        return docFinal.length > 0
          ? docFinal.map(c => {
              const pages = c.pageStart != null
                ? ` p.${c.pageStart}${c.pageEnd != null && c.pageEnd !== c.pageStart ? `–${c.pageEnd}` : ''}` : ''
              return `[Source: doc ${c.documentId} "${promptSafeLabel(c.filename)}"${pages} §c${c.chunkId}]\n${c.content}`
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
