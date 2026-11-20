# Audit Remediation (2026-11-12) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix every verified finding of the 2026-11-12 full audit — security, data integrity, correctness, dead code and docs — so the app is secure, loses no data, and carries no stale code or stale claims.

**Architecture:** Five phases in risk order (A security → B data integrity → C correctness → D dead code & docs → E low). The one architectural change is B1: chat-turn persistence moves server-side into `/api/chat`, so a reply is saved to the chat it was sent from no matter what the client does next; every other task is a local fix at the cited `file:line`. Each task ships with the tests that prove it and lands as its own local commit on `master`.

**Tech Stack:** Next.js 16 App Router, React 19, AI SDK v6 (`ai@6.0.x`, `@ai-sdk/react@3`), Drizzle + Supabase Postgres (PGlite in tests), Vitest + Testing Library, Supabase Storage.

**Spec:** `docs/audits/2026-11-12-full-audit/` — `README.md` (index, controller corrections) and the four lane reports (`security.md` S*, `backend.md` B*/C*/D*/X*, `frontend.md` U*/F*, `deadcode-docs.md` D*/P*/C*/K*/T*/R*). Every finding ID below refers to those reports; read the finding's "Evidence" and "Minimal fix" before starting its task. Supersedes `docs/plans/2026-11-12-sidebar-review-fixes.md` (folded in as B4/B5).

## Progress (2026-11-18)

- **Phases A, B, C: done.** Every task implemented, independently reviewed, fix rounds re-reviewed; each phase gate passed (Phase C gate: typecheck 0, lint 0 errors / 23 warnings, cold build OK, 172 files / 1518 tests).
- **Not started:** Phases D and E, the Final gate (Fable whole-branch review of `60fdb40..HEAD`, CHANGELOG, handoff) and the Release steps.
- **Backup push (owner request, 2026-11-18, before a laptop reset):** pushed to `origin/remediation/2026-11-12-audit`, NOT `master`. `master` auto-deploys to production, and migrations `0022`–`0024` are not applied and the final review has not run. GitHub `master` is still `v4.55.1`. Resume from that branch — see `docs/SESSION_HANDOFF_2026-11-18.md`.

## Owner decisions (2026-11-12)

1. **F1/U1:** a reply is saved to the chat it was sent from, even after the user navigates away. Never discard it, and never `stop()` the stream on a chat switch.
2. **Restore, don't delete:** the per-project defaults dialog (D1), the message Delete/Regenerate actions (D2) and the "Default system prompt" setting (D4/U9).
3. **Delete:** `/api/classify` + `saveChatTopics`/`getChatTopics` + `classifyRequestSchema` + its test + the `chat_topics` table (drop-table migration) (D3), and the Google Search grounding branch (D8).
4. **One plan**, the sidebar plan folded in and widened to all seven dead `SidebarActions` members (D5). Phase commits on `master`, Fable final review, **no push**.

## Global Constraints

