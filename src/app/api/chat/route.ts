import { streamText, convertToModelMessages, type UIMessage } from 'ai';
import { getChatWithContext } from '@/app/actions';
import { retrieveContext } from '@/lib/retrieval';
import { createProvider } from '@/lib/providers';
import { apiError } from '@/lib/errors';
import { chatRequestSchema } from '@/lib/validation';

// Configuration for hybrid context management
const RECENT_MESSAGES_LIMIT = 20; // Keep last N messages in full detail

function buildContextPrefix(
  documentContext: string | null,
  semanticContext: string | null,
  summary: string | null
): UIMessage[] {
  const prefix: UIMessage[] = [];
  if (documentContext) {
    prefix.push(
      { id: 'document-context', role: 'user', parts: [{ type: 'text', text: `[Relevant information from project documents]:\n${documentContext}` }] },
      { id: 'document-ack', role: 'assistant', parts: [{ type: 'text', text: "I'll use this document context to inform my response." }] }
    );
  }
  if (semanticContext) {
    prefix.push(
      { id: 'semantic-context', role: 'user', parts: [{ type: 'text', text: `[Relevant context from previous conversations]:\n${semanticContext}` }] },
      { id: 'semantic-ack', role: 'assistant', parts: [{ type: 'text', text: "I understand, I'll use this context to inform my response." }] }
    );
  }
  if (summary) {
    prefix.push(
      { id: 'summary-context', role: 'user', parts: [{ type: 'text', text: `[Previous conversation context: ${summary}]` }] },
      { id: 'summary-ack', role: 'assistant', parts: [{ type: 'text', text: 'I understand the previous context. How can I continue helping you?' }] }
    );
  }
  return prefix;
}

export async function POST(req: Request) {
  try {
    const body = chatRequestSchema.safeParse(await req.json());
    if (!body.success) {
      return apiError(body.error, 'Invalid request body', 400);
    }
    const { messages, model, chatId } = body.data;
    const modelName = model || 'claude-opus-4-8';

    // Create provider (handles virtual model resolution, tools, and options)
    const { model: selectedModel, tools: googleTools, providerOptions } = await createProvider(modelName);

    // Build context with hybrid approach: system prompt + semantic context + summary + recent messages
    let contextMessages = messages as UIMessage[];
    let systemPrompt: string | undefined;
    let semanticContext: string | null = null;
    let documentContext: string | null = null;

    if (chatId) {
      const chat = await getChatWithContext(chatId);

      // 1. System prompt (always included, never trimmed)
      if (chat?.systemPrompt) {
        systemPrompt = chat.systemPrompt;
      }

      // 2. Retrieval pipeline (rewrite -> vector top-N -> MMR -> rerank -> top-k).
      // Best-effort: returns nulls if embeddings/providers are unavailable.
      const retrieved = await retrieveContext(messages as UIMessage[], {
        chatId,
        projectId: chat?.projectId ?? null,
      });
      semanticContext = retrieved.semanticContext;
      documentContext = retrieved.documentContext;

      // 3. Build context prefix (document chunks + semantic context + summary)
      const contextPrefix = buildContextPrefix(documentContext, semanticContext, chat?.summary ?? null);
      if (contextPrefix.length > 0) {
        const recentMessages = chat?.summary
          ? contextMessages.slice(-RECENT_MESSAGES_LIMIT)
          : contextMessages;
        contextMessages = [...contextPrefix, ...recentMessages];
      }
    }

    // Convert UIMessage to ModelMessage format for streamText
    const modelMessages = await convertToModelMessages(contextMessages);

    const result = streamText({
      model: selectedModel,
      system: systemPrompt, // System instruction is always first, never trimmed
      messages: modelMessages,
      ...(googleTools && { tools: googleTools }),
      ...(providerOptions && { providerOptions }),
    });

    return result.toUIMessageStreamResponse({ sendSources: true });

  } catch (error) {
    // Preserve specific API-key / provider errors for user feedback
    if (error instanceof Error && (error.message.includes('API Key') || error.message.includes('Unknown model provider'))) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return apiError(error, 'An error occurred during text generation.');
  }
}
