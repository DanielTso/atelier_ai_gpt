import { generateText } from 'ai';
import { createProvider } from '@/lib/providers';
import { apiError } from '@/lib/errors';
import { suggestFollowupsRequestSchema } from '@/lib/validation';

const FOLLOWUP_PROMPT =
  'Given the last exchange of a conversation, suggest 3 follow-ups the user might click next. ' +
  'Mix the depths: one question that digs deeper into the topic, one concrete action the assistant could do next (compare, analyze, draft a document or spreadsheet), and one creative or visual next step when it fits (an illustrated page, an image, a presentation). ' +
  'Each suggestion must be under 12 words, phrased as an imperative or a question, specific to THIS conversation. ' +
  'Return ONLY a JSON array of 3 strings — no prose, no markdown fences.';

// Best-effort housekeeping (like title/classify/memory-suggest): runs on the cheap
// internal Gemini model, and every failure degrades to { suggestions: [] } — the
// chips simply don't render. Never surfaces as a user-facing error.
export async function POST(req: Request) {
  try {
    const body = suggestFollowupsRequestSchema.safeParse(await req.json());
    if (!body.success) {
      return apiError(body.error, 'Invalid request body', 400);
    }

    const conversationText = body.data.messages
      .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    const { model } = await createProvider('gemini-3.5-flash');
    const result = await generateText({
      model,
      messages: [
        { role: 'system', content: FOLLOWUP_PROMPT },
        { role: 'user', content: conversationText },
      ],
      maxOutputTokens: 512,
    });

    let suggestions: string[] = [];
    const match = result.text.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const arr = JSON.parse(match[0]);
        if (Array.isArray(arr)) {
          suggestions = arr
            .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
            .map((s) => s.trim().slice(0, 100))
            .slice(0, 3);
        }
      } catch { /* malformed model output → no chips */ }
    }

    return Response.json({ suggestions });
  } catch {
    // No Gemini key / provider failure → silently no chips.
    return Response.json({ suggestions: [] });
  }
}