- Code style: match the file (most are single-quote, no-semicolon; some older files use semicolons). **Never run `prettier --write`.**
- Tailwind v4 semantic tokens only in new UI (`bg-card`, `bg-muted`, `hover:bg-accent`, `border-border`, `text-muted-foreground`); gradient utility is `bg-linear-to-*`.
- **Tailwind scanner gotcha:** never write a literal citation marker (bracket + `cite:` + digits) in any file under `src/` other than `src/app/api/**`, `src/lib/citations.ts`, `src/lib/documents/tool.ts`. Gate builds are cold (`rm -rf .next`).
- Stage named paths only — never `git add -A` / `git add .`.
- Commits: Conventional Commits 1.0, imperative lowercase, no trailing period, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (the implementer's own model line if different). Commit to `master` locally. **Never push.**
- **Vitest must run from an uppercase `C:` cwd**: PowerShell `Set-Location 'C:\dev\atelier_ai_gpt'` first (a lowercase `c:/` cwd fails every test file with "reading 'config'").
- Task gate: `npm run typecheck` (0 errors) → `npm run lint` (0 errors; 25 baseline warnings) → the task's targeted tests. **Phase gate** (end of each phase, before its last commit): `rm -rf .next && npm run build`, then the full `npm test` (baseline 143 files / 999 tests; record the new counts).
- `.env.local` points at **production** Supabase and real keys. Implementers never run `npm run dev`, never run anything that connects to the DB or calls a provider, and never print secret values.
- Migrations: `npx drizzle-kit generate` only (writes `drizzle/00NN_*.sql` + journal). **`drizzle-kit push` is forbidden.** Implementers never apply migrations to Supabase — applying them is a release step the owner approves (see "Release steps").
- When a task changes behavior that `CLAUDE.md` or `docs/architecture/*.md` describes, update that doc in the same commit. **Ask the owner before editing** `docs/MODEL_ROUTING.md`, any `docs/specs/*`, any `SKILL.md`, or this plan's scope.
- `CLAUDE.md` is LF in the index; the working copy is CRLF via `core.autocrlf=true`. Edit in place; never rewrite the file wholesale.

## Review Focus

1. **Leaving a chat mid-stream, or closing the tab** (New chat, Projects/Artifacts/Images, Back, archive, switch chat). The reply must end up saved exactly once in the chat it was sent from, and the next chat's transcript and request body must not contain it. → B1 tests `persists-to-origin-chat-after-switch`, `next-chat-request-excludes-orphan`.
2. **Stop (or a dropped connection) during a tool call, then send again.** The next turn must succeed. → B2 test `ignores-incomplete-tool-calls`.
3. **Refresh or deep link** (`?project=P&chat=C`, `?chat=C` for an archived chat) while lists load in any order. The chat stays open with its own project. → B4 `isStaleChatId` tests.
4. **Attaching large files** (a 6 MB photo, two 2.5 MB photos, a 20 MB PDF) on production limits. Each either works or shows a size-specific message, and the attachment survives a refresh. → B6 tests `rejects-over-combined-image-budget-with-message`, `extract-by-storage-path`.
5. **Gemini outage** (embedding throws, 429 retries, a stalled call). A chat turn must still answer, with keyword-leg document context, within bounded latency. → C1 tests `keyword-leg-survives-embedding-failure`, `best-effort-calls-time-out`.

---

## Phase A — Security & dependencies

### Task A1: Dependency security patch

Model: implementer Opus; review Opus (lockfile has bitten CI three times — handoff 2026-09-11 finding 9).

**Files:** Modify `package.json`, `package-lock.json`.

**Interfaces:** none.

- [ ] **Step 1:** Read the Next.js 16.4 release notes and upgrade guide for breaking changes affecting `src/proxy.ts`, `next.config.ts` headers, server actions and `after()`; list any in the commit body (or "none").
- [ ] **Step 2:** `npm install next@16.4.6 eslint-config-next@16.4.6` then `npm update axios follow-redirects @xmldom/xmldom zod`. `npm ls next axios follow-redirects @xmldom/xmldom zod` shows `next@16.4.6`, `axios ≥1.20.0`, `follow-redirects ≥1.16.2`, `@xmldom/xmldom ≥0.8.15`, `zod ≥4.6.6`.
- [ ] **Step 3: Lockfile under both npm versions:** `npm ci --dry-run` AND `npx -y npm@10 ci --dry-run` both exit 0. If npm 10 reports `Missing: esbuild@…`, restore the nested `node_modules/vitest/node_modules/esbuild` + `@esbuild/*` entries as `"optional": true`, using the recipe in `6504189`. Never regenerate with `npm@10 install --package-lock-only`.
- [ ] **Step 4:** `npm audit --omit=dev` shows no `next` advisory and none for the four bumped packages (record the remaining count in the commit body; S7 table explains the rest as unreachable).
- [ ] **Step 5:** Phase-style gate: typecheck → lint → `rm -rf .next && npm run build` → `npm test`, all green.
- [ ] **Step 6: Commit** `build(deps): bump next to 16.4.6 and patch axios, follow-redirects, xmldom, zod`

### Task A2: Close the CSP exfiltration channel and tighten headers (S1, C7, K15)

Model: implementer Sonnet; review Opus (security).

**Files:** Modify `next.config.ts`; Test `tests/unit/lib/securityHeaders.test.ts` (create); Modify `CLAUDE.md` Security section.

**Interfaces:** Produces `buildContentSecurityPolicy(supabaseOrigin: string | null): string`, exported from `next.config.ts` (or a new `src/lib/securityHeaders.ts` that `next.config.ts` imports — implementer's choice; keep one source of truth).

- [ ] **Step 1: Failing tests:**
  - `connect-src` with origin `https://abc.supabase.co` equals `connect-src 'self' https://abc.supabase.co` and the full string does not contain `connect-src 'self' https:` followed by `;`.
  - With `null` origin, `connect-src` falls back to `'self' https:` (same fallback rule the `img-src`/frame logic uses).
  - `frame-src` no longer contains `youtube-nocookie.com` (C7: players can't work in the sandbox and `TOOL_GUIDANCE` forbids them).
  - Response headers include `Permissions-Policy: camera=(), microphone=(), geolocation=()`. `poweredByHeader` is `false`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; keep the existing inline comments that explain `'unsafe-inline'` and `frame-ancestors 'self'`.
- [ ] **Step 4:** Run → PASS; `rm -rf .next && npm run build` succeeds.
- [ ] **Step 5:** `CLAUDE.md` Security headers line: list `connect-src 'self' <supabase>`, `object-src`, `Referrer-Policy`, `Permissions-Policy`, and drop the youtube allowance (K15).
- [ ] **Step 6: Commit** `fix(security): restrict csp connect-src to self and supabase`

### Task A3: Auth gate hardening (S2, S3, S4, S6, prior S8)

Model: implementer Opus; review Opus.

**Files:** Modify `src/app/api/auth/route.ts`, `src/lib/rateLimit.ts`, `src/proxy.ts`, `src/app/login/page.tsx`, `src/lib/auth.ts`; Tests `tests/unit/api/auth-route.test.ts`, `tests/unit/proxy.test.ts`, `tests/unit/lib/safeNext.test.ts` (create); Modify `docs/AUTH.md`.

**Interfaces:**
- Produces in `rateLimit.ts`: `reserveLoginAttempt(key: string): { allowed: boolean; retryAfterSec: number }` — counts the attempt synchronously, **before any await**; `clearLoginAttempts(key)` on success. Replaces the check-then-record pair.
- Produces `src/lib/safeNext.ts`: `safeNextPath(next: string | null, origin: string): string` — resolves with `new URL(next, origin)`, returns `pathname + search + hash` when same-origin, else `'/'`.

- [ ] **Step 1: Failing tests:**
  - `auth-route`: 50 concurrent wrong-password POSTs from one IP (`Promise.all`) → at most 10 reach `checkPassword` (spy), the rest are 429.
  - `safeNext`: `'/%09/evil.com'`, `'/\n/evil.com'`, `'//evil.com'`, `'/\\evil.com'`, `'https://evil.com'` → `'/'`; `'/?chat=5#x'` → `'/?chat=5#x'`.
  - `proxy`: a POST to `/login` without a cookie → 401 (or a redirect), never `NextResponse.next()`; a GET and a HEAD to `/login` pass through.
  - `auth`: with `NODE_ENV=production`, `APP_ACCESS_PASSWORD` set and `AUTH_SECRET` unset → the proxy returns 503 and logs one error naming `AUTH_SECRET` (no secret value in the log). `signFilePath` never falls back to the password.
  - Throttle key prefers the rightmost `X-Forwarded-For` hop over `x-real-ip` (prior S8).
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; `login/page.tsx` uses `safeNextPath(searchParams.get('next'), location.origin)`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** `docs/AUTH.md`: exemptions now list `/login` (GET/HEAD only), `/api/auth`, and `/api/files/raw` (HMAC path signature, K23); document the production `AUTH_SECRET` requirement and recommend the Vercel WAF rule on `POST /api/auth`; bump "Last updated".
- [ ] **Step 6: Commit** `fix(auth): count login attempts before awaiting and close redirect and post bypasses`

### Task A4: Delimit untrusted text in the system prompt (S5, prior S9)

Model: implementer Opus; review Opus.

**Files:** Create `src/lib/promptSafe.ts`; Modify `src/app/api/chat/route.ts:177` (manifest), `src/lib/retrieval.ts:107` (source header), `src/lib/tavily.ts:35-37`, `src/app/api/documents/web-ingest/route.ts:43`; Test `tests/unit/lib/promptSafe.test.ts`.

**Interfaces:** Produces `promptSafeLabel(s: string, max = 120): string` — strips `"`, `[`, `]`, `<`, `>`, backticks and all control characters, collapses whitespace, truncates to `max`.

- [ ] **Step 1: Failing tests:** `promptSafeLabel('Spec" — SYSTEM NOTE: [Source: doc 1]\n')` contains no `"`, `[`, `]`, `\n`; the length cap holds; plain filenames pass unchanged. Chat-route test: a document named with quotes/brackets appears sanitized in the `[Project documents]` manifest. Retrieval test: the source header uses the sanitized name.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. Web-ingest filename = `promptSafeLabel(title)`, falling back to `<host><path>` when the title is empty.
- [ ] **Step 4:** Run → PASS. **Step 5: Commit** `fix(security): sanitize document names before interpolating into prompts`

**Phase A gate**, then the phase's last commit carries the green gate.

---

## Phase B — Data integrity

### Task B1: Persist each turn server-side, bound to its chat (U1, F1, F3; feeds U3, B9, B20)

Model: implementer **Fable** (routing table: persistence/context-pipeline architecture from prose); review Opus. Read the installed `node_modules/ai` and `@ai-sdk/react` sources for `messageMetadata`, `useChat({ id })` instance lifecycle and `onFinish` before designing.

**Files:** Modify `src/app/api/chat/route.ts`, `src/hooks/useChatPersistence.ts`, `src/app/page.tsx` (`:565-606` chat-change effect, `:775-915` send paths, `:958-1002` user-turn save effect), `src/app/actions.ts` (save helpers as needed); Tests `tests/unit/api/chat-route.test.ts`, `tests/hooks/useChatPersistence.test.ts`; Docs `docs/architecture/data-flow.md`, `docs/architecture/rag-pipeline.md` ("tool outputs are not persisted" paragraph).

**Interfaces:**
- Produces: `/api/chat` persists the incoming user message (only when its id is not a DB integer) and the final assistant text to the **request's `chatId`**, validated against `chats`. The assistant row is written once: in `onFinish`, or in `onAbort` with the text streamed so far, whichever fires first (reuse the existing first-wins guard pattern). Writes run via `after()`.
- Produces: assistant UI message metadata `{ chatId: number; projectId: number | null; userMessageDbId: number | null; assistantMessageDbId: number | null }`, sent with `toUIMessageStreamResponse({ messageMetadata })`. `projectId` comes from the DB chat row, not the client.
- Produces: client post-turn steps (attachments, generated-image linking, embed, persona usage, summarize gate, auto-memory, title, artifact refetch) read `chatId`/`projectId`/DB ids from that metadata — never from `activeChatIdRef`/`activeProjectIdRef`. Client-side `saveMessage` calls for user and assistant text are removed, and so is the `:958-1002` effect (fixes F3).
- Produces: switching chats never calls `stop()`. The `useChat` store must not receive another chat's stream: use `useChat({ id: <chat key> })` instance-per-chat, or an equivalent the implementer proves with the tests below. The deferred-create path starts with an empty store.

- [ ] **Step 1: Failing tests:**
  - `persists-to-origin-chat-after-switch` (route): a request for chat 1 whose client disconnects mid-stream still writes the assistant row to chat 1 (mock model, abort the request signal mid-stream → one assistant row with the partial text; no abort → one row with the full text). Exactly one row either way.
  - `persists-user-message-once` (route): a user message with a UUID id is inserted once; a message whose id is a DB integer is not re-inserted (F3).
  - `rejects-unknown-chat` (route): a `chatId` that doesn't exist → 404, no writes.
  - `metadata-carries-db-ids` (route): the finish metadata has `chatId`, the DB `projectId` (not the body's), and both DB ids.
  - `next-chat-request-excludes-orphan` (hook/page-level, jsdom): stream in chat A, switch to Home mid-stream, send a new message → the posted `messages` array contains no assistant message from A.
  - `post-turn-steps-use-metadata` (`useChatPersistence`): with `activeChatIdRef`=7 and `activeProjectIdRef`=42 but metadata `{chatId: 3, projectId: 5}`, embed/memory/persona calls use 3 and 5.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement per Interfaces; update the two docs paragraphs.
- [ ] **Step 4:** Run → PASS, plus all of `tests/hooks/` and `tests/unit/api/`.
- [ ] **Step 5: Commit** `fix(chat): persist each turn server-side to the chat it was sent from`

### Task B2: Chat-route context assembly (B1, B3, B4, prior C4)

Model: implementer Opus; review Opus.

**Files:** Modify `src/app/api/chat/route.ts:108,144-160,197`; Create `src/lib/contextBudget.ts`; Test `tests/unit/api/chat-route.test.ts`, `tests/unit/lib/contextBudget.test.ts`; Docs `docs/architecture/rag-pipeline.md` (five layers, "Recent messages" line, K27).

**Interfaces:** Produces `stubOldToolOutputs(messages: UIMessage[]): UIMessage[]` — in every message except the last assistant turn, replaces the `output` of `read_document` parts with `{ stubbed: true, documentId, fromPage?, nextOffset?, note: 're-read if needed' }`; returns the input array unchanged (same reference) when nothing needs stubbing. Produces `recentTail(messages, summaryUpToMessageId: number | null, min = 20, max = 60)` — keeps every message newer than the summary boundary, at least `min`, capped at `max`.

- [ ] **Step 1: Failing tests:** `ignores-incomplete-tool-calls` — history with a tool part in `input-available`, then a user message → the provider is called (the SDK probe in `backend-scratch/sdk-probe.mjs` shows the pre-fix failure). `stubs-old-read-document-outputs` — two earlier 100k-char outputs become stubs, the current turn's output stays intact. `tail-covers-summary-gap` — summary ends at message 22 of 51 → messages 23–51 all sent (B4). With no summary, behavior is unchanged except the `max` cap.
Also `surfaces-provider-errors` (prior C9): the route's `onError` returns a sanitized, specific message for 401/403 (bad key), 429 (rate or credit limit), 413/400 (context too large) and 529/5xx (provider overloaded), instead of the generic "An error occurred." Raw provider text never reaches the client.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement; `convertToModelMessages(…, { ignoreIncompleteToolCalls: true })`.
- [ ] **Step 4:** Run → PASS. **Step 5: Commit** `fix(chat): survive interrupted tool calls and stop replaying old tool outputs`

### Task B3: Keep a moved chat's data with it (B2, U3 server side, B13 project trust)

Model: implementer Opus; review Opus.

**Files:** Modify `src/app/actions.ts:232` (`moveChatToProject`), `src/app/api/embed/route.ts`, `src/app/api/memory/suggest/route.ts`, `recordPersonaUsage` call site in `page.tsx:1168`; Tests `tests/unit/actions/chats.test.ts`, `tests/unit/api/embed-route.test.ts`, `tests/unit/api/memory-suggest-route.test.ts`.

**Interfaces:** `moveChatToProject(chatId, projectId)` runs in one `db.transaction` updating `project_id` on `chats`, `artifacts`, `message_embeddings`, `persona_usage`, and `usage_events` where `chat_id = chatId`. `/api/embed` and `/api/memory/suggest` derive `projectId` from `chats.project_id` for the given `chatId` and ignore any body `projectId` (the schema keeps it optional for one release; remove it in D-phase cleanup).

- [ ] **Step 1: Failing tests:** move chat (with artifact + embedding) from A to B, delete A → artifact and embeddings survive under B (the probe output in backend.md B2 is the inverse). Embed with body `projectId: 42` for a chat in project 5 → row stored with 5. Memory-suggest the same.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5: Commit** `fix(data): move a chat's artifacts, embeddings and usage with the chat`

### Task B4: Navigation state — loading order, archived chats, palette (U2, U7, U14, F8, F9; sidebar plan Task 2)

Model: implementer Opus; review Opus.

**Files:** Create `src/lib/chatLookup.ts`; Test `tests/unit/lib/chatLookup.test.ts`; Modify `src/app/page.tsx` (`currentChat` :125-127, mount loaders :526-528, validator :537-551, `loadArchivedChats` :431-438, `handleRestoreChat` :1107-1113, `handleConfirmDeleteProject` :1008-1021, palette props :1522-1524, `sidebarActions` :1216-1241), `src/components/chat/sidebar/types.ts`, `src/hooks/useUrlNavSync.ts:98-109`; Tests `tests/hooks/useUrlNavSync.test.ts`.

**Interfaces** (generic over `C extends { id: number; projectId: number | null }`):
- `type ChatLists<C> = { chats: C[]; standaloneChats: C[]; archivedChats: C[] }`; `type LoadedFlags = { chats: boolean; standalone: boolean; archived: boolean }`
- `findChatById(id: number | null, lists): C | undefined` — searches chats → standalone → archived.
- `isStaleChatId(id: number, lists, loaded: LoadedFlags): boolean` — true only when **all three** flags are true and `id` is in none of the lists (replaces the old `allChats.length > 0` guard; fixes U2).
- `moveRestoredChat(lists, chatId): ChatLists<C>` — the semantics in the sidebar plan Task 2 (same-reference no-op, no duplicates).
- `SidebarActions.openChat(id: number, projectId: number | null)` → `setActiveView('home')`, `setActiveProjectId(projectId)`, `setActiveChatId(id)`. The command palette uses the same view-aware handlers as the sidebar (U7).

- [ ] **Step 1: Failing tests:** the seven `chatLookup` cases from the sidebar plan Task 2, plus `isStaleChatId(12, {chats: [], standaloneChats: [s1], archivedChats: []}, {chats: false, standalone: true, archived: true})` → `false` (U2). `useUrlNavSync`: a no-op popstate followed by navigation → one push and the URL updated (F8). A `?chat=N` deep link that resolves its project → `replaceState`, never `pushState` (F9). Deleting a project removes its chats from `chats` state (U14; assert via a small exported reducer or helper).
- [ ] **Step 2:** FAIL. **Step 3:** Implement. Each loader sets its flag in `finally`. **Step 4:** PASS.
- [ ] **Step 5: Commit** `fix(nav): validate deep links only after all chat lists load and open archived chats`

### Task B5: Archived chats in the sidebar and dead sidebar actions (F2, D5, D6; sidebar plan Tasks 1 + 3)

Model: implementer Opus; review Opus.

**Files:** Create `src/components/chat/sidebar/ArchivedChatsSection.tsx`, `tests/hooks/ArchivedChatsSection.test.tsx`; Modify `ChatItem.tsx`, `Sidebar.tsx`, `sidebar/types.ts`, `page.tsx` (`handleCreateChat` :748-754 and the remaining dead mappings), `tests/hooks/Sidebar.test.tsx`; Docs `docs/architecture/source-map.md` sidebar line.

**Interfaces:** `ArchivedChatsSection({ chats, activeChatId, projects })` exactly as the sidebar plan Task 3 specifies (collapsed by default, one `useLocalStorage<boolean>('sidebar-archived-open', false, v => typeof v === 'boolean')`, rows `ChatItem variant="archived"` → `actions.openChat(chat.id, chat.projectId)`). `SidebarActions` loses all seven dead members (`createProject`, `renameProject`, `deleteProject`, `selectProject`, `openProjectDocuments`, `openProjectSettings`, `createChat`). Task C8 reopens the project-settings dialog through a page prop instead. Keep `handleOpenProjectSettings` in `page.tsx`. `SidebarProps.activeProjectId` and the `'project'` `ChatItem` variant are removed.

- [ ] **Step 1:** The sidebar plan's Task 1 Steps 1–3 are moot: the six resurrected files don't exist in the `c:\dev` clone. Confirm with `git status --short` and `ls`.
- [ ] **Step 2: Failing tests:** all six `ArchivedChatsSection` cases and both `Sidebar` cases from the sidebar plan Task 3. `git grep -nE "(createProject|renameProject|deleteProject|selectProject|openProjectDocuments|openProjectSettings|createChat):" -- src/components/chat/sidebar src/app/page.tsx` → no `SidebarActions` members left after the change.
- [ ] **Step 3:** FAIL → implement → PASS.
- [ ] **Step 4: Commit** `fix(sidebar): restore archived chats and drop dead sidebar actions`

### Task B6: Attachments that respect the platform body limit (U4, U10, U11, F18, handoff item 3)

Model: implementer Opus; review Opus.

**Files:** Create `src/lib/imageDownscale.ts` (browser only), `src/app/api/attachments/upload-url/route.ts`; Modify `src/components/chat/ChatInputArea.tsx:139-218,411,505,524`, `src/lib/fileAttachments.ts:14-19`, `src/app/api/extract/route.ts`, `src/lib/validation.ts`, `page.tsx:821-835,984-996`; Tests `tests/unit/api/extract-route.test.ts`, `tests/unit/api/attachments-upload-url.test.ts` (create), `tests/unit/lib/fileAttachments.test.ts`, `tests/hooks/ChatInputArea-attachments.test.tsx` (create).

**Interfaces:**
- Chat images: only `image/png|jpeg|webp|gif` are accepted (U11; others are rejected with "Unsupported image type"). Each image is downscaled client-side to a long edge ≤ 2048 px and re-encoded as WebP at quality ≈ 0.85 when larger than 1 MB. The send is refused with "Images too large to send together (max 3 MB)" when the combined base64 payload exceeds `CHAT_IMAGE_BUDGET_BYTES = 3 * 1024 * 1024`.
- Non-image files: the browser gets a signed upload via `POST /api/attachments/upload-url { chatId, filename, mediaType, size }` → `{ path, token }` (`attachments/<chatId>/pending/<uuid>-<sanitized>`, ≤ `MAX_FILE_SIZE`), uploads with `uploadToSignedUrl`, then calls `POST /api/extract { storagePath }` (JSON). The multipart path stays for files ≤ 4 MB as a fallback. The path must match the chat's prefix (no traversal).
- Client: a shared `readError(res: Response): Promise<string>` (also used by U12 in C7): `res.json().catch(() => null)`, with a status fallback (`413` → "File too large for upload").
- Send stays disabled while `isExtracting`. Attachment state uses functional updates (`setAttachedFiles(prev => …)`, U10/F18). A failed `saveMessageAttachments` shows a toast instead of a console-only error.

- [ ] **Step 1: Failing tests:** `rejects-over-combined-image-budget-with-message`; `rejects-svg-heic-avif`; `extract-by-storage-path` (route reads from mocked Storage, path outside `attachments/<chatId>/` → 400); `upload-url-validates-size-and-type`; `send-disabled-while-extracting`; `concurrent-drops-keep-all-files`; `readError` on an HTML 413 body returns the size message.
- [ ] **Step 2:** FAIL → **Step 3:** implement → **Step 4:** PASS.
- [ ] **Step 5: Commit** `fix(attachments): route large files through storage and cap image payloads`

**Phase B gate.**

---

## Phase C — Correctness

### Task C1: Retrieval resilience and fusion (B5, B9, B10, B11, prior D1)

Model: implementer Opus; review Opus.

**Files:** Modify `src/lib/retrieval.ts:30-121`, `src/lib/mmr.ts`, `src/lib/queryRewrite.ts`, `src/lib/rerank.ts`, `src/lib/embeddings.ts`, `src/lib/keywordSearch.ts:59-60`; Tests `tests/unit/lib/retrieval.test.ts`, `tests/unit/lib/mmr.test.ts`, `tests/unit/lib/keywordSearch.test.ts`; Docs `rag-pipeline.md`, fix the false comment at `retrieval.ts:31-36`.

**Interfaces:** `mmr()` takes an optional relevance per candidate. Retrieval passes the normalized `rrfScore` when fusion ran, and chunks present in the keyword list are exempt from MMR, like keyword-only hits. `retrieveContext` takes `excludeChatId?: number`: when the full chat history is in the prompt, semantic message retrieval excludes rows with that `chatId` (B9). Best-effort Gemini calls (rewrite, query embedding, rerank) use `abortSignal: AbortSignal.timeout(RAG_STAGE_TIMEOUT_MS)` (default `4000`, env-overridable in `ragConfig.ts`) and `maxRetries: 0`. Keyword FTS uses `websearch_to_tsquery` with OR-joined terms (D1).

- [ ] **Step 1: Failing tests:** `fused-chunk-survives-mmr` (the RRF [15,1,2,99,3] case from backend.md B5 keeps 15); `keyword-leg-survives-embedding-failure` (embedding throws → doc context non-null from the keyword leg); `excludes-current-chat-messages`; `best-effort-calls-time-out` (a never-resolving rewrite mock → retrieval completes within timeout + 500 ms using the raw query); `fts-or-matches-partial-question`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `fix(rag): keep fused hits through mmr and degrade per leg with timeouts`

### Task C2: Embedding and summary reliability (B13, B21, B22, B4 client side, handoff item 4 code path)

Model: implementer Opus; review Opus.

**Files:** Modify `src/app/api/embed/route.ts:57-65`, `src/lib/validation.ts` (`embedRequestSchema.content` max), `src/lib/ingest.ts:26-35`, `src/app/actions.ts:594-603` (`updateDocumentStatus` can clear `errorMessage`), `src/app/api/summarize/route.ts:74-77`, `src/hooks/useSummarization.ts:36-44`, `useChatPersistence.ts:142-144`; Add server action `backfillMissingEmbeddings({ since?: Date, limit = 200 }): Promise<{ embedded: number; failed: number; remaining: number }>`; Tests in the matching files.

**Interfaces:** `/api/embed` returns 502 on failure and embeds `content.slice(0, EMBED_MAX_CHARS)` (default `8000`). The ingestion embed pool (`src/lib/embedChunks.ts:17-30`) aborts after `EMBED_FAIL_FAST_AFTER` consecutive failures (default `5`), so a full outage fails the document fast instead of running into the platform kill (B11 ingest half). `backfillMissingEmbeddings` selects `messages` with no `message_embeddings` row (oldest first), embeds them, and is idempotent. **Running it against production is a release step the owner approves, not part of this task.** *(Changed in the C2 review round: the backfill is not a server action, so it is no network endpoint. It lives in `src/lib/embeddingBackfill.ts`, is run with `scripts/backfill-embeddings.ts`, and returns `{ embedded, failed, skipped, remaining }`, where `skipped` counts rows never attempted because the breaker tripped.)*

- [ ] **Step 1: Failing tests:** embed failure → 502; long content capped; backfill embeds only missing rows and a second run reports `embedded: 0`; ingest all-embeds-fail sets an `errorMessage`; a later `ready` clears a stale `error_message`; summarize with empty model text keeps the old summary and boundary; `useSummarization` re-arms on non-2xx.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `fix(embeddings): surface embed failures and add a backfill for missing vectors`

### Task C3: Artifact rendering fidelity (B6, B7, B14, B17, B18, X5, X13)

Model: implementer Opus; review Sonnet. **Ruling (2026-11-14):** reviewed on Opus, not Sonnet — the diff was ~300 src lines over 12 files and touched usage recording (MODEL_ROUTING rule 4); the scoped fix-round re-review ran on Sonnet.

**Files:** Modify `src/app/api/artifacts/[id]/regenerate/route.ts:15,50`, `src/lib/artifacts/{markdown,toDocx,toXlsx,toPdf,style,tool,render}.ts`; Tests `tests/unit/lib/artifacts/*.test.ts`, `tests/unit/api/artifact-regenerate-route.test.ts`.

**Interfaces:** markdown list items gain `level: number` and nested lists recurse (renderers indent by level). `generate_artifact`'s schema enforces `xlsx ⇔ array content` and `others ⇔ string content`, returning an in-band error. Regenerate uses the chat route's output cap and returns 422 without writing a version when `finishReason === 'length'`; its model resolves through the registry (prior C8). DOCX gets a numbering instance per ordered list and splits code blocks on `\n` into breaks. XLSX sheet names are sanitized (`[]:*?/\` removed, ≤31 chars, unique case-insensitively); the formula guard applies only to strings starting `= + - @` that are not plain numbers or a lone `-`. PDF `winAnsi` maps U+2018/2019 → `'` and U+201C/201D → `"`. `style.ts` uses the warm palette tokens from `globals.css` (terracotta `#C96442`, ink `#20201E`, muted line `#E8E6DF`).

- [ ] **Step 1: Failing tests:** nested bullets and blockquote lists survive into DOCX/PDF/PPTX models; two ordered lists both start at 1; a code block keeps 3 lines; sheet names `Q1/Q2 Costs`, a duplicate and a 40-char name all render; `-12.5` is numeric, `=SUM(A1)` is guarded; `winAnsi("don’t “quote”")` → `don't "quote"`; regenerate with `finishReason: 'length'` → 422, no version row; an xlsx tool call with string content → in-band error; style exports contain no `1F3447`/`4F7396`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `fix(artifacts): keep nested lists, numbering and quotes and reject truncated regenerations`

### Task C4: Document replace and ingest integrity (B8, B25, X7, X8, X12, prior D2)

Model: implementer Opus; review Opus.

**Files:** Modify `src/app/api/documents/process/route.ts:65-248`, `src/app/api/documents/upload-url/route.ts:35-47`, `src/lib/ingest.ts`, `src/db/schema.ts` (unique `(document_id, chunk_index)` on `document_chunks`); Generate migration `drizzle/0022_*.sql`; Tests `tests/unit/api/documents-process.test.ts`, `documents-upload-url.test.ts`, `tests/unit/lib/ingest.test.ts`.

**Interfaces:** Every replace failure exit restores `ready` when the document had chunks before the request (`chunkCount > 0`), otherwise `error`. The process tail is wrapped so a throw after `processing` restores status the same way. `ingestText` runs chunk insert + status update in one transaction and claims the document with `UPDATE … SET status='processing' WHERE id=$1 AND status IN ('uploading','ready','error') RETURNING`, so a concurrent call is a no-op. `upload-url` signs before inserting (or deletes the row on signing failure). Replace-abort removes the `rev<N>` objects it uploaded.

- [ ] **Step 1: Failing tests:** each of the four replace failure exits (`:65`, `:77`, `:117`, `:164`) leaves a previously ready doc `ready`; a throw mid-tail restores status; two concurrent `ingestText` calls → `chunk_count` equals the row count (the D2 probe gives 12 vs 6); signing failure leaves no `uploading` row; the migration applies in PGlite.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `fix(documents): keep healthy documents ready on failed replace and make ingest atomic`

### Task C5: Extraction and windowing accuracy (X1, X9, X11)

Model: implementer Opus; review Opus.

**Files:** Modify `src/app/api/documents/process/route.ts:144`, `src/lib/pageMap.ts:15-16`, `src/lib/pdfSegments.ts:42-66`, `src/lib/visionExtraction.ts:127,152`, `src/lib/documents/windowing.ts:40`; Tests `tests/unit/lib/{pageMap,pdfSegments,visionExtraction,windowing}.test.ts`; Docs `rag-pipeline.md`, `database.md` (K28).

**Interfaces:** The hybrid splice emits a `# Page n` anchor for text-path pages too, so `pageMap` stamps every chunk with its real page. `onSkip(page)` carries the absolute page number, and skipped plus capped pages are recorded in `failedPages`. `sliceWindow` never ends mid-page when anchors exist: it backs off to the last anchor at or before the cap unless one page alone exceeds the cap.

- [ ] **Step 1: Failing tests:** 40-page doc with one vision run on p4 → the first chunk `{1,1}`, the last `{40,40}` (the X1 probe gives `{4,4}` for both); an oversize skipped page appears in `failedPages`; window 1 ends at a page boundary and window 2 starts with `# Page`.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `fix(extraction): anchor every page and record skipped pages`

### Task C6: Model registry, pricing and cost-ledger coverage (B12, B19, C3, C5, C7, seed/price currency)

Model: implementer Opus; review Opus (cost ledger). **Before touching prices, load the `claude-api` skill and take current model ids and per-MTok prices from it; never from memory.**

**Files:** Modify `src/lib/models/{registry,pricing,seed,curate}.ts`, `src/lib/providers.ts:41`, `src/app/actions.ts:401-403`, `src/lib/usage.ts` (`UsagePurpose`), `src/db/schema.ts` (`usage_events_purpose_chk`), the five uncaptured sites (`api/suggest-followups`, `lib/queryRewrite.ts`, `lib/rerank.ts`, `api/images/generate`, `lib/visionExtraction.ts`); Generate migration `drizzle/0023_*.sql`; Tests `tests/unit/lib/models/*.test.ts`, `tests/unit/lib/usage.test.ts`, the five sites' tests; Docs `model-registry.md` (K29), `CLAUDE.md` "six capture sites" wording.

**Interfaces:** The registry keeps the last good live build and serves it marked `stale` when a refresh fails; it falls back to the seed only with no prior live build, and in-flight builds are deduplicated. `updateProjectDefaults` never nulls a model while `registry.source !== 'live'`. `resolveRequestedModel` returns the matched catalog id (C3). Exact pricing and override lookup also try the derived bare alias (B19). `STATIC_SEED` and `EXACT_PRICING` list the current newest model per family with prices from the `claude-api` skill. Adaptive thinking is attached only when the model's capabilities report thinking support (C7). `curate.ts` parses `claude-3-x-<family>` ids into the right family (prior C6). New purposes: `'suggest-followups' | 'query-rewrite' | 'rerank' | 'image-generate' | 'vision-extract'` — added to `UsagePurpose` and to the CHECK in the same migration. `'classify'` stays allowed for historical rows.

- [ ] **Step 1: Failing tests:** a refresh failure after a live build serves the live models (marked stale) and `resolveRequestedModel('claude-opus-5')` passes through; `updateProjectDefaults` keeps the model under a stale registry; a dated-only id prices from the alias row with `estimated: false`; each of the five sites writes one `usage_events` row with its purpose; a purpose outside the list fails the CHECK; the migration applies in PGlite.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `fix(models): serve last good catalog on refresh failure and record every llm call`

### Task C7: Front-end correctness, medium tier (U5, U6, U8, U12, U17, F6, prior C9)

Model: implementer Opus; review Opus.

**Files:** Modify `page.tsx` (`:367-379` error auto-dismiss, `:775-915` send guard, `:385` models fetch, `:1074-1107` handlers, `:1206-1209`, `:1321-1330` banner placement), `ProjectContextRail.tsx:44,80-127`, `ProjectDocumentsDialog.tsx:90-99`, `AddFromWebDialog.tsx:39`, `useDocumentUpload.ts`, `useWebIngest.ts`, `ModelDefaultsSettingsTab.tsx:55-66`, `ApiKeysSettingsTab.tsx:21-41`; Tests: matching `tests/hooks/*.test.tsx`.

**Interfaces:** `sendingRef` is set synchronously at send entry and cleared in `finally`, and the input clears before the first await (U5). `ProjectContextRail` takes `onMemoryChanged(projectId, memory)` (U6). The settings-changed path fetches `/api/models` with `{ cache: 'no-store' }` (U8). `readError` from B6 is used in every upload, ingest and delete path, and delete failures toast (U12). The error banner renders at page level for every view; errors stay until dismissed or replaced, with no 5-second auto-dismiss (F6/C9). Rename, move, archive, restore, context save and settings save each show success or failure feedback, and `ApiKeysSettingsTab` shows an error state when status fails (U17).

- [ ] **Step 1: Failing tests:** double Enter on Home → `createStandaloneChat` called once; accept suggestion → parent `projects[].memory` updated; an HTML 504 from process → toast text is not `SyntaxError`; error set on Home is visible; `ApiKeysSettingsTab` rejects status → error shown, not a spinner.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `fix(ui): guard double sends and surface every failure`

### Task C8: Restore the unreachable features (D1, D2, D4/U9; owner decision 2)

Model: implementer Opus; review Opus. **Ruling (2026-11-14):** the fix-round re-review ran on Opus, not Sonnet — round 1 redesigned regenerate persistence (in-place replace in a transaction inside the B1 recorder), a concurrency/persistence change, not a short fix list (MODEL_ROUTING rule 4). Round 2 (~40 src lines) was verified inline by the controller. Same inline check for C5 round 1.

**Files:** Modify `ChatHeader.tsx` (project chat ⋮ menu), `ProjectsView.tsx` (project card menu), `ProjectLandingPage.tsx` (header menu). Each takes an `onOpenProjectSettings(projectId: number)` prop that `page.tsx` wires to `handleOpenProjectSettings`. `page.tsx:1339-1351` (pass `onDeleteMessage`, `onRegenerate` to `MessagesList`); `MessagesList.tsx`, `MessageActions.tsx`; `page.tsx` new-chat create paths (`:781-805`, `:873-909`) apply `default-system-prompt`; Tests `tests/hooks/ProjectsView.test.tsx`, `ProjectLandingPage.test.tsx`, `MessagesList-actions.test.tsx` (create), `tests/unit/actions/messages.test.ts`; Docs `docs/PERSONAS.md` (K21, K22).

**Interfaces:**
- Per-project defaults: a "Project settings" item in each of the three menus opens `ProjectDefaultsDialog`.
- Delete: removes the message via the existing `deleteMessage` server action (with its Storage cleanup) and from the store.
- Regenerate: only on the last assistant message. It removes that message and resends the preceding user turn; with B1's server persistence, the server deletes the replaced assistant row in the same request, and the request carries `regenerate: true` + `replaceMessageDbId`.
- Default system prompt: applied when a chat is created with no persona or custom prompt, in this precedence: persona prompt → custom prompt → default system prompt.
- `PERSONAS.md`: the real entry points, and the custom-persona fields (name, icon, prompt, Grounded).

- [ ] **Step 1: Failing tests:** each menu has "Project settings" and opens the dialog; Delete is visible and calls `deleteMessage(id)`; Regenerate on the last assistant sends `regenerate: true` with the replaced id and leaves exactly one assistant row (route test); a new chat with no persona gets `default-system-prompt` as its system prompt.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `feat(ui): restore project settings, message delete and regenerate, and default prompt`

### Task C9: Remove dead back-end features (D3, D8, D26; owner decision 3)

Model: implementer Sonnet; review Opus (migration).

**Files:** Delete `src/app/api/classify/route.ts`, `tests/unit/api/classify-route.test.ts`; Modify `actions.ts:553-563` (remove `saveChatTopics`/`getChatTopics`), `validation.ts:64`, `schema.ts:195` (remove `chatTopics`), `providers.ts:68-69` (Gemini text returns `{ model }` only), `useSummarization.ts`, `useChatTitle.ts`, `validation.ts:36-47` (drop the ignored `model` field), `api/models/route.ts:14-18` + `CommandPalette.tsx:115` (drop `digest`, key by `id`); Generate migration `drizzle/0024_*.sql` (`DROP TABLE chat_topics`); Docs `CLAUDE.md` gotchas 3/6/8 and Provider Routing (K10), `data-flow.md` (K24).

**Interfaces:** `createProvider` return type loses `tools` for Gemini text. `UsagePurpose` keeps `'classify'` (historical rows). B16 becomes moot.

- [ ] **Step 1:** `git grep -nE "classify|chatTopics|chat_topics|google_search|googleSearch|digest" -- src tests` → only the intended remaining references (`'classify'` in `UsagePurpose`/CHECK).
- [ ] **Step 2:** typecheck, lint, `npx vitest run tests/unit/api tests/unit/actions tests/unit/db` → PASS; the migration applies in PGlite.
- [ ] **Step 3: Commit** `refactor: remove unused classify route, chat topics table and search grounding`

**Phase C gate.**

---

## Phase D — Dead code, docs and hygiene

### Task D1: Dead code, stale comments, deps and test hygiene sweep

Model: implementer Sonnet; review Sonnet. The list is exhaustive: each item's evidence is in `deadcode-docs.md`.

**Files:** as listed per item.

- [ ] **Step 1: Delete** D7 (unreachable "No Chat Selected" branch), D9 `tests/global-setup.ts`, D10 `tests/helpers/mock-ai.ts`, D11 `scripts/spike-vision-extract.mjs`, D12 `scripts/smoke-c2-render.mjs` (`git rm`), D13 the five `public/*.svg`, D14, D15, D16, D17 `updatePersona`, D18, D19, D20, D21 unused imports/locals (keep the two signature params, prefixed `_`). **Un-export** D24 and every D25 symbol. D22/D23: `resolveTier`, `getChats`, `getSettings` stay test-only; mark each with a one-line comment naming why it is kept, or delete it with its test if nothing justifies it (record which in the commit body).
- [ ] **Step 2: Stale comments** C2–C14 corrected to match the code (C1 goes with D9; C7 and C8/C9 are already done by A2 and C9).
- [ ] **Step 3: Deps** — P1: add `@vitest/coverage-v8` matching the installed vitest major (`npm run test:coverage` runs). P2: move `dotenv` to devDependencies only if `src/db/index.ts` no longer needs it (Next loads env itself; verify a cold build without it). P3: move `tailwindcss-animate` and `@tailwindcss/typography` to devDependencies. P6: add `"packageManager": "npm@11.11.0"` and `.nvmrc` = `22`. Re-validate the lockfile with npm 10 and npm 11 (A1 Step 3).
- [ ] **Step 4: Test hygiene** — T1: add `tests/audit-tmp/` to `.gitignore`, the Vitest `exclude`, `tsconfig` `exclude` and the ESLint ignores. T4/T5: tighten the two e2e locators to role-based queries that match what the test names claim. T7: remove the unused test locals.
- [ ] **Step 5: Repo** — R1 `git rm --cached sqlite.db`. R3: track `skills-lock.json` or remove the contradicting `.gitignore` comment (keep it ignored; fix the comment).
- [ ] **Step 6:** Phase-style gate (cold build + full `npm test`). **Commit** `chore: remove dead code, stale comments and test scaffolding`

### Task D2: Make the docs true (K1–K31, `.env.example`)

Model: implementer Sonnet; review Opus (accuracy against code).

**Files:** `README.md` (rewrite to current state: K1–K9), `CLAUDE.md` (K11–K14, K16–K20 and the "three keys" line; K10/K15 are done by C9/A2), `docs/architecture/*.md` (K24–K31 that earlier tasks didn't already fix; add the 39 undocumented modules to `source-map.md` as one line each), `docs/PERSONAS.md` (done in C8 — verify), `docs/AUTH.md` (done in A3 — verify); Create `.env.example` (every env var the code reads, with defaults and a comment; values are placeholders).

- [ ] **Step 1:** For each K item, edit the claim to the "Correct" value in `deadcode-docs.md`. Re-check it against the current code (earlier phases changed some of it).
- [ ] **Step 1b:** Add a Mermaid architecture diagram (`docs/architecture/overview.md`, linked from README and CLAUDE.md's deep-dive table): browser → Next.js (proxy gate, App Router pages, `/api/*`, server actions) → Supabase Postgres + Storage, Anthropic (chat), Gemini (embeddings, images, housekeeping), Tavily (web ingest). Text-based so agents can keep it current.
- [ ] **Step 2:** `git grep -n "SESSION_HANDOFF.md" -- README.md PLAN.md` points at the current dated handoff.
- [ ] **Step 3:** `.env.example`: `git grep -hoE "process\.env\.[A-Z0-9_]+" -- src | sort -u` is a subset of its keys.
- [ ] **Step 4: Commit** `docs: correct stale claims and add env example`

### Task D3: Archive shipped docs (R5–R9)

Model: implementer Sonnet; review Sonnet.

**Files:** `git mv` into the layout in `deadcode-docs.md` §R:
- the 18 historical handoffs → `docs/archive/handoffs/`; keep `2026-09-11` and `2026-11-12` in `docs/handoffs/`
- chatlogs → `docs/archive/chatlogs/`
- shipped plans → `docs/archive/plans/`, keeping this plan and the sidebar plan
- specs not cited by `docs/architecture/` → `docs/archive/specs/`
- `PLAN.md`, `REQUIREMENTS_QUESTIONS.md`, `ATELIER_BRAND_SKILL_V2.md` → `docs/archive/root/`
- `TECH_STACKS.md` → fold its live content into README, then archive it
- drop `docs/audits/2026-09-01-codebase-audit.html` (the `.md` stays)
- `docs/SESSION_HANDOFF.md` becomes a three-line pointer

Update every link: `CLAUDE.md` handoff pointer, README, `MODEL_ROUTING.md`. MODEL_ROUTING.md is a governance doc: **ask the owner before changing it**, even for links only.

- [ ] **Step 1:** `git mv` per the layout. **Step 2:** `git grep -nE "docs/(SESSION_HANDOFF_|chatlog-|plans/|specs/)" -- '*.md'` → every hit resolves to an existing path. **Step 3:** Cold build (the `@source not "../../docs"` exclusion still covers the tree). **Commit** `docs: archive shipped handoffs, plans and chatlogs`

**Phase D gate.**

---

## Phase E — Low-severity items

### Task E1: Back-end lows (B15, B20, B23, B24, B26, prior D5, D6, D10, X6, X10, security lows)

Model: implementer Opus; review Sonnet.

- **B15:** `acceptSuggestion` uses `UPDATE … WHERE status='pending' RETURNING`, and appends only when a row came back.
- **B20:** `generate_image` inserts its DB row server-side, using the B1 metadata chat id, and removes the object if the insert fails; `images/generate` cleans up on insert failure.
- **B23:** clear the settings cache *after* the write commits.
- **B24:** document the signature-rotation behavior in `AUTH.md` (no code change).
- **B26:** replace with a function in `memory/suggest`.
- **D5:** batch the chunk updates.
- **D6:** don't await the project touch.
- **D10:** bump `updated_at`.
- **X6:** delete the current revision's `extracted.txt` on document delete.
- **X10:** unique `(artifact_id, version)` plus a retry; migration `0025`.
- **Prior security lows:**
  - `setSetting` key allow-list
  - `memory/suggest` logs no model text on parse failure
  - the Tavily URL schema accepts `http(s)` only
  - the `DocumentPreviewDialog` PDF `<iframe>` gets a `sandbox` attribute
  - `/process` checks magic bytes against the declared MIME type (prior S5)
- **X4:** `deleteProject` sweeps its Storage prefixes (`documents/<id>/`, `artifacts/<id>/`, `images/<id>/`, and the attachments of its chats) before the cascade.
- **Prior D4:** CHECK constraints on `documents.status` and `messages.role` in migration `0025`, after a read-only check that existing rows comply. The implementer verifies this against PGlite fixtures; the owner verifies it live before applying.

Each item gets one failing test first, then the fix. **Commit** `fix: close low-severity back-end gaps`

### Task E2: Front-end lows and accessibility (U13, U15, U16, U18, U19, U20, F5, F7, F10–F17, F19, F20, §2.5 Lows)

Model: implementer Opus; review Opus.

- **U13:** a shared document list between the dialog and the rail.
- **U15:** stop keydown propagation from the chat menu.
- **U16:** reset `openInEdit` after create, and add the host chat to state.
- **U18:** refresh signed URLs on open when they're older than 50 minutes.
- **U19:** a cancel path during `submitted`.
- **U20:** the follow-ups effect is keyed by message id.
- **F7:** focus-visible reveal for hover-only controls.
- **F10:** Escape handling, `role="dialog"` and a focus trap for the palette.
- **F11:** keyboard-operable rows and cards.
- **F12:** `Dialog.Description` everywhere.
- **F13:** throttle localStorage writes during drag.
- **F14:** linear `reconstructChunks`.
- **F15:** z-order of the mobile sidebar and the hamburger.
- **F16:** greeting computed after mount.
- **F17:** the Images filter row is always shown.
- **F19:** the thumbnail uses the same-origin proxy.
- **F20:** cancellable fetch effects.
- **F5:** semantic tokens instead of raw `-400`/`-500` colors.
- **§2.5 Lows:**
  - `SheetsPreview` guard
  - keyboard-closable dropdowns
  - `ArtifactWorkspace` versions reload and `pointercancel`
  - stale `default-model` cleared
  - the dialog uploads all files
  - `PROJECT_CAPACITY_BYTES` from the server
  - `global-error.tsx` tokens
  - `Lightbox` focus and scroll lock

- **"Also noted" in `frontend.md`:**
  - Escape in the composer asks before clearing a non-empty draft
  - `ImagesView` respects the active filter when prepending a new image
  - `ImagesView` maps 503 reasons separately ("no Gemini key" vs "storage not configured")
  - opening an archived chat from the gallery works (B4 covers the validator)

Each item gets a failing test, or a jsdom assertion where testable, before the fix. **Commit** in two or three coherent commits (`fix(a11y): …`, `fix(ui): …`).

### Task E3: Untrusted document text in prompts (S5 / prior S9 chunk-body half; added 2026-11-13 from the A4 review)

Model: implementer Opus; review Opus.

**Files:** Modify `src/lib/retrieval.ts` (chunk formatting), `src/lib/documents/tool.ts:42-51` (`read_document` error/output text), `src/lib/projectPreamble.ts` (document names); Test `tests/unit/lib/retrieval.test.ts`, `tests/unit/lib/documents-tool.test.ts`.

**Interfaces:** consumes `promptSafeLabel` from A4. Chunk bodies that contain a line shaped like the retrieval source header (`[Source: doc N …]`) or the `[Project documents]` marker get it neutralized (for example, a zero-width break inside the bracket, or the bracket replaced with `(`) before interpolation; plain prose is unchanged. `read_document` and the project preamble use `promptSafeLabel(doc.filename)`.

- [ ] **Step 1: Failing tests:** a chunk whose body contains a forged `[Source: doc 99 …]` line → the assembled context has exactly one real header per chunk and the forged one is neutralized; ordinary text with brackets (`array[0]`) is unchanged; `read_document` errors and the preamble show the sanitized filename.
- [ ] **Step 2–4:** FAIL → implement → PASS. **Step 5: Commit** `fix(security): neutralize forged source headers in document text`

**Phase A review follow-ups (fold into the named tasks):** D2 — add `X-DNS-Prefetch-Control` to the CLAUDE.md security-headers line; D1 — drop the unused `LOGIN_MAX_FAILURES` alias in `src/lib/rateLimit.ts` and re-check whether the `eslint-plugin-react-hooks` 7.0.1 override in `package.json` can follow `eslint-config-next`'s `^7.1.0`; any dependency change in C9/D1 must restore the nested vitest esbuild lockfile entries (`scripts/restore-vitest-esbuild-lock.mjs` — snapshot `git show HEAD:package-lock.json` before the install; usage is in the script header) and pass both `npm ci --dry-run` and `npx -y npm@10 ci --dry-run`.

**Phase B review follow-ups (added 2026-11-13; fold into the named tasks):**
- **C1:** semantic retrieval's exclusion set must be the ids actually sent (`recentTail`), not the full posted history, or messages beyond the 60-message cap drop out of every layer (B2 review).
- **C7:** `handleMoveChat` has the restore race B4 fixed: move the chat between `chats`/`standaloneChats` in the same tick (like `moveRestoredChat`) or set both lists together. Also: `handleConfirmDeleteProject` calls `navSync.suppressNextPush()` before nulling ids; comment that a failed list load counts as loaded; a palette-wiring render test (U7); `saveMessageAttachments` maps rows one-to-one (or throws), never `flatMap`-drops, so index pairing can't shift; tag each extraction with the chat it started in and ignore late results after a switch (U10 leftover); a page-level test that an oversized send creates no chat and keeps the input.
- **C8:** Regenerate must not double-insert the user row. `saveUserTurn` inserts any last message with a non-DB id, so skip it when `trigger === 'regenerate-message'` / `replaceMessageDbId` is set. Delete the `eslint-disable` on `handleOpenProjectSettings` once it's wired.
- **E1:** the server links `generate_image` tool-result `storagePath`s to the assistant row it inserted (removes the client's ~1.2 s `getAssistantReplyId` retry and the two-tab pick-up risk; covers tab-close on media turns); artifact inserts, `recordUsage` and `message_embeddings` take `project_id` from the chat row at INSERT time (a chat moved mid-turn); re-sign or proxy expired attachment URLs in a long-open tab; downscale images whose long edge is over 8000 px even under 1 MB; reword the 403 message to cover "model not enabled"; optionally resolve the provider before inserting the user row; `recentTail` steps back to a user message. From the C2 review: a sibling backfill for `document_chunks` with NULL `embedding` (a new upload whose embed pool tripped the breaker stays `ready` with most chunks keyword-only and nothing re-embeds them), plus an informational note on the document when `aborted && embedded > 0`. From the C4 review: `createDocumentRevision` moves inside the `commitDocumentReplacement` transaction (a retry after a rolled-back commit writes a duplicate revision row); the stale-`processing` reaper restores the prior status (`ready` for a replace of a healthy doc) instead of `error`; an uncertain commit outcome must not overwrite a landed `ready` with `error`. From the C5 review: when a vision run's leading `# Page n` is outside the run's page range (relative numbering), renumber or drop that run's anchors so anchors stay monotonic (`fromPage` lookup skips the run otherwise). From the C8 review: server-side image linking also removes a race where Regenerate/Delete appear while the previous turn's `saveGeneratedImage`/`postEmbed` are still running against the old reply (FK error, orphaned Storage objects).
- **E2:** archived sidebar rows are not keyboard-reachable (F11). From the C5 review: `DocumentCard`'s Partial tooltip says "Vision failed on pages…" but `failedPages` now also holds capped pages — use neutral copy ("No vision text for pages…").
- **D1:** the client still sends the ignored `projectId` in the embed and memory-suggest bodies; drop it from the client and the schemas. From the C4 review: move the document-ingest DB group out of `'use server'` `actions.ts` into a non-action server module (e.g. `src/lib/documentIngestDb.ts`) together: `claimDocumentForProcessing`, `commitDocumentIngest`, `commitDocumentReplacement`, `updateDocumentStatus`, `createDocumentRevision`; delete the now-dead `embedChunks()`, `updateChunkEmbedding`, `saveDocumentChunks`, `deleteDocumentChunks` (and `embedChunks.test.ts`, keeping its breaker coverage on `embedContents`); drop the redundant `idx_chunks_document_id` via a generated migration (never push).

**Phase E gate.**

---

## Phase R — Code-review findings (2026-11-20)

Added 2026-11-20 (owner-approved scope edit). `/code-review` of Phases A–C raised 7 findings (4 Important, 3 nits); all 7 were verified against the code before planning. Four are gaps in B1's server-side turn persistence. Tasks run in order R1 → R5, one local commit each, TDD. The Global Constraints above bind every task. No schema change, so no migration.

Owner-visible decisions: **R3** enables Vercel request cancellation, so a closed tab or a dropped connection cuts the reply (the partial is saved) — the behaviour `route.ts` and `data-flow.md` already describe; switching chats inside the app still never cuts a reply. **R4** keeps an image that an artifact embeds instead of deleting the artifact (artifacts carry no `messageId`). **R4** sweeps stale pending uploads opportunistically, with no cron.

### Task R1: Never send before the chat's history has loaded (review finding 1)

Model: implementer **Opus**; review Opus.

**Problem:** `loadMessages` (`src/app/page.tsx:565`) returns early when `isChatBusy(cid)` (`:596`), and `handleSendMessage` (`:953`) has no way to know a history load is pending. Type a draft on Home, open an existing chat and press Enter before `getChatMessages` resolves: the turn starts, `loadMessages` bails, the session holds only the new message, `/api/chat` receives `messages=[new message]` (the route builds model context from the posted messages only) and passes `excludeChatId`, so semantic retrieval cannot bring the turns back. Every later turn in that session repeats the truncated history. The same hole exists after a load that threw ("Failed to load messages." then send).

**Files:** Modify `src/app/page.tsx`; Tests `tests/hooks/page-chat-turns.test.tsx` (the real `<Home/>` with an actions Proxy mock and a controllable SSE fetch stub — follow its patterns).

**Interfaces:**
- `loadMessages(cid)` returns `Promise<boolean>`: `true` when the transcript was applied, or when the chat's live session is authoritative (the `isChatBusy` early return); `false` when the load was stale (`activeChatIdRef.current !== cid`) or threw.
- A new `historyLoadRef = useRef<{ chatId: number; done: Promise<boolean> } | null>(null)`, set by the chat-change effect (`:685-731`) to the load it starts. The `skipLoadOnceRef` branch (deferred create) starts no load and must leave no stale entry for that chat.
- `handleSendMessage`: after the existing empty-composer / `isLoading` / `sendingRef.current` guards, set `sendingRef.current = true` and, when `activeChatId` is set and `historyLoadRef.current?.chatId === activeChatId`, **await `done` before** `refuseOversizedSend(activeChatId)` and `takeComposer()` — the size check must see the real transcript, and the draft stays in the composer while waiting. If the load returned `false`: retry `loadMessages(activeChatId)` once (recording it in `historyLoadRef`); if that is also `false`, or `activeChatIdRef.current !== activeChatId` after any await, do **not** send — keep the draft, `toast.error("Couldn't load this chat's history — your message was not sent")` and return. `sendingRef.current` is reset in a `finally`, as today.
- Unchanged: the textarea stays enabled (`e2e/chat-flow.spec.ts:10`); `handleProjectLandingCompose` and the deferred-create branch of `startSend` (they create a chat and set `skipLoadOnceRef`); `handleRegenerate`; `handleDeleteMessage`.

- [ ] **Step 1: Failing tests:**
  - `send-waits-for-history`: `getChatMessages` for an existing chat returns a deferred promise. Type a draft, open the chat, press Enter → no `/api/chat` request yet. Resolve the history with two rows → exactly one `/api/chat` request whose posted `messages` are the two history messages followed by the new one.
  - `send-refused-after-failed-load`: `getChatMessages` rejects (also on the retry). Enter → no `/api/chat` request, the composer still holds the draft, an error toast is shown.
  - `send-after-load-unchanged`: once the history has loaded, a send behaves as before (one request, history + new message).
- [ ] **Step 2:** Run → FAIL (the first two).
- [ ] **Step 3:** Implement per Interfaces.
- [ ] **Step 4:** Run → PASS, plus all of `tests/hooks/`.
- [ ] **Step 5: Commit** `fix(chat): wait for the chat history before sending`

### Task R2: Checkpoint the reply while it streams (review finding 2; client half of finding 4)

Model: implementer **Opus**; review Opus.

**Problem:** the turn recorder (`createAssistantTurnRecorder`, `src/lib/chatTurn.ts:142`) writes the assistant row only at the stream's `finish` / `abort` / flush, or in the route's post-drain catch-all (`src/app/api/chat/route.ts:442-454`). None of those runs when the function is killed (`maxDuration = 300`, a crash, a deploy), and the client no longer saves reply text, so a reply the user watched stream is lost and its generated images are linked to no message (`getAssistantReplyId` finds no row). The same missing row is why a Stop whose abort never reaches the server leaves the reply without an id.

**Files:** Modify `src/lib/chatTurn.ts`, `src/lib/chatTurnDb.ts`, `src/app/api/chat/route.ts` (`:358-366`); Tests `tests/unit/lib/chatTurn.test.ts`, `tests/unit/lib/chatTurnDb.test.ts`, `tests/unit/api/chat-route.test.ts` (the real-SDK `describe('... server-side turn persistence')` block: `controlledModel`, `postTurn`, `settledRows`); Docs `docs/architecture/data-flow.md` ("Chat turns").

**Interfaces:**
- `createAssistantTurnRecorder({ save, update, checkpointMs = 3000, now = Date.now })`.
  - `save(text): Promise<number | null>` — the first write, unchanged in meaning: insert the row, or `replaceAssistantReply` on a regenerate. Returns the row id.
  - `update(id, text): Promise<void>` — a content-only rewrite of that row.
- **Checkpoint** (fired from `transform`, **never awaited** — it must add no latency to the stream): writes the text so far, by `save` when no row exists yet and by `update` afterwards. It fires
  1. as soon as the turn first has savable content — the existing persist rule, `text.trim() || hasMedia`;
  2. on every `tool-call` and `finish-step` part (text written before a long tool run must not wait for it);
  3. on a `text-delta` when `now() - lastWriteStartedAt >= checkpointMs`.
  It is skipped while another write is in flight (no overlap, no queue), when there is nothing savable, when the text equals the last written text and a row exists, and once `persist()` has started. A failed checkpoint is logged like a failed save and never breaks the stream; the next checkpoint or `persist()` tries again.
- `persist()` keeps its contract — first call wins, awaited before `finish` / `abort` is forwarded, idempotent, never rejects: it waits for an in-flight checkpoint, then returns if nothing is savable; inserts through `save` if no row exists; otherwise `update`s when the text differs from the last written text. Exactly one row per turn, and the id is on the `finish` chunk as today.
- `assistantMessageDbId()` returns the id as soon as the first write lands.
- New in `src/lib/chatTurnDb.ts`: `updateAssistantReplyContent(chatId: number, id: number, text: string): Promise<void>` — `UPDATE messages SET content` scoped to `id` + `chat_id` + `role = 'assistant'`, with the same `MAX_MESSAGE_LEN` slice. A row that no longer exists is a logged no-op (a deleted message is never resurrected).
- `route.ts`: pass `save` (the existing callback) and `update: (id, text) => updateAssistantReplyContent(chat.id, id, text)`. Regenerate keeps its rule: nothing savable streamed ⇒ the old reply is untouched; once savable content exists the first checkpoint replaces it in place (`replaceAssistantReply`), which is what any stop mid-stream already did. `replyHasSavedContent` (client mirror) stays exact — do not change it.
- No change to `messageMetadata` (ids still ride on `start` and `finish`); a stopped or failed turn keeps using the client's `getAssistantReplyId` lookup, which now finds the row.

- [ ] **Step 1: Failing tests:**
  - Recorder (`chatTurn.test.ts`, injected `now`): `checkpoints-first-savable-content` (one `save` after the first non-blank delta, none for whitespace-only or reasoning-only streams); `throttles-text-checkpoints` (deltas inside `checkpointMs` → no extra write; past it → one `update` with the text so far); `checkpoints-at-step-boundaries` (`tool-call` / `finish-step` → `update` when the text changed); `never-overlaps-writes` (a slow `save` in flight → no second write; `persist()` waits for it, then `update`s the final text); `failed-checkpoint-then-persist` (a rejecting `save` → `persist()` saves; the stream is not broken); `final-update-only-when-text-changed`; the existing finish / abort / flush / first-wins / media-only tests still pass with the new signature.
  - `chatTurnDb.test.ts`: `updateAssistantReplyContent` rewrites content in place, is scoped to chat and role, slices at `MAX_MESSAGE_LEN`, and is a no-op for a missing row.
  - Route (`chat-route.test.ts`, real-SDK style): `reply-survives-server-death` (push deltas and never close the stream → one assistant row holding the streamed text); `checkpointed-turn-ends-with-one-row` (deltas, checkpoint, more deltas, finish → exactly one row with the full text; the finish metadata carries its id); `regenerate-checkpoint-replaces-in-place` (the old row id carries the new partial text; still one assistant row); the existing abort-before-text → no row test still passes.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement per Interfaces; update `data-flow.md` "Chat turns": when the row is first written, the checkpoint cadence, and that a killed turn keeps the text up to its last checkpoint.
- [ ] **Step 4:** Run → PASS, plus all of `tests/unit/api/`, `tests/unit/lib/chatTurn*.test.ts` and `tests/hooks/`.
- [ ] **Step 5: Commit** `fix(chat): checkpoint the reply while it streams`

### Task R3: Make Stop reach the server on Vercel (review finding 4, server half)

Model: implementer **Sonnet**; review Opus.

**Problem:** the partial reply on Stop is saved, and the upstream generation cancelled, only when `req.signal` aborts (`route.ts:397`). Vercel delivers request cancellation to Node functions only when it is enabled per path with `supportsCancellation` (Vercel docs: "Cancellation is opt-in"), and the repo has no `vercel.json`. Without it a stopped turn runs to completion and is billed in full.

**Files:** Create `vercel.json`, `tests/unit/lib/vercelConfig.test.ts`; Docs `docs/architecture/data-flow.md` ("Chat turns" — the `abortSignal` sentence), `CLAUDE.md` (Deployment), this plan's Release step 3.

**Interfaces:**
- `vercel.json` (repo root), exactly:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "functions": {
    "src/app/api/chat/route.ts": {
      "supportsCancellation": true
    }
  }
}
```

- The in-file `export const maxDuration = 300` stays where it is.
- `CLAUDE.md` Deployment: one sentence — `vercel.json` exists only to enable request cancellation for `/api/chat` (Stop, tab close and a dropped connection abort `req.signal`; work that must survive is in `after()`), and the `functions` key must be updated if the route file moves.
- Release step 3 gains: (a) the deploy build must accept the `functions` pattern — if it reports an unmatched pattern, try `app/api/chat/route.ts`; (b) on production, press Stop about 5 s into a long reply, then send a follow-up → the saved reply equals what was shown, the follow-up's rows come after it, and `usage_events` has one row for the stopped turn with partial output tokens; (c) if Stop still does not abort the request, open a follow-up for an explicit stop endpoint (R2 keeps the transcript correct meanwhile).

- [ ] **Step 1: Failing test** `vercelConfig.test.ts`: `vercel.json` parses; every key of `functions` is a file that exists in the repo; `functions['src/app/api/chat/route.ts'].supportsCancellation === true`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Create `vercel.json`; update the two docs and Release step 3.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5: Commit** `fix(chat): enable request cancellation for the chat route`

### Task R4: Keep artifact-embedded images; sweep stale pending uploads (review findings 3 and 5)

Model: implementer **Opus**; review Opus.

**Problem (finding 3):** `replaceAssistantReply` (`src/lib/chatTurnDb.ts:58`) and `deleteMessage` (`src/app/actions.ts:217`, through `removeAttachmentObjects` at `:35`) remove every Storage object attached to the reply, including `attachments/<chatId>/generated/<uuid>.<ext>` images. An HTML artifact from the same reply embeds those images through the permanent `/api/files/raw?path=…&sig=…` URL (`embedUrl`, built in `src/lib/image/tool.ts:38` with the path URL-encoded) and survives both operations (artifacts have a `chatId` but no `messageId`), so it then shows broken images (502).

**Problem (finding 5):** a chat attachment uploaded for text extraction goes to `attachments/<chatId|compose>/pending/<uuid>-<name>` and is removed only in the `finally` of `/api/extract`. If that request never arrives (tab closed, network drop) the object stays for good; no row references it.

**Files:** Modify `src/lib/chatTurnDb.ts`, `src/app/actions.ts` (`deleteMessage`, `deleteChat`), `src/lib/storage.ts`, `src/app/api/attachments/upload-url/route.ts`; Create `src/lib/attachmentSweep.ts`; Tests `tests/unit/lib/chatTurnDb.test.ts`, `tests/unit/actions/attachments-storage.test.ts`, `tests/unit/api/attachments-upload-url.test.ts`, `tests/unit/lib/attachmentSweep.test.ts` (new); Docs `docs/architecture/multimodal-artifacts.md`, `docs/architecture/data-flow.md` (replace the "Known gap" sentence about pending objects, around line 15).

**Interfaces:**
- `pathsSafeToRemove(chatId: number, paths: string[]): Promise<string[]>` in `src/lib/chatTurnDb.ts` (server-only). A path containing `/generated/` is dropped from the result when its file name (the last path segment, `<uuid>.<ext>` — unique, and unaffected by the `%2F` encoding inside `embedUrl`) occurs in `artifacts.content` of that chat, or in `artifact_versions.content` of an artifact of that chat (an older version can be restored). Every other path is returned unchanged. One query for all candidate names, not one per path. If the lookup throws, return only the non-`generated` paths (a kept object is recoverable; a deleted one is not).
- `replaceAssistantReply`: filter `storagePaths` through `pathsSafeToRemove(chatId, …)` before `removeObjects`. The attachment **rows** are still deleted.
- `deleteMessage(id)`: read the row's `chatId`, select the attachment paths, filter them through `pathsSafeToRemove`, remove the rest, then delete the row. `removeAttachmentObjects` itself is unchanged — `deleteChat` keeps using it unfiltered.
- `src/lib/storage.ts`: `listObjects(prefix: string): Promise<Array<{ name: string; createdAt: string | null }>>` — supabase-js `.list(prefix, { limit: 1000 })` on the private bucket; `name` is the object name inside the prefix.
- `src/lib/attachmentSweep.ts`: `sweepPrefix(prefix: string, olderThanMs: number, now = Date.now()): Promise<number>` — lists the prefix, removes (`removeObjects`) the objects whose `createdAt` is older than `olderThanMs` (all of them when `olderThanMs` is 0), returns the count, never throws (logs a warning). `PENDING_ATTACHMENT_MAX_AGE_MS = 60 * 60 * 1000`. No-op when `!isStorageConfigured()`.
- `/api/attachments/upload-url`: after building the response, best-effort `after(() => sweepPrefix(<pending prefix of the requested scope>, PENDING_ATTACHMENT_MAX_AGE_MS))`, using `pendingAttachmentPrefix` from `src/lib/attachmentPaths.ts`; outside a request scope (`after` throws in unit tests) run it un-awaited, the pattern `route.ts` in `/api/chat` uses.
- `deleteChat(id)`: after its existing cleanup, best-effort `sweepPrefix` with age 0 over that chat's `pending/` prefix and over `attachments/<id>/generated/` (so an image kept above does not outlive its chat). Never fails the delete.

- [ ] **Step 1: Failing tests:**
  - `chatTurnDb.test.ts`: `keeps-generated-image-an-artifact-embeds` (current `artifacts.content` holding the URL-encoded `embedUrl`), `keeps-image-referenced-by-an-older-version`, `removes-unreferenced-generated-image`, `ignores-artifacts-of-other-chats`, `lookup-failure-keeps-generated-objects`; the attachment rows are gone in every case.
  - `attachments-storage.test.ts`: `deleteMessage` keeps an artifact-embedded image object and removes an unreferenced one; `deleteChat` sweeps the chat's `pending/` and `generated/` prefixes and still succeeds when the sweep fails.
  - `attachmentSweep.test.ts`: removes only objects past the age; age 0 removes all; a `listObjects` or `removeObjects` failure resolves to 0; Storage not configured → no calls.
  - `attachments-upload-url.test.ts`: a request for chat 7 sweeps chat 7's pending prefix with the 1 h age (compose scope → the compose prefix); a sweep failure does not change the response.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement per Interfaces; update the two docs.
- [ ] **Step 4:** Run → PASS, plus all of `tests/unit/actions/` and `tests/unit/api/`.
- [ ] **Step 5: Commit** `fix(storage): keep artifact-embedded images and sweep stale pending uploads`

### Task R5: Embed request cap and stale regenerate comments (review findings 6 and 7)

Model: implementer **Sonnet**; review Sonnet.

**Problem (finding 6):** `embedRequestSchema` caps `content` at 500,000 characters (`src/lib/validation.ts:65`) — the per-file `CHAT_ATTACHMENT_MAX_CHARS` — while `postEmbed` (`src/hooks/useChatPersistence.ts:32`) posts the whole message text (file text + header + typed text). A message with one full-size attachment is rejected with 400 and only a `console.warn`, although the route embeds just the first `EMBED_MAX_CHARS` (8,000).

**Problem (finding 7):** the comments at `src/lib/validation.ts:32-34` and `src/app/page.tsx:1410-1414` say `/api/chat` deletes the replaced reply before answering. It does not: `replaceAssistantReply` writes over the row when the new reply is persisted, and `handleRegenerate`'s restore logic depends on that.

**Files:** Modify `src/lib/validation.ts`, `src/hooks/useChatPersistence.ts`, `src/app/page.tsx` (comment only); Test `tests/hooks/useChatPersistence.test.ts`.

**Interfaces:**
- `export const EMBED_CONTENT_MAX_CHARS = 500_000` in `validation.ts`, used by `embedRequestSchema` (`.max(EMBED_CONTENT_MAX_CHARS)`).
- `postEmbed` sends `content: body.content.slice(0, EMBED_CONTENT_MAX_CHARS)`. The server guard and `tests/unit/api/embed-route.test.ts` are unchanged.
- Both comments reworded to: the request carries `regenerate: true` and the replaced reply's DB id; `/api/chat` writes the new reply over that row when it is persisted (nothing is deleted up front), so a regenerate that saves nothing keeps the old reply.

- [ ] **Step 1: Failing test** `caps-embed-content`: a turn whose user message text is 600,000 characters posts a 500,000-character `content` to `/api/embed`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implement; reword the two comments.
- [ ] **Step 4:** Run → PASS, plus `tests/unit/api/embed-route.test.ts` and `tests/unit/lib/validation.test.ts`.
- [ ] **Step 5: Commit** `fix(embed): cap the embed request body on the client`

**Phase R gate:** `rm -rf .next && npm run build`, then the full `npm test`; record the counts. Then a scoped re-review of the Phase R commits against the 7 findings (Opus). The Fable whole-branch review stays in the Final gate.

**Recorded, not fixed:** a killed function still leaves no `usage_events` row for that turn (usage is only known at step end); `generate_image` / `generate_artifact` do not take the abort signal; artifact Storage files on chat delete (X4) and project-delete sweeps.

---

## Final gate

1. Whole-branch review on **Fable** of `60fdb40..HEAD`. Brief: the audit index, the Review Focus list, the owner decisions. The reviewer verifies each finding ID is fixed or explicitly marked moot, and runs the full gate itself. Flag explicitly: B1's reply persistence relies on `streamText`'s **`experimental_transform`** (ai@6.0.230). Any AI SDK upgrade must re-verify it, and the handoff must say so.
2. Update `CHANGELOG.md` (`## [Unreleased]` with Security / Fixed / Removed / Docs sections keyed by finding ID) and write `docs/handoffs/SESSION_HANDOFF_<date>.md`.
3. **No push.**

## Deferred (not in this plan, recorded so nothing is silently dropped)

- **X2/X3:** vision extraction holds every segment in RAM and has no checkpointing within the 800 s limit. These need a design (resumable ingestion), not a fix.
- **D27:** the vestigial `artifacts.status` / `error_message` columns. Dropping them needs a migration for no user benefit.
- **`pdfjs-dist` 6:** a major-version hygiene bump; its advisory isn't reachable (S7 table).
- **Per-chat document scoping:** an open follow-up in the grounded-citations spec.
- **Historical cost rows (owner decision):** C6 corrected Sonnet 5 to $2/$10 (the scheduled $3/$15 never took effect) and added per-model cache-read rates (Opus 5.5 / Sonnet 5.5 0.05×, Fable 5.1/5.2 0.025×). `usage_events.cost_usd` is frozen at write time by design, so Sonnet 5 rows since 2026-09-01 read ~1.5× high and cache reads on those newer models 2–4× high. Repricing them is a production write — owner decides at release (first a read-only sum of the affected rows). Actual Anthropic invoices were always correct; only Atelier's own ledger is off.
- **Legacy hybrid page stamps (owner decision):** hybrid documents ingested before C5 keep wrong `page_start`/`page_end` (the X1 `{4,4}` stamping). `extracted.txt` can't repair them (the old splice stored no page boundaries). Options: (a) re-process each via Replace with the same file (Gemini cost); (b) null those chunks' `page_start`/`page_end` so citations stop pointing at the wrong page (a production write — owner-approved release step). First a read-only count of `extraction_method = 'hybrid'` documents created before the release.

## Release steps (owner-approved, not part of execution)

1. ~~Confirm `AUTH_SECRET` is set in Vercel Production and Preview~~ — **done 2026-11-13**: both targets have `AUTH_SECRET` and `APP_ACCESS_PASSWORD` (Vercel API, names only). Stale `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `DASHSCOPE_API_KEY` removed from Production the same day (owner still revokes them at Turso / DashScope).
2. First, read-only: count duplicate `(document_id, chunk_index)` pairs and total `document_chunks` rows, so the owner knows what migration `0022`'s dedup will delete. Also read-only: confirm nothing hand-made in the dashboard depends on `chat_topics` (`SELECT … FROM pg_depend d JOIN pg_class c ON c.oid = d.refobjid WHERE c.relname = 'chat_topics' AND d.deptype = 'n'`), since `0024`'s `DROP … CASCADE` would drop it silently. Then apply migrations `0022`–`0025` to Supabase with `DIRECT_URL=… npx drizzle-kit migrate` **before** pushing. Then verify `drizzle.__drizzle_migrations` has 26 rows.
3. Push → deploy, then live smoke:
   - Review Focus 1–4 on production
   - the Stop-mid-stream single `usage_events` row (handoff item 7)
   - B1 turn persistence: switch chats mid-reply, press Stop, and close the tab mid-reply; each partial reply is saved to the chat it was sent from (unit-verified only; `after()` keep-alive on Vercel is untested live)
   - live CSP header check
4. Backfill missing message embeddings in production (handoff item 4) with `scripts/backfill-embeddings.ts`. Dry run first:
   - `npx -y tsx --env-file=.env.local scripts/backfill-embeddings.ts --dry-run` (add `--since 2026-10-16` to scope it). This is a read-only count of `remaining`, with no embedding calls.
   - Then `npx -y tsx --env-file=.env.local scripts/backfill-embeddings.ts --since 2026-10-16 --limit 200`. Repeat until `remaining` is 0. Each run embeds up to `--limit` messages (max 1000), oldest first.
   - If a run reports `skipped` > 0 (exit code 1), the provider failed 5 times in a row and the run stopped. Check the Gemini key and quota before running again.
5. Add the Vercel WAF rate-limit rule on `POST /api/auth`.
