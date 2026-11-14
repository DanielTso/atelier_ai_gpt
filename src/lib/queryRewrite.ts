import { generateText } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { getGeminiApiKey } from './settings'
import { recordUsage } from './usage'

const REWRITE_MODEL = 'gemini-3.5-flash'
const REWRITE_PROMPT =
  "Rewrite the user's latest message into a single, self-contained search query for retrieving relevant documents and past messages. Resolve pronouns and references using the conversation. Return ONLY the query text — no quotes, no explanation."

export interface Turn { role: string; text: string }

/** The chat a retrieval call runs for — its usage_events row is billed to it. */
export interface UsageContext { chatId: number | null; projectId: number | null }

/**
 * Conversation -> standalone retrieval query. Falls back to the last user message.
 * Fails fast (no SDK retries): it runs before the first token of a chat turn, and
 * the caller bounds it further with `abortSignal`. A completed call writes one
 * best-effort usage row (purpose 'query-rewrite').
 */
export async function rewriteQuery(turns: Turn[], opts: { abortSignal?: AbortSignal; usage?: UsageContext } = {}): Promise<string> {
  const lastUserText = [...turns].reverse().find(t => t.role === 'user')?.text ?? ''
  try {
    const apiKey = await getGeminiApiKey()
    if (!apiKey) return lastUserText
    const recent = turns.slice(-6).map(t => `${t.role}: ${t.text}`).join('\n')
    const google = createGoogleGenerativeAI({ apiKey })
    const result = await generateText({
      model: google(REWRITE_MODEL),
      messages: [
        { role: 'user', content: REWRITE_PROMPT + '\n\n' + recent },
      ],
      maxOutputTokens: 100,
      maxRetries: 0,
      abortSignal: opts.abortSignal,
    })
    void recordUsage({
      chatId: opts.usage?.chatId ?? null, projectId: opts.usage?.projectId ?? null,
      purpose: 'query-rewrite', model: REWRITE_MODEL, usage: result.totalUsage,
    }).catch(() => {})
    return result.text.trim() || lastUserText
  } catch {
    return lastUserText
  }
}
