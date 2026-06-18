import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from './settings'

const RERANK_MODEL = 'gemini-3.5-flash'

/**
 * Re-score candidates for relevance to the query with an LLM and return the
 * top-K reordered. Best-effort: any failure / missing key / unparseable output
 * falls back to the original order (sliced to topK).
 */
export async function rerankCandidates<T extends { content: string }>(
  query: string,
  candidates: T[],
  topK: number,
): Promise<T[]> {
  if (candidates.length <= 1) return candidates.slice(0, topK)
  try {
    const apiKey = await getGeminiApiKey()
    if (!apiKey) return candidates.slice(0, topK)
    const list = candidates.map((c, i) => `[${i}] ${c.content.slice(0, 500)}`).join('\n\n')
    const prompt =
      `Query: ${query}\n\nCandidates:\n${list}\n\n` +
      `Return ONLY a JSON array of {"index": <candidate number>, "score": <0-100 relevance>} ` +
      `for the candidates, sorted most-relevant first.`
    const google = createGoogleGenerativeAI({ apiKey })
    const { text } = await generateText({ model: google(RERANK_MODEL), prompt, maxOutputTokens: 500 })
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return candidates.slice(0, topK)
    const scored = JSON.parse(match[0]) as { index: number; score: number }[]
    const ordered = scored
      .filter(s => Number.isInteger(s.index) && s.index >= 0 && s.index < candidates.length)
      .sort((a, b) => b.score - a.score)
      .map(s => candidates[s.index])
      .filter((c): c is T => c !== undefined)
    const seen = new Set(ordered)
    const result = [...ordered, ...candidates.filter(c => !seen.has(c))]
    return result.slice(0, topK)
  } catch {
    return candidates.slice(0, topK)
  }
}
