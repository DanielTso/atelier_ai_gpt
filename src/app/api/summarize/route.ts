import { generateText } from 'ai';
import { getMessagesForSummarization, updateChatSummary, getChatWithContext } from '@/app/actions';
import { createProvider } from '@/lib/providers';
import { apiError } from '@/lib/errors';
import { summarizeRequestSchema } from '@/lib/validation';

const SUMMARIZATION_PROMPT = `You are a conversation summarizer. Your task is to create a concise summary of the conversation that preserves:
- Key topics discussed
- Important decisions made
- Relevant context and facts mentioned
- Any user preferences or requirements stated

Create a summary that would allow someone to continue the conversation naturally without losing important context.

Format: Write a brief paragraph (2-4 sentences) summarizing the key points. Be concise but comprehensive.`;

export async function POST(req: Request) {
  try {
    const body = summarizeRequestSchema.safeParse(await req.json());
    if (!body.success) {
      return apiError(body.error, 'Invalid request body', 400);
    }
    const { chatId, cutoffMessageId } = body.data;

    // Get chat to check for existing summary
    const chat = await getChatWithContext(chatId);
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

    // Housekeeping runs on a cheap internal Gemini model, never the chat model.
    const modelName = 'gemini-3.5-flash';
    const { model: selectedModel } = await createProvider(modelName);

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
    if (error instanceof Error && (error.message.includes('API Key') || error.message.includes('Unknown model provider'))) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return apiError(error, 'Summarization failed');
  }
}
