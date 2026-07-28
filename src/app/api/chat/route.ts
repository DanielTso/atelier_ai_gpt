import { streamText, convertToModelMessages, stepCountIs, APICallError, type UIMessage } from 'ai';
import { getChatWithContext, getProjectContext, getProjectDocuments } from '@/app/actions';
import { buildProjectPreamble } from '@/lib/projectPreamble';
import { retrieveContext } from '@/lib/retrieval';
import { createProvider } from '@/lib/providers';
import { resolveRequestedModel } from '@/lib/models/registry';
import { apiError } from '@/lib/errors';
import { chatRequestSchema } from '@/lib/validation';
import { createGenerateArtifactTool } from '@/lib/artifacts/tool';
import { createGenerateImageTool } from '@/lib/image/tool';
import { createReadDocumentTool } from '@/lib/documents/tool';
import { isStorageConfigured } from '@/lib/storage';
import { formatPageList } from '@/lib/utils';
import { CITE_RE, LOOSE_CITE_RE } from '@/lib/citations';

// Experience-mode turns run long: web research + several image generations + an
// HTML artifact build in one streamed response. Make the time budget explicit.
export const maxDuration = 300;

// Configuration for hybrid context management
const RECENT_MESSAGES_LIMIT = 20; // Keep last N messages in full detail

// Reinforces chat-first behavior when the tools are available, so the model writes answers
// (emails, summaries, drafts) directly in the conversation and only reaches for a tool on an
// explicit file/image request.
const TOOL_GUIDANCE =
  'You are a helpful assistant in a chat conversation. Respond directly in chat using Markdown for almost everything the user asks. ' +
  'You also have two tools: generate_image creates an image shown INLINE in the conversation; generate_artifact creates a DOWNLOADABLE file (Word/Excel/PDF/PowerPoint) or an HTML page with a live preview. ' +
  'Use generate_image when the user asks to create/generate/draw/design/make an image, illustration, mockup, logo, icon, diagram, or picture. ' +
  'Use generate_artifact when the user asks for a downloadable/exported file ("make a spreadsheet", "export to Word", "create a PDF", "build a slide deck") OR for a web page, website, landing page, or HTML page/mockup ("build me a landing page", "make a website", "create an HTML page"). ' +
  'IMPORTANT: whenever your reply would otherwise be a COMPLETE HTML document or a full web page / landing page / site, you MUST call generate_artifact with format "html" instead of pasting that HTML as a code block in chat — the artifact gives the user a live preview, edit, and download. A short illustrative snippet may stay inline, but a whole page or file belongs in an artifact. ' +
  'If the user asks you to write, draft, or compose an email, message, summary, report, plan, list, or table to read in the conversation, write it directly in your reply — do NOT create a file. When in doubt for prose, answer in chat; for a full web page or file, use generate_artifact. ' +
  'Use generate_artifact with type "code" when the user asks for a runnable script or code FILE to keep/download (.py/.sh/.ts etc.) — short snippets and examples stay in chat as fenced code blocks. ' +
  'EXCEPTION — visual answers: when the user explicitly asks for a visual, illustrated, or image-rich response ("use images", "make it visual", "add pictures/diagrams/illustrations"), interleave your prose with generate_image calls: write a section, generate a fitting illustration, then continue writing. You can call tools multiple times in one reply — never promise a visual and stop without generating it. ' +
  'When the user asks for articles or videos, include inline Markdown links to real, relevant pages you found via web search (link the title text), not bare claims. ' +
  'RICH EXPERIENCES: when the user asks for a full multimedia presentation or experience (images AND articles AND videos together, "make it immersive/edgy/cinematic", "build me something"), go all in: (1) research facts and links with web search; (2) generate the key illustrations with generate_image; (3) build a designed, self-contained page with generate_artifact format "html" — bold editorial typography, sections, stat callouts — embedding your generated images via each result\'s embedUrl (NOT url — url expires), linking cited sources, and presenting videos as CLICK-OUT THUMBNAIL CARDS — <a href="https://www.youtube.com/watch?v=VIDEO_ID" target="_blank" rel="noopener"><img src="https://i.ytimg.com/vi/VIDEO_ID/hqdefault.jpg" alt="…"></a> styled as a card with a play badge and caption. NEVER use <iframe> YouTube embeds: the sandboxed preview sends no Referer, so embedded players always fail with a configuration error; (4) close with a short chat summary of what you built. Keep the page self-contained and lean (roughly under 40KB of HTML — designed, not exhaustive). The page opens in a live preview beside the chat.';

