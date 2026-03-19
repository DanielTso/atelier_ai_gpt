import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenAI } from '@ai-sdk/openai';
import { createOllama } from 'ai-sdk-ollama';
import { streamText, convertToModelMessages, type UIMessage } from 'ai';
import { getChatWithContext } from '@/app/actions';
import { getGeminiApiKey, getOllamaBaseUrl, getDashScopeApiKey } from '@/lib/settings';
import { generateEmbedding, findSimilarMessages, findSimilarDocumentChunks } from '@/lib/embeddings';

// Configuration for hybrid context management
const RECENT_MESSAGES_LIMIT = 20; // Keep last N messages in full detail

export async function POST(req: Request) {
  try {
    const { messages, model, chatId } = await req.json();
    const modelName = model || 'gemini-3-flash-preview';

    // Determine which provider to use based on model name
    const isGeminiModel = modelName.startsWith('gemini');
    const isQwenModel = modelName.startsWith('qwen');
    const isImageModel = modelName.includes('image');
    const isDeepThink = modelName.includes('deep-think');

    // Deep Think uses gemini-3.1-pro-preview with high thinking level
    const actualModelName = isDeepThink ? 'gemini-3.1-pro-preview' : modelName;

    let selectedModel;
    let googleTools: Record<string, ReturnType<ReturnType<typeof createGoogleGenerativeAI>['tools']['googleSearch']>> | undefined;
    let providerOptions: Record<string, Record<string, string | string[] | Record<string, string>>> | undefined;
    if (isGeminiModel) {
      const apiKey = await getGeminiApiKey();
      if (!apiKey) {
        throw new Error("Google Gemini API Key is missing. Set it in Settings or .env.local.");
      }
      const google = createGoogleGenerativeAI({ apiKey });
      selectedModel = google(actualModelName);
      if (isImageModel) {
        // Image models need TEXT+IMAGE response modalities, no search grounding
        providerOptions = { google: { responseModalities: ['TEXT', 'IMAGE'] } };
      } else if (isDeepThink) {
        // Deep Think uses high thinking level for extended reasoning
        providerOptions = { google: { thinkingConfig: { thinkingLevel: 'high' } } };
        googleTools = {
          google_search: google.tools.googleSearch({}),
        };
      } else {
        // Enable Google Search grounding for non-image Gemini models
        googleTools = {
          google_search: google.tools.googleSearch({}),
        };
      }
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

      // 3. Summary context (existing behavior)
      if (chat?.summary) {
        // Apply sliding window to recent messages
        const recentMessages = contextMessages.slice(-RECENT_MESSAGES_LIMIT);

        // Build context messages array
        const contextPrefix: UIMessage[] = [];

        // Add document context first (highest priority supplemental context)
        if (documentContext) {
          contextPrefix.push(
            {
              id: 'document-context',
              role: 'user',
              parts: [{
                type: 'text',
                text: `[Relevant information from project documents]:\n${documentContext}`
              }]
            },
            {
              id: 'document-ack',
              role: 'assistant',
              parts: [{
                type: 'text',
                text: "I'll use this document context to inform my response."
              }]
            }
          );
        }

        // Add semantic context if available
        if (semanticContext) {
          contextPrefix.push(
            {
              id: 'semantic-context',
              role: 'user',
              parts: [{
                type: 'text',
                text: `[Relevant context from previous conversations]:\n${semanticContext}`
              }]
            },
            {
              id: 'semantic-ack',
              role: 'assistant',
              parts: [{
                type: 'text',
                text: "I understand, I'll use this context to inform my response."
              }]
            }
          );
        }

        // Add summary context
        contextPrefix.push(
          {
            id: 'summary-context',
            role: 'user',
            parts: [{
              type: 'text',
              text: `[Previous conversation context: ${chat.summary}]`
            }]
          },
          {
            id: 'summary-ack',
            role: 'assistant',
            parts: [{
              type: 'text',
              text: 'I understand the previous context. How can I continue helping you?'
            }]
          }
        );

        contextMessages = [...contextPrefix, ...recentMessages];
      } else if (documentContext || semanticContext) {
        // No summary but document/semantic context available
        const contextPrefix: UIMessage[] = [];

        if (documentContext) {
          contextPrefix.push(
            {
              id: 'document-context',
              role: 'user',
              parts: [{
                type: 'text',
                text: `[Relevant information from project documents]:\n${documentContext}`
              }]
            },
            {
              id: 'document-ack',
              role: 'assistant',
              parts: [{
                type: 'text',
                text: "I'll use this document context to inform my response."
              }]
            }
          );
        }

        if (semanticContext) {
          contextPrefix.push(
            {
              id: 'semantic-context',
              role: 'user',
              parts: [{
                type: 'text',
                text: `[Relevant context from previous conversations]:\n${semanticContext}`
              }]
            },
            {
              id: 'semantic-ack',
              role: 'assistant',
              parts: [{
                type: 'text',
                text: "I understand, I'll use this context to inform my response."
              }]
            }
          );
        }

        contextMessages = [...contextPrefix, ...contextMessages];
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
    console.error("❌ [API Error]:", error);
    const errorMessage = error instanceof Error ? error.message : "An error occurred during text generation.";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
