import { streamText, convertToModelMessages, type UIMessage } from 'ai';
import { getChatWithContext, getProjectContext } from '@/app/actions';
import { buildProjectPreamble } from '@/lib/projectPreamble';
import { retrieveContext } from '@/lib/retrieval';
import { createProvider } from '@/lib/providers';
import { apiError } from '@/lib/errors';
import { chatRequestSchema } from '@/lib/validation';
import { createGenerateArtifactTool } from '@/lib/artifacts/tool';
import { isStorageConfigured } from '@/lib/storage';

// Configuration for hybrid context management
const RECENT_MESSAGES_LIMIT = 20; // Keep last N messages in full detail

// Reinforces chat-first behavior when the generate_artifact tool is available, so the
// model writes answers (emails, summaries, drafts) directly in the conversation and only
// produces a downloadable file when the user explicitly asks for one.
const ARTIFACT_GUIDANCE =
  'You are a helpful assistant in a chat conversation. Respond directly in chat using Markdown for almost everything the user asks. ' +
  'You also have a generate_artifact tool that creates a downloadable file (Word/Excel/PDF/PowerPoint). ' +
  'Only use generate_artifact when the user EXPLICITLY asks for a downloadable or exported file (e.g. "make a spreadsheet", "export to Word", "create a PDF", "build a slide deck"). ' +
  'If the user asks you to write, draft, or compose an email, message, summary, report, plan, list, or table to read in the conversation, write it directly in your reply — do NOT create a file. When in doubt, answer in chat.';

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
    const { messages, model, chatId, effort } = body.data;
    const modelName = model || 'claude-opus-4-8';

    // Create provider (handles virtual model resolution, tools, and options)
    const { model: selectedModel, tools: providerTools, providerOptions } = await createProvider(modelName, effort);

    // Build context with hybrid approach: system prompt + semantic context + summary + recent messages
    let contextMessages = messages as unknown as UIMessage[];
    let systemPrompt: string | undefined;
    let semanticContext: string | null = null;
    let documentContext: string | null = null;
    // Start with provider tools (web_search for Claude, google_search for Gemini, undefined for image)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tools: Record<string, any> | undefined = providerTools;

    if (chatId) {
      const chat = await getChatWithContext(chatId);

      // The project-context read and the retrieval pipeline are independent once we
      // have the chat — run them concurrently to shave a round-trip off time-to-
      // first-token. Retrieval is best-effort (nulls if providers unavailable).
      const [ctx, retrieved] = await Promise.all([
        chat?.projectId ? getProjectContext(chat.projectId) : Promise.resolve(null),
        retrieveContext(messages as unknown as UIMessage[], {
          chatId,
          projectId: chat?.projectId ?? null,
        }),
      ]);

      // 1. System prompt (always included, never trimmed). Project Memory +
      //    Instructions are prepended so they steer every chat in the project.
      const preamble = ctx ? buildProjectPreamble(ctx.memory, ctx.instructions) : '';
      const base = chat?.systemPrompt ?? '';
      const combined = [preamble, base].filter(s => s.trim().length > 0).join('\n\n');
      systemPrompt = combined.length > 0 ? combined : undefined;

      // 2. Retrieval results.
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

      // 4. Merge generate_artifact tool for Claude when Storage is configured.
      //    Prepend chat-first guidance so the tool is reserved for explicit file requests.
      if (modelName.startsWith('claude') && isStorageConfigured()) {
        const projectId = chat?.projectId ?? null;
        tools = { ...(providerTools ?? {}), generate_artifact: createGenerateArtifactTool({ chatId, projectId }) };
        systemPrompt = systemPrompt ? `${ARTIFACT_GUIDANCE}\n\n${systemPrompt}` : ARTIFACT_GUIDANCE;
      }
    }

    // Convert UIMessage to ModelMessage format for streamText
    const modelMessages = await convertToModelMessages(contextMessages);

    const result = streamText({
      model: selectedModel,
      system: systemPrompt, // System instruction is always first, never trimmed
      messages: modelMessages,
      ...(tools && { tools }),
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