// Whole-document mode: retrieval chunks answer targeted questions; read_document
// exists for set-wide/exhaustive ones. Keep it chunks-first so ordinary questions
// stay fast and cheap.
const READ_DOCUMENT_GUIDANCE =
  'You can also read entire project documents with the read_document tool. Retrieved document chunks (above) answer most questions — prefer them. ' +
  'Call read_document ONLY when the question is set-wide or exhaustive ("list every…", "count all…", "summarize the whole document") or when the chunks clearly miss what the user asked about. ' +
  'Read additional windows (fromPage/offset) only while genuinely needed; stop as soon as you can answer.'

// Citation contract: included whenever document context is in play (retrieved
// chunks or the read_document tool), so document-sourced claims carry [cite:…]
// markers the client renders as chips.
const CITATION_GUIDANCE =
  'CITATIONS: when a claim comes from project documents, end that sentence with a citation marker copied from the [Source: …] header of the chunk you used: ' +
  '[cite:12 p34] for doc 12 page 34, [cite:12 p34-36] for a page range, [cite:12 c456] when the header shows §c456 and no pages, [cite:12] as a last resort. ' +
  'Example: "Retainage is 10% until substantial completion [cite:12 p4]." ' +
  'Never invent citations, never cite documents not shown to you, and never add markers to general-knowledge statements.'

