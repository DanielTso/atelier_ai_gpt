import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ai-sdk-ollama';
import { generateText } from 'ai';
import { getMessagesForSummarization, updateChatSummary, getChatWithSummary } from '@/app/actions';
import { getGeminiApiKey, getOllamaBaseUrl, getDashScopeApiKey } from '@/lib/settings';

const SUMMARIZATION_PROMPT = `You are a conversation summarizer. Your task is to create a concise summary of the conversation that preserves:
- Key topics discussed
- Important decisions made
- Relevant context and facts mentioned
- Any user preferences or requirements stated

Create a summary that would allow someone to continue the conversation naturally without losing important context.

Format: Write a brief paragraph (2-4 sentences) summarizing the key points. Be concise but comprehensive.`;

export async function POST(req: Request) {
  try {
    const { chatId, cutoffMessageId, model } = await req.json();

    if (!chatId || !cutoffMessageId) {
      return new Response(JSON.stringify({ error: 'Missing chatId or cutoffMessageId' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get chat to check for existing summary
    const chat = await getChatWithSummary(chatId);
    if (!chat) {
      return new Response(JSON.stringify({ error: 'Chat not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Get messages to summarize
    const messagesToSummarize = await getMessagesForSummarization(chatId, cutoffMessageId);

    if (messagesToSummarize.length === 0) {
      return new Response(JSON.stringify({ error: 'No messages to summarize' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // Format messages for summarization
    const conversationText = messagesToSummarize
      .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    // Include existing summary if present
    const existingSummaryContext = chat.summary
      ? `Previous conversation summary:\n${chat.summary}\n\nNew messages to incorporate:\n`
      : '';

    // Select model for summarization
    const modelName = model || 'gemini-3-flash-preview';
    const isGeminiModel = modelName.startsWith('gemini');
    const isQwenModel = modelName.startsWith('qwen');

    let selectedModel;
    if (isGeminiModel) {
      const apiKey = await getGeminiApiKey();
      if (!apiKey) {
        throw new Error("Google Gemini API Key is missing. Set it in Settings or .env.local.");
      }
      const google = createGoogleGenerativeAI({ apiKey });
      selectedModel = google(modelName);
    } else if (isQwenModel) {
      const apiKey = await getDashScopeApiKey();
      if (!apiKey) {
        throw new Error("DashScope API Key is missing. Set it in Settings or .env.local.");
      }
      const dashscope = createOpenAI({
        baseURL: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1',
        apiKey,
      });
      selectedModel = dashscope.chat(modelName);
    } else {
      const baseURL = await getOllamaBaseUrl();
      const ollama = createOllama({ baseURL });
      selectedModel = ollama(modelName);
    }

    // Generate summary
    const result = await generateText({
      model: selectedModel,
      messages: [
        { role: 'system', content: SUMMARIZATION_PROMPT },
        { role: 'user', content: `${existingSummaryContext}${conversationText}` }
      ],
    });

    const summary = result.text;

    // Update chat with new summary
    await updateChatSummary(chatId, summary, cutoffMessageId);

    return new Response(JSON.stringify({
      success: true,
      summary,
      summarizedMessageCount: messagesToSummarize.length,
      cutoffMessageId
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error("Summarization error:", error);
    const errorMessage = error instanceof Error ? error.message : "Summarization failed";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
