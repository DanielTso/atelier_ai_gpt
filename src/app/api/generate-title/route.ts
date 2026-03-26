import { generateText } from 'ai';
import { createProvider } from '@/lib/providers';
import { apiError } from '@/lib/errors';

const TITLE_PROMPT = `Generate a concise title (3-6 words) for this conversation. Return only the title, no quotes or punctuation.`;

export async function POST(req: Request) {
  try {
    const { chatId, messages, model } = await req.json();

    if (!chatId || !messages || !Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: 'Missing chatId or messages' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Format conversation for title generation
    const conversationText = messages
      .map((m: { role: string; content: string }) =>
        `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`
      )
      .join('\n\n');

    // Select model
    const modelName = model || 'gemini-3-flash-preview';
    const { model: selectedModel } = await createProvider(modelName);

    const result = await generateText({
      model: selectedModel,
      messages: [
        { role: 'system', content: TITLE_PROMPT },
        { role: 'user', content: conversationText },
      ],
      maxOutputTokens: 50,
    });

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
