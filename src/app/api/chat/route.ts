import { streamText, convertToModelMessages, stepCountIs, APICallError, type UIMessage, type LanguageModelUsage } from 'ai';
import { getChatWithContext, getProjectContext, getProjectDocuments, getRegenerateTarget, saveMessage } from '@/app/actions';
import { replaceAssistantReply, updateAssistantReplyContent } from '@/lib/chatTurnDb';
import { buildProjectPreamble } from '@/lib/projectPreamble';
import { retrieveContext } from '@/lib/retrieval';
import { createProvider } from '@/lib/providers';
import { resolveRequestedModel } from '@/lib/models/registry';
import { apiError } from '@/lib/errors';
import { chatRequestSchema } from '@/lib/validation';
import { createGenerateArtifactTool } from '@/lib/artifacts/tool';
import { ARTIFACT_MAX_OUTPUT_TOKENS } from '@/lib/artifacts/limits';
import { createGenerateImageTool } from '@/lib/image/tool';
import { createReadDocumentTool } from '@/lib/documents/tool';
import { isStorageConfigured } from '@/lib/storage';
import { formatPageList } from '@/lib/utils';
import { promptSafeLabel } from '@/lib/promptSafe';
import { CITE_RE, LOOSE_CITE_RE } from '@/lib/citations';
import { after } from 'next/server';
import { recordUsage, sumUsage } from '@/lib/usage';
import { createAssistantTurnRecorder, isDbMessageId, type TurnMetadata } from '@/lib/chatTurn';
import { messageText } from '@/lib/messageParts';
import { recentTail, sentMessageDbIds, stubOldToolOutputs } from '@/lib/contextBudget';

// Experience-mode turns run long: web research + several image generations + an
// HTML artifact build in one streamed response. Make the time budget explicit.
export const maxDuration = 300;

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

// What the client is told when a provider call fails mid-stream. Each failure
// class gets a fixed message the user can act on; the provider's own text is
// logged server-side (Vercel logs) and never sent, since it can echo request
// details. Anything that is not a provider API error stays generic.
const PROVIDER_ERROR_MESSAGES = {
  auth: 'The AI provider rejected the API key. Check it in Settings → API Keys.',
  rateLimit: 'The AI provider rate limit was reached. Wait a moment and try again, or check your plan and credits.',
  credits: 'The AI provider account is out of credits. Add credits in the provider console, then try again.',
  contextTooLarge: 'This conversation is too large for the model to read in one request. Start a new chat, or remove large attachments, and try again.',
  retention: 'This model requires 30-day data retention to be enabled for your Anthropic organization. Pick another model or change the retention setting.',
  invalid: 'The AI provider rejected this request. Try again, or pick another model.',
  overloaded: 'The AI provider is overloaded or unavailable right now. Try again in a moment.',
} as const;
const GENERIC_ERROR_MESSAGE = 'An error occurred.';