// Grounded mode: additionally restricts answers to the project documents. Sent
// alone when scoping excluded every document — the model then answers
// "Not found in project documents" instead of falling back to general knowledge.
const GROUNDED_GUIDANCE =
  'GROUNDED MODE: answer EXCLUSIVELY from the provided project-document context and the read_document tool. ' +
  'If the documents do not contain the answer, reply "Not found in project documents" (optionally noting which document might cover it). ' +
  'Do not use general knowledge to fill gaps.';

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
    const { messages, model, chatId, effort, grounded, excludedDocumentIds } = body.data;
    // Registry-backed resolution: an unknown/stale/tampered id (e.g. a project's
    // default_model that no longer exists) falls back to the current default
    // instead of reaching a provider call that would throw — see registry.ts.
    const { modelId: modelName } = await resolveRequestedModel(model);

    // Create provider (routes by model-name prefix; returns the model, tools, and provider options)
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
      const [ctx, retrieved, projectDocs] = await Promise.all([
        chat?.projectId ? getProjectContext(chat.projectId) : Promise.resolve(null),
        retrieveContext(messages as unknown as UIMessage[], {
          chatId,
          projectId: chat?.projectId ?? null,
          excludeDocumentIds: excludedDocumentIds,
        }),
        chat?.projectId ? getProjectDocuments(chat.projectId).catch(() => []) : Promise.resolve([]),
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
        // When a summary exists, send only the recent tail in full. RECENT_MESSAGES_LIMIT
        // (20) is intentionally >= the count the summarizer leaves un-summarized (it keeps
        // the last ~10 in full, summarizing older ones up to summaryUpToMessageId), so the
        // tail always covers everything after the summary boundary — i.e. NO gap. Some
        // overlap (a message both summarized and re-sent) is accepted as the safe side of
        // the tradeoff: client-side messages carry UUID ids, not DB ids, so we can't slice
        // precisely by the cutoff here (see the recent-id dedup note in retrieval.ts).
        const recentMessages = chat?.summary
          ? contextMessages.slice(-RECENT_MESSAGES_LIMIT)
          : contextMessages;
        contextMessages = [...contextPrefix, ...recentMessages];
      }

      // 4. Merge Claude tools when Storage is configured. Prepend chat-first
      //    guidance so tools are reserved for explicit requests.
      if (modelName.startsWith('claude') && isStorageConfigured()) {
        const projectId = chat?.projectId ?? null;
        tools = {
          ...(providerTools ?? {}),
          generate_artifact: createGenerateArtifactTool({ chatId, projectId }),
          generate_image: createGenerateImageTool({ chatId, projectId }),
        };
        let guidance = TOOL_GUIDANCE;
        const excluded = new Set(excludedDocumentIds ?? []);
        const readableDocs = projectDocs.filter(d => d.status === 'ready' && d.storagePath && !excluded.has(d.id));
        if (projectId && readableDocs.length > 0) {
          tools.read_document = createReadDocumentTool({ projectId, excludeDocumentIds: excludedDocumentIds });
          const manifest = readableDocs
            .map(d => `- id=${d.id} "${d.filename}" — ${d.pageCount ?? '?'} pages, ${d.charCount.toLocaleString()} chars, ${d.extractionMethod ?? 'text'} extraction${d.extractionPartial ? ` (PARTIAL${d.failedPages?.length ? `; vision failed pages ${formatPageList(d.failedPages)}` : ''})` : ''}`)
            .join('\n');
          guidance += '\n\n' + READ_DOCUMENT_GUIDANCE + '\n[Project documents]\n' + manifest;
        }
        systemPrompt = systemPrompt ? `${guidance}\n\n${systemPrompt}` : guidance;
      }

      // 5. Citation contract + grounded mode. CITATION_GUIDANCE whenever document
      //    context is in play (retrieved chunks or read_document); GROUNDED_GUIDANCE
      //    additionally when grounded — and even without doc context, so excluding
      //    every source yields an explicit "Not found in project documents".
      if (documentContext || tools?.read_document) {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${CITATION_GUIDANCE}` : CITATION_GUIDANCE;
      }
      if (grounded === true) {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${GROUNDED_GUIDANCE}` : GROUNDED_GUIDANCE;
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
      // Multi-step tool loop: without this streamText stops after ONE step, so the
      // model could never continue writing after a generate_image/generate_artifact
      // call (it would tease a visual and die mid-reply). 12 steps allows an
      // image-heavy experience (each image is a step); server-side web_search
      // doesn't consume steps.
      stopWhen: stepCountIs(12),
      // A generate_artifact HTML page is written as tool-call INPUT tokens — the
      // provider default (~4k) truncates the call mid-JSON and the build silently
      // never executes (seen live: "Building document…" stuck forever). 32k covers
      // a large page + prose across every Claude model in the picker.
      maxOutputTokens: 32000,
      // Citation-compliance log (server-side; visible in Vercel logs). Plain
      // streamText onFinish — NOT the createUIMessageStream wrapper, which
      // masks route 500s (documented trap, see the 07-12 handoff).
      onFinish: ({ text }) => {
        // markers = parseable (canonical grammar); loose = cite-intended tokens
        // that fail the grammar (near-misses the renderer normalizes or strips).
        // Fresh regexes from .source — never match on the shared /g exports.
        const markers = (text.match(new RegExp(CITE_RE.source, 'g')) ?? []).length;
        const loose = (text.match(new RegExp(LOOSE_CITE_RE.source, 'g')) ?? []).length - markers;
        console.log('[cite-compliance]', JSON.stringify({ chatId, grounded, docCtx: !!documentContext, markers, loose }));
      },
    });

    return result.toUIMessageStreamResponse({
      sendSources: true,
      sendReasoning: true,
      // streamText() is synchronous — a provider error (e.g. Fable's 30-day
      // retention requirement, or a per-model thinking/effort combination the
      // registry doesn't model) is never thrown into the surrounding try/catch;
      // it's routed here instead. The default onError returns the generic
      // string below to avoid leaking server details, which is exactly what
      // masked these provider 400s before this fix. Only a genuine provider
      // API error with a 400 status gets its (truncated) message surfaced —
      // everything else stays generic. This is a residual gap, accepted by
      // design: capability derivation (C4) can't cover every org-level rule.
      onError: (error) => {
        if (APICallError.isInstance(error) && error.statusCode === 400) {
          return String(error.message).slice(0, 300);
        }
        return 'An error occurred.';
      },
    });

  } catch (error) {
    // Preserve specific API-key / provider errors for user feedback. These are
    // synchronous throws from createProvider() (missing key, unknown model),
    // raised before streamText() is ever called — still reachable.
    if (error instanceof Error && (error.message.includes('API Key') || error.message.includes('Unknown model provider'))) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return apiError(error, 'An error occurred during text generation.');
  }
}
