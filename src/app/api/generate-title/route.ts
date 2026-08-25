import { generateText } from 'ai';
import { createProvider } from '@/lib/providers';
import { apiError } from '@/lib/errors';
import { generateTitleRequestSchema } from '@/lib/validation';
import { recordUsage } from '@/lib/usage';

const TITLE_PROMPT = `Generate a concise title (3-6 words) for this conversation. Return only the title, no quotes or punctuation.`;

export async function POST(req: Request) {
  try {
    const body = generateTitleRequestSchema.safeParse(await req.json());
    if (!body.success) {
      return apiError(body.error, 'Invalid request body', 400);
    }
    const { chatId, messages } = body.data;

    // Format conversation for title generation
    const conversationText = messages
      .map((m) =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content ?? ''}`
      )
      .join('\n\n');

    // Housekeeping runs on a cheap internal Gemini model, never the chat model.
    const modelName = 'gemini-3.5-flash';
    const { model: selectedModel } = await createProvider(modelName);

    const result = await generateText({
      model: selectedModel,
      messages: [
        { role: 'system', content: TITLE_PROMPT },
        { role: 'user', content: conversationText },
      ],
      // Generous budget: the Gemini flash housekeeping model spends output tokens on
      // internal thinking, so a tight cap (e.g. 50) can leave the visible title empty.
      maxOutputTokens: 512,
    });

    // Usage capture (spec C6) — best-effort. projectId is not loaded by this
    // route (the chat row is never read here); null rather than an extra query.
    void recordUsage({ chatId, projectId: null, purpose: 'generate-title', model: modelName, usage: result.totalUsage }).catch(() => {});

    // Clean the title: trim, strip surrounding quotes, truncate
    let title = result.text.trim();
    title = title.replace(/^["']+|["']+$/g, '');
    title = title.trim();
    if (title.length > 50) {
      title = title.substring(0, 50).trim();
    }

    return new Response(JSON.stringify({ title }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (error instanceof Error && (error.message.includes('API Key') || error.message.includes('Unknown model provider'))) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return apiError(error, 'Title generation failed');
  }
}
