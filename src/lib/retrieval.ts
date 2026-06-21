import type { UIMessage } from 'ai'
import { generateEmbedding, findSimilarMessages, findSimilarDocumentChunks } from './embeddings'
import { rewriteQuery, type Turn } from './queryRewrite'
import { rerankCandidates } from './rerank'
import { mmr, type MmrItem } from './mmr'
import { getRagConfig } from './ragConfig'

function textOf(m: UIMessage): string {
  return (m.parts ?? [])
    .filter((p: { type: string }): p is { type: 'text'; text: string } => p.type === 'text')
    .map((p: { text: string }) => p.text)
    .join('')
}

export async function retrieveContext(
  messages: UIMessage[],
  scope: { chatId: number; projectId: number | null },
): Promise<{ semanticContext: string | null; documentContext: string | null }> {
  const empty = { semanticContext: null as string | null, documentContext: null as string | null }
  try {
    const cfg = getRagConfig()
    const turns: Turn[] = messages.map(msg => ({ role: msg.role, text: textOf(msg) })).filter(t => t.text)
    const lastUserText = [...turns].reverse().find(t => t.role === 'user')?.text ?? ''
    if (!lastUserText) return empty

    // Skip query-rewrite on the first turn — there's no prior context to resolve,
    // so it's a pure Flash round-trip of overhead.
    const query = (cfg.rewriteEnabled && turns.length > 1) ? await rewriteQuery(turns) : lastUserText
    const queryEmbedding = await generateEmbedding(query, 'query')
    const recentIds = new Set(messages.map(msg => String(msg.id)))

    // Message and document retrieval are independent (both only need the query
    // embedding) — run them concurrently so their rerank Flash calls overlap
    // instead of running back-to-back on the chat critical path.
    const messagesP = (async (): Promise<string | null> => {
      let msgCands = (await findSimilarMessages(
        queryEmbedding,
        { projectId: scope.projectId ?? undefined, chatId: !scope.projectId ? scope.chatId : undefined },
        cfg.topN, cfg.msgThreshold,
      )).filter(c => !recentIds.has(String(c.messageId)))
      if (cfg.mmrEnabled) msgCands = mmr(msgCands as (typeof msgCands[number] & MmrItem)[], cfg.msgTopK * 2, cfg.mmrLambda)
      const msgFinal = cfg.rerankEnabled ? await rerankCandidates(query, msgCands, cfg.msgTopK) : msgCands.slice(0, cfg.msgTopK)
      return msgFinal.length > 0 ? msgFinal.map(s => s.content).join('\n---\n') : null
    })()

    const documentsP = (async (): Promise<string | null> => {
      if (!scope.projectId) return null
      try {
        let docCands = await findSimilarDocumentChunks(queryEmbedding, scope.projectId, cfg.topN, cfg.docThreshold)
        if (cfg.mmrEnabled) {
          docCands = mmr(
            docCands.filter(c => c.embedding != null) as (typeof docCands[number] & MmrItem)[],
            cfg.docTopK * 2, cfg.mmrLambda,
          )
        }
        const docFinal = cfg.rerankEnabled ? await rerankCandidates(query, docCands, cfg.docTopK) : docCands.slice(0, cfg.docTopK)
        return docFinal.length > 0 ? docFinal.map(c => `[From: ${c.filename}]\n${c.content}`).join('\n---\n') : null
      } catch {
        return null // Document retrieval is best-effort
      }
    })()

    const [semanticContext, documentContext] = await Promise.all([messagesP, documentsP])
    return { semanticContext, documentContext }
  } catch {
    return empty
  }
}
