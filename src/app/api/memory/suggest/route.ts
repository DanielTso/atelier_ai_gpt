import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { generateText } from 'ai'
import { getGeminiApiKey } from '@/lib/settings'
import {
  getProjectContext,
  getPendingSuggestions,
  countPendingSuggestions,
  getRecentlyDismissed,
  createMemorySuggestions,
} from '@/app/actions'
import { apiError } from '@/lib/errors'
import { memorySuggestRequestSchema } from '@/lib/validation'

const PENDING_CAP = 10

const MEMORY_SUGGEST_PROMPT = `You extract durable, project-level facts worth remembering from a construction project conversation. Return ONLY a JSON array of short fact strings (max ~12 words each). Good facts: people and their roles, company names, locations/addresses, key dates and milestones, decisions, commitments, specifications. Ignore chit-chat, questions, and anything transient.

Do NOT repeat any fact already present in EXISTING MEMORY, ALREADY SUGGESTED, or RECENTLY DISMISSED below. If nothing new is worth saving, return [].

EXISTING MEMORY:
{memory}

ALREADY SUGGESTED:
{pending}

RECENTLY DISMISSED:
{dismissed}

CONVERSATION:
`

const ok = (body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })

export async function POST(req: Request) {
  try {
    const body = memorySuggestRequestSchema.safeParse(await req.json())
    if (!body.success) {
      return apiError(body.error, 'Invalid request body', 400)
    }
    const { projectId, chatId, messages } = body.data

    const apiKey = await getGeminiApiKey()
    if (!apiKey) return ok({ created: 0 })

    // Cap check — never call the model if the pending queue is full.
    const pendingCount = await countPendingSuggestions(projectId)
    if (pendingCount >= PENDING_CAP) return ok({ created: 0, capped: true })

    const [ctx, pending, dismissed] = await Promise.all([
      getProjectContext(projectId),
      getPendingSuggestions(projectId),
      getRecentlyDismissed(projectId),
    ])

    const conversationText = messages
      .slice(-12)
      .map((m) => {
        const text = m.parts
          ? m.parts.filter((p: { type: string }) => p.type === 'text').map((p: { text?: string }) => p.text).join('')
          : m.content || ''
        return `${m.role}: ${text}`
      })
      .join('\n')

    const prompt =
      MEMORY_SUGGEST_PROMPT
        .replace('{memory}', ctx?.memory?.trim() || '(none)')
        .replace('{pending}', pending.map(p => `- ${p.text}`).join('\n') || '(none)')
        .replace('{dismissed}', dismissed.map(t => `- ${t}`).join('\n') || '(none)') +
      conversationText

    const google = createGoogleGenerativeAI({ apiKey })
    const result = await generateText({
      model: google('gemini-3.5-flash'),
      prompt,
      maxOutputTokens: 300,
    })

    let facts: string[] = []
    try {
      const jsonMatch = result.text.match(/\[[\s\S]*\]/)
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0])
        if (Array.isArray(parsed)) facts = parsed.filter((x): x is string => typeof x === 'string')
      }
    } catch {
      console.error('[MemorySuggest] Failed to parse LLM response:', result.text)
    }

    // Dedup (case-insensitive) against memory + pending + dismissed, then clamp to the cap.
    const norm = (s: string) => s.trim().toLowerCase()
    const seen = new Set<string>()
    ;(ctx?.memory ? ctx.memory.split('\n') : []).forEach(l => seen.add(norm(l)))
    pending.forEach(p => seen.add(norm(p.text)))
    dismissed.forEach(t => seen.add(norm(t)))

    const fresh: string[] = []
    for (const f of facts) {
      const t = f.trim()
      if (!t || seen.has(norm(t))) continue
      seen.add(norm(t))
      fresh.push(t)
      if (pendingCount + fresh.length >= PENDING_CAP) break
    }

    if (fresh.length > 0) await createMemorySuggestions(projectId, chatId ?? null, fresh)
    return ok({ created: fresh.length })
  } catch (error) {
    return apiError(error, 'Memory suggestion failed', 200)
  }
}
