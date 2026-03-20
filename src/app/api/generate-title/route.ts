import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ai-sdk-ollama';
import { generateText } from 'ai';
import { getGeminiApiKey, getOllamaBaseUrl, getDashScopeApiKey } from '@/lib/settings';

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

    // Select model (same provider routing as /api/summarize)
    const modelName = model || 'gemini-3-flash-preview';
    const isGeminiModel = modelName.startsWith('gemini');
    const isQwenModel = modelName.startsWith('qwen');

    let selectedModel;
    if (isGeminiModel) {
      const apiKey = await getGeminiApiKey();
      if (!apiKey) {
        throw new Error('Google Gemini API Key is missing.');
      }
      const google = createGoogleGenerativeAI({ apiKey });
      selectedModel = google(modelName);
    } else if (isQwenModel) {
      const apiKey = await getDashScopeApiKey();
      if (!apiKey) {
        throw new Error('DashScope API Key is missing.');
      }
      const dashscope = createOpenAI({
        baseURL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
        apiKey,
      });
      selectedModel = dashscope.chat(modelName);
    } else {
      const baseURL = await getOllamaBaseUrl();
      const ollama = createOllama({ baseURL });
      selectedModel = ollama(modelName);
    }

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
    console.error('Title generation error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Title generation failed';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
