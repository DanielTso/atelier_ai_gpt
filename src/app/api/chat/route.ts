import { streamText, convertToModelMessages, type UIMessage } from 'ai';
import { getChatWithContext } from '@/app/actions';
import { generateEmbedding, findSimilarMessages, findSimilarDocumentChunks } from '@/lib/embeddings';
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
    const modelName = model || 'gemini-3.5-flash';

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

      // 2. Semantic retrieval — find relevant past messages + document chunks
      try {
        const userMessages = (messages as UIMessage[]).filter(m => m.role === 'user');
        const lastUserMessage = userMessages[userMessages.length - 1];
        if (lastUserMessage) {
          const queryText = lastUserMessage.parts
            ?.filter((part: { type: string }): part is { type: 'text'; text: string } => part.type === 'text')
            .map((part: { text: string }) => part.text)
            .join('') || '';

          if (queryText) {
            const queryEmbedding = await generateEmbedding(queryText, 'query');

            // Message semantic retrieval
            const similar = await findSimilarMessages(queryEmbedding, {
              projectId: chat?.projectId ?? undefined,
              chatId: !chat?.projectId ? chatId : undefined,
            }, 5, 0.7);

            const recentIds = new Set((messages as UIMessage[]).map((m: UIMessage) => m.id));
            const relevantPast = similar.filter(s => !recentIds.has(String(s.messageId)));

            if (relevantPast.length > 0) {
              semanticContext = relevantPast.map(s => s.content).join('\n---\n');
            }

            // Document chunk retrieval (project-scoped)
            if (chat?.projectId) {
              try {
                const relevantChunks = await findSimilarDocumentChunks(
                  queryEmbedding, chat.projectId, 3, 0.5
                );
                if (relevantChunks.length > 0) {
                  documentContext = relevantChunks
                    .map(c => `[From: ${c.filename}]\n${c.content}`)
                    .join('\n---\n');
                }
              } catch {
                // Document retrieval is best-effort
              }
            }
          }
        }
      } catch {
        // Embedding unavailable — silently skip
      }

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