function providerErrorMessage(error: unknown): string {
  // After maxRetries on a 429/529 the SDK throws a RetryError that wraps the
  // last provider error (duck-typed: the class is not needed for the check).
  const lastError = error && typeof error === 'object' && 'lastError' in error
    ? (error as { lastError: unknown }).lastError
    : undefined;
  const apiErr = APICallError.isInstance(error) ? error : APICallError.isInstance(lastError) ? lastError : null;
  if (!apiErr || typeof apiErr.statusCode !== 'number') return GENERIC_ERROR_MESSAGE;

  const status = apiErr.statusCode;
  const raw = String(apiErr.message ?? '');
  console.error('[chat] provider error', status, raw.slice(0, 500));

  if (status === 401 || status === 403) return PROVIDER_ERROR_MESSAGES.auth;
  if (status === 429) return PROVIDER_ERROR_MESSAGES.rateLimit;
  if (status === 413) return PROVIDER_ERROR_MESSAGES.contextTooLarge;
  if (status === 400) {
    if (/prompt is too long|too many tokens|context (window|length)|maximum context/i.test(raw)) return PROVIDER_ERROR_MESSAGES.contextTooLarge;
    if (/credit balance/i.test(raw)) return PROVIDER_ERROR_MESSAGES.credits;
    if (/retention/i.test(raw)) return PROVIDER_ERROR_MESSAGES.retention;
    return PROVIDER_ERROR_MESSAGES.invalid;
  }
  if (status === 529 || status >= 500) return PROVIDER_ERROR_MESSAGES.overloaded;
  return GENERIC_ERROR_MESSAGE;
}

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
    const { messages, model, chatId, effort, grounded, excludedDocumentIds, trigger, regenerate, replaceMessageDbId } = body.data;

    // This route persists the turn to the request's chat (below), so the chat is
    // validated first: an unknown id is a 404 with nothing written, not a
    // foreign-key failure halfway through a stream.
    const chat = chatId ? await getChatWithContext(chatId) : undefined;
    if (chatId && !chat) {
      return apiError(new Error(`chat ${chatId} does not exist`), 'Chat not found', 404);
    }

    const lastMessage = messages[messages.length - 1];

    // Regenerate (audit D2): answer the chat's last user message again, replacing
    // the reply it already has. The client has dropped that reply from its store
    // and posts the transcript ending at the user message, plus the replaced row's
    // id. The user message is already saved, so nothing is inserted for it (even
    // when it carries a client id — it was sent this session) and its row is
    // reported as the turn's `userMessageDbId`. Nothing is deleted up front: the
    // turn recorder writes the new reply over the old row (replaceAssistantReply)
    // at its first write — once the reply has savable content — so a regenerate
    // that fails or is stopped before its first token leaves the old reply
    // exactly as it was.
    const isRegenerate = regenerate === true || trigger === 'regenerate-message' || replaceMessageDbId != null;
    let regenerateUserRowId: number | null = null;
    if (isRegenerate) {
      if (!chat || replaceMessageDbId == null || lastMessage.role !== 'user') {
        return apiError(new Error('regenerate needs a chat, replaceMessageDbId and a trailing user message'), 'Invalid regenerate request', 400);
      }
      regenerateUserRowId = await getRegenerateTarget(chat.id, replaceMessageDbId);
      const postedRowId = isDbMessageId(lastMessage.id) ? Number(lastMessage.id) : null;
      if (regenerateUserRowId == null || (postedRowId != null && postedRowId !== regenerateUserRowId)) {
        return apiError(new Error(`message ${replaceMessageDbId} cannot be regenerated in chat ${chat.id}`), 'This reply can no longer be regenerated', 409);
      }
    }

    // Turn persistence, user half (audit U1/F1/F3). The user's message is saved
    // HERE, to the request's chat, before any model work — so it is durable no
    // matter what the client does next, and its row id can ride on the stream's
    // first chunk. Only the newest message is ever inserted, and only when it is
    // not already a DB row: after a reload the client's history carries
    // stringified `messages.id`s, and re-saving those was the F3 duplicate. A
    // regenerate inserts nothing (see above).
    const saveUserTurn = async (): Promise<number | null> => {
      if (isRegenerate) return regenerateUserRowId;
      if (!chat || lastMessage.role !== 'user' || isDbMessageId(lastMessage.id)) return null;
      const [row] = await saveMessage(chat.id, 'user', messageText(lastMessage));
      return row?.id ?? null;
    };

    // Registry-backed resolution: an unknown/stale/tampered id (e.g. a project's
    // default_model that no longer exists) falls back to the current default
    // instead of reaching a provider call that would throw — see registry.ts.
    // Then create the provider (routes by model-name prefix; returns the model,
    // tools, and provider options).
    const resolveProvider = async () => {
      const { modelId } = await resolveRequestedModel(model);
      return { modelName: modelId, ...(await createProvider(modelId, effort)) };
    };

    // Concurrent: the insert must not add a round-trip to time-to-first-token. A
    // provider failure (missing key) still leaves the user's message saved, as it
    // always was; a failed insert fails the request rather than answering a
    // message that was never stored.
    const [userMessageDbId, { modelName, model: selectedModel, tools: providerTools, providerOptions }] =
      await Promise.all([saveUserTurn(), resolveProvider()]);

    // Build context with hybrid approach: system prompt + semantic context + summary + recent messages.
    //
    // Recent messages (layer 5), bounded before anything else is added. The client
    // posts its whole live store, so: keep every message newer than the summary
    // boundary (at least 20, at most 60 — a failed fold can no longer open a gap
    // between the summary and the tail, audit B4), and stub the `read_document`
    // windows of all but the last assistant turn so they are not re-billed on every
    // later turn (audit B3). See src/lib/contextBudget.ts.
    const summaryBoundary = chat?.summary ? chat.summaryUpToMessageId ?? null : null;
    const sentTail = recentTail(messages as unknown as UIMessage[], summaryBoundary);
    let contextMessages = stubOldToolOutputs(sentTail);
    let systemPrompt: string | undefined;
    let semanticContext: string | null = null;
    let documentContext: string | null = null;
    // Hoisted for usage capture in onFinish (spec C6) — set once the chat's
    // project is known below.
    let projectId: number | null = null;
    // Start with provider tools (web_search for Claude, undefined for Gemini)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let tools: Record<string, any> | undefined = providerTools;

    if (chatId && chat) {
      projectId = chat.projectId ?? null;

      // The project-context read and the retrieval pipeline are independent once we
      // have the chat — run them concurrently to shave a round-trip off time-to-
      // first-token. Retrieval is best-effort (nulls if providers unavailable).
      const [ctx, retrieved, projectDocs] = await Promise.all([
        chat?.projectId ? getProjectContext(chat.projectId) : Promise.resolve(null),
        retrieveContext(messages as unknown as UIMessage[], {
          chatId,
          projectId: chat?.projectId ?? null,
          excludeDocumentIds: excludedDocumentIds,
          // Semantic retrieval leaves out what the model already sees (audit B9):
          // the whole chat when nothing was trimmed, otherwise exactly the sent
          // rows, so messages trimmed off the front stay retrievable. Known edges:
          // excludeChatId assumes the client's store holds the whole chat, which
          // is false if its list load failed or another tab added rows (those rows
          // are then excluded though not sent); see sentMessageDbIds for the
          // stopped-reply edge of the id path.
          ...(sentTail.length === messages.length
            ? { excludeChatId: chatId }
            // A regenerate also leaves out the reply being replaced: its old
            // text is still embedded until the new reply is written over it.
            : { excludeMessageIds: [...sentMessageDbIds(sentTail, userMessageDbId), ...(isRegenerate && replaceMessageDbId != null ? [replaceMessageDbId] : [])] }),
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
        contextMessages = [...contextPrefix, ...contextMessages];
      }

      // 4. Merge Claude tools when Storage is configured. Prepend chat-first
      //    guidance so tools are reserved for explicit requests.
      if (modelName.startsWith('claude') && isStorageConfigured()) {
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
          // Filenames are untrusted (a web page's H1 becomes one) — sanitize before
          // interpolating so a name cannot close the quote or forge prompt structure.
          const manifest = readableDocs
            .map(d => `- id=${d.id} "${promptSafeLabel(d.filename)}" — ${d.pageCount ?? '?'} pages, ${d.charCount.toLocaleString()} chars, ${d.extractionMethod ?? 'text'} extraction${d.extractionPartial ? ` (PARTIAL${d.failedPages?.length ? `; vision failed pages ${formatPageList(d.failedPages)}` : ''})` : ''}`)
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

    // Convert UIMessage to ModelMessage format for streamText. A tool call that
    // never got its result (Stop or a dropped connection mid-tool) is dropped:
    // without this the SDK throws MissingToolResultsError before the provider is
    // called, and every later send in the session fails until a reload (audit B1).
    const modelMessages = await convertToModelMessages(contextMessages, { ignoreIncompleteToolCalls: true });

    // Usage capture (spec C6). Best-effort: a usage-write failure must never
    // fail the chat turn. `after()` keeps the Vercel function alive until the
    // insert lands instead of racing the freeze; outside a request scope (unit
    // tests, other runtimes) it throws, so fall back to fire-and-forget.
    //
    // EXACTLY ONE row per turn, enforced here rather than assumed. Verified
    // against the installed ai@6.0.230: aborting AFTER at least one completed
    // step fires onAbort({ steps }) and THEN closes the stream, and the
    // recording transform's `flush` — the only caller of onFinish — has no
    // abort guard once a step was recorded, so onFinish ALSO runs, handing over
    // a null usage object (every field undefined). Without this first-wins flag
    // that second call would write an all-zero cost_estimated:false row, which
    // reads as a genuinely free generation. onAbort fires first and carries the
    // real summed tokens, so first-wins keeps the truthful row.
    //
    // This is the CALLBACK form of after(): it runs once the response has closed,
    // which is fine for a ledger row nothing on the wire depends on. The assistant
    // message below needs the opposite — see the turn recorder.
    let usageRecorded = false;
    const persistUsage = (usage: LanguageModelUsage | undefined) => {
      // No usage at all (an abort during the very first step: steps === [] so
      // sumUsage returns undefined) means the tokens are UNKNOWN, not zero. The
      // ledger must never carry a $0 row for spend it cannot account for — skip
      // instead, leaving no row rather than a misleading "free" one.
      if (usage === undefined) return;
      if (usageRecorded) return;
      usageRecorded = true;
      const write = () => recordUsage({ chatId: chatId ?? null, projectId, purpose: 'chat', model: modelName, usage }).catch(() => {});
      try {
        after(write);
      } catch {
        void write();
      }
    };

    // Turn persistence, assistant half (audit U1/F1). The reply is saved by the
    // server, to the request's chat, as exactly one row — whatever the client is
    // doing by then (another chat, another view, a closed tab). The row is first
    // written as soon as the reply has savable content and checkpointed while it
    // streams (audit R2: a function killed mid-stream keeps the text up to its
    // last checkpoint); its final text lands at the stream's `finish`, or at its
    // `abort` with the text streamed so far. The recorder is a stream transform
    // rather than onFinish/onAbort code so that the row id exists before the
    // `finish` chunk is sent; see createAssistantTurnRecorder for the SDK details.
    // No chat (a chat-less request) → nothing to persist.
    // A regenerate writes over the reply it replaces (same row id), and only once
    // savable content exists, so a regenerate that saves nothing keeps the old reply.
    const recorder = chat
      ? createAssistantTurnRecorder({
          save: async (text) => {
            if (isRegenerate && replaceMessageDbId != null) {
              return replaceAssistantReply(chat.id, replaceMessageDbId, text);
            }
            const [row] = await saveMessage(chat.id, 'assistant', text);
            return row?.id ?? null;
          },
          update: (id, text, previous) => updateAssistantReplyContent(chat.id, id, text, previous),
        })
      : null;
    // `projectId` here is the chat ROW's project — the client never supplies it.
    const turnMetadata = (): TurnMetadata | undefined =>
      chat && recorder
        ? { chatId: chat.id, projectId, userMessageDbId, assistantMessageDbId: recorder.assistantMessageDbId() }
        : undefined;

    const result = streamText({
      model: selectedModel,
      system: systemPrompt, // System instruction is always first, never trimmed
      messages: modelMessages,
      ...(tools && { tools }),
      ...(providerOptions && { providerOptions }),
      ...(recorder && { experimental_transform: recorder.transform }),
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
      maxOutputTokens: ARTIFACT_MAX_OUTPUT_TOKENS,
      // Cancel the upstream generation when the CONNECTION goes away (Stop button,
      // tab close, network drop) — otherwise Anthropic keeps generating, and
      // billing, to maxOutputTokens for a response nobody receives. The recorder
      // saves whatever had streamed. Switching chats or views inside the app does
      // not abort anything: the client keeps the connection open, the turn runs to
      // completion, and the full reply is saved.
      abortSignal: req.signal,
      // An aborted run has no totalUsage, so sum the steps that DID complete —
      // those tokens are already billed. The SDK also runs onFinish afterwards
      // (with null usage) whenever a step was recorded before the abort; onAbort
      // wins because it fires first and is the one holding real numbers.
      onAbort: ({ steps }) => {
        persistUsage(sumUsage(steps.map(s => s.usage)));
      },
      // Citation-compliance log (server-side; visible in Vercel logs). Plain
      // streamText onFinish — NOT the createUIMessageStream wrapper, which
      // masks route 500s (documented trap, see the 07-12 handoff).
      onFinish: ({ text, totalUsage, steps }) => {
        // markers = parseable (canonical grammar); loose = cite-intended tokens
        // that fail the grammar (near-misses the renderer normalizes or strips).
        // Fresh regexes from .source — never match on the shared /g exports.
        const markers = (text.match(new RegExp(CITE_RE.source, 'g')) ?? []).length;
        const loose = (text.match(new RegExp(LOOSE_CITE_RE.source, 'g')) ?? []).length - markers;
        console.log('[cite-compliance]', JSON.stringify({ chatId, grounded, docCtx: !!documentContext, markers, loose }));
        // totalUsage is summed across the 12-step tool loop — never a single
        // step's. On a post-abort onFinish this is the SDK's null usage object
        // and persistUsage's first-wins guard drops it.
        //
        // But when a LATER step's stream rejects (a hard 429/529 after
        // maxRetries) the SDK enqueues an `error` part and closes without a
        // `finish` part, so onFinish is handed a null-usage object — DEFINED,
        // with every count undefined — while `steps` still carries each
        // completed step's real usage. Sum the steps in that case so billed
        // tokens are never frozen as a $0 row. (An abort with zero completed
        // steps never reaches onFinish at all — flush returns early when no
        // step was recorded — which is why persistUsage's undefined check can
        // sit before its guard.)
        // (`totalUsage?.` — the SDK always passes an object, but optional so a
        // partial event can degrade to the steps sum rather than throw.)
        const usage =
          totalUsage?.inputTokens == null && totalUsage?.outputTokens == null
            ? sumUsage((steps ?? []).map(s => s.usage))
            : totalUsage;
        persistUsage(usage);
      },
    });

    // Drain the stream server-side regardless of the client: without this the
    // recorded-transform `flush` that calls onFinish never runs on a cancelled
    // response, and the usage row is silently lost (audit C1). The same drain is
    // what carries the turn recorder to the end of the stream.
    const drained = Promise.resolve(result.consumeStream());
    if (recorder) {
      // Catch-all: a pipeline that ERRORS (as opposed to emitting an error part)
      // skips the recorder's finish/abort/flush hooks entirely — save what
      // streamed once the drain settles: insert the row, or bring a checkpointed
      // row up to the final text. No-op when the final text was already written.
      const settled = drained.then(recorder.persist, recorder.persist);
      // PROMISE form of after(): the write is already in flight (it has to finish
      // before the `finish` chunk goes out), and this keeps the function alive
      // until it lands when the client has disconnected. Registered here, inside
      // the request scope — stream callbacks are not reliably in it. Outside a
      // request scope (unit tests) after() throws; the promise runs regardless.
      try {
        after(settled);
      } catch {
        // not in a Next request scope
      }
    }

    return result.toUIMessageStreamResponse({
      sendSources: true,
      sendReasoning: true,
      // Server-authoritative ids for the client's post-turn steps. On `start`:
      // the chat, its DB project and the user row. On `finish`: the same plus
      // the assistant row (already saved — the recorder holds `finish` back
      // until the final write returns).
      ...(recorder && {
        messageMetadata: ({ part }: { part: { type: string } }) =>
          part.type === 'start' || part.type === 'finish' ? turnMetadata() : undefined,
      }),
      // streamText() is synchronous — a provider error (bad key, rate/credit
      // limit, an oversized context, an overload, Fable's 30-day retention
      // requirement) is never thrown into the surrounding try/catch; it's routed
      // here instead. See providerErrorMessage: a specific, fixed message per
      // failure class, never the provider's raw text.
      onError: providerErrorMessage,
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
