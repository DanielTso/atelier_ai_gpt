# Front-end correctness audit — Atelier Studio

Lane: client-side code (`src/app/page.tsx`, `src/hooks/**`, `src/components/**`, client libs). Repo `C:\dev\atelier_ai_gpt`, `master` @ `b64850c`. Read-only; `git status` clean before and after. Date 2026-11-12.

## Summary

The client's central weakness is unchanged since the 2026-09-01 audit: a streaming response is not bound to the chat it was sent from. F1 (reply written into the wrong chat), F3 (user turn re-saved on every open) and F6 (error banner only inside a chat) are all still open, and F1 has two further consequences not recorded before: leaving a streaming chat for any non-chat surface discards the reply permanently, and the orphaned message then leaks into the next new chat's transcript and request context (U1). Three other new High findings: refreshing or deep-linking a project chat bounces to the project landing page because the stale-id validator runs before project chats have loaded (U2); a stale `activeProjectId` tags embeddings and auto-memory suggestions with the wrong project (U3); and chat image attachments have the same Vercel body-limit problem as the known PDF failure, with a 10 MB client cap against a 4.5 MB platform limit (U4). The remaining findings are Medium/Low: double-submit creating duplicate chats, accepted memory suggestions being overwritten by stale parent state, command-palette navigation that does nothing from tab views, a 5-minute HTTP cache hiding newly configured models, and a write-only "Default System Prompt" setting. Of the 20 prior §2.5 findings, only F4 is mostly fixed; the rest are still open. `npm run lint`: 0 errors, 25 warnings. `npm run typecheck`, `npm run build` and the full suite were not run by this lane.

How findings were verified: "CONFIRMED (probe)" = reproduced by a Vitest probe in `C:\tmp\audit-2026-11-12\frontend-scratch\` (7 probes, run via `vitest.probe.config.mjs`, all executed). "CONFIRMED (trace)" = traced end to end through the code, including installed `ai@6.0.230` and `next@16.3.4` sources where behaviour depends on them, but not executed — the app was never started. "PLAUSIBLE" = depends on external behaviour I did not exercise.

## Findings

| ID | Sev | Status | Location | Defect |
|---|---|---|---|---|
| U1 | Critical | CONFIRMED (probe + trace) | `page.tsx:565-606`, `useChatPersistence.ts:57,70` | Leaving a streaming chat for a non-chat surface drops the reply permanently; the orphan message then leaks into the next new chat's transcript and `/api/chat` context |
| U2 | High | CONFIRMED (trace) | `page.tsx:525-551` | Refresh / deep link of a project chat is nulled by the stale-id validator before project chats load → lands on project landing |
| U3 | High | CONFIRMED (probe + trace) | `page.tsx:978,1168,1306,1523`; `useChatPersistence.ts:58,128,150-158` | Stale `activeProjectId` mis-scopes embeddings, auto-memory suggestions and persona usage to the wrong project |
| U4 | High | CONFIRMED client / PLAUSIBLE platform | `ChatInputArea.tsx:148`; `page.tsx:821-835,984-996` | Image attachments: 10 MB client cap vs 4.5 MB Vercel body limit → generic error, chat stuck re-sending, images silently lost on refresh |
| U5 | Medium | CONFIRMED (trace) | `page.tsx:775-811,860-915` | No in-flight guard on first send → double Enter / double click creates duplicate chats and duplicate sends |
| U6 | Medium | CONFIRMED (trace) | `ProjectContextRail.tsx:44,80-93`; `page.tsx:1206-1209` | Accepted memory suggestion not propagated to parent; rail remount shows stale memory and the next edit overwrites the accepted fact |
| U7 | Medium | CONFIRMED (trace) | `page.tsx:1522-1524` | Command palette "open chat / project" does nothing visible from Projects / Artifacts / Images views |
| U8 | Medium | CONFIRMED (trace) | `page.tsx:385`; `api/models/route.ts:26` | `/api/models` is `max-age=300` and fetched with default cache → models don't appear for up to 5 min after saving an API key |
| U9 | Medium | CONFIRMED (grep) | `ModelDefaultsSettingsTab.tsx:42,60,127-130` | "Default System Prompt" setting is saved but never read anywhere |
| U10 | Medium | CONFIRMED (trace) | `ChatInputArea.tsx:183-218,524` | Send is not blocked while a file is extracting; stale closure re-attaches already-sent files or attaches to the next message / another chat |
| U11 | Medium | PLAUSIBLE | `fileAttachments.ts:14-17`; `ChatInputArea.tsx:411` | SVG / HEIC / AVIF accepted as chat images and sent to Claude unfiltered → every turn in that chat fails |
| U12 | Medium | CONFIRMED (trace) | `useDocumentUpload.ts:16,28,43,55`; `useWebIngest.ts:16,25`; `ProjectContextRail.tsx:122-127`; `ProjectDocumentsDialog.tsx:90-99`; `AddFromWebDialog.tsx:39` | Non-JSON error bodies surface as raw `SyntaxError` toasts; failed deletes are silent; web-ingest discards the server's reason |
| U13 | Low | CONFIRMED (trace) | `ProjectContextRail.tsx:60-66,289`; `page.tsx:412-414,1457` | Documents dialog and Files rail hold separate lists → uploading via the dialog leaves the rail showing "No files yet"; project file counts never refresh |
| U14 | Low | CONFIRMED (trace) | `page.tsx:1008-1021` | Deleting a project leaves its chats in `chats` state → command palette lists dead chats that pass validation |
| U15 | Low | CONFIRMED (trace) | `ProjectLandingPage.tsx:173-175` | Row `onKeyDown` hijacks Enter/Space from the nested chat menu (events bubble through the portal) → keyboard menu actions also open the chat |
| U16 | Low | CONFIRMED (trace) | `ArtifactsView.tsx:62,144`; `ArtifactWorkspace.tsx:53` | After "New artifact", every save/revise flips the panel back to Edit (sticky `initialMode`); host chat never added to `standaloneChats` |
| U17 | Low | CONFIRMED (trace) | `page.tsx:1074,1086,1095,1107,1206`; `ModelDefaultsSettingsTab.tsx:55-66`; `ApiKeysSettingsTab.tsx:21,24-41` | Unhandled rejections / no feedback on rename, move, archive, restore, context save, settings save; API-keys tab spins forever if the status call fails |
| U18 | Low | CONFIRMED (trace) | `page.tsx:136-144`; `lib/storage.ts:61` | Document signed URLs (1 h TTL) are fetched once per chat open → citation / PDF preview breaks in a tab open longer than an hour |
| U19 | Low | CONFIRMED (trace) | `ChatInputArea.tsx:505,513-524` | No cancel path during `submitted`: textarea disabled and button is a disabled spinner until first byte |
| U20 | Low | PLAUSIBLE | `useFollowUps.ts:24-58`; `useChatPersistence.ts:91-93` | Follow-up chips are cancelled on image-generating turns (`setMessages` in `onFinish` re-runs the effect cleanup) |

---

### U1 — Navigating away mid-stream loses the reply and contaminates the next chat (Critical)

**Scenario.** Send a message in chat A. While it streams, click any of: sidebar "New chat", Projects, Artifacts, Images, the browser Back button, or archive the chat. The reply to A is never stored. Then type a message on Home.

**Evidence.**
- Every one of those paths sets `activeChatId` to `null` (`handleCreateStandaloneChat` `page.tsx:766`, `selectView` `:1238`, popstate `useUrlNavSync.ts:98`, `handleArchiveChat` `:1099`). None calls `stop()`.
- `useChatPersistence.ts:57` reads `activeChatIdRef.current` at completion; `:70` requires it truthy. Probe (`persistence.probe.test.ts`): with the ref nulled mid-stream, `saveMessage` call count = 0. The server does not persist assistant text, so the reply is gone.
- The chat-change effect calls `setMessages([])` (`page.tsx:601`), but the stream keeps writing: `ai/dist/index.mjs:13893-13900` — `replaceLastMessage` is false once the store is empty, so the SDK `pushMessage`s the assistant message back. The store now holds `[assistantA]` under no chat.
- First send from Home takes the deferred-create path (`page.tsx:781-805`) and sets `skipLoadOnceRef` (`:801`), so the chat-change effect skips `setMessages([])` (`:571-572`). `sendMessage` appends the user message → store is `[assistantA, userNew]`. That array is rendered in the new chat and posted to `/api/chat`, which uses the client's `messages` (`api/chat/route.ts:98,108`).
- Chat A is left with a trailing user row, so F3 then duplicates it on every reopen.

**Fix.** Capture the chat id at send time (`streamingChatIdRef`) and persist to that id in `onFinish` regardless of what is active — do not "drop when it no longer matches", which is what the F1 fix note proposes and which makes this loss permanent. Call `stop()` or keep the stream but ignore its writes when the active chat changes; clear the store in the deferred-create path before `sendMessage`.

### U2 — Project-chat refresh / deep link bounces to the project landing (High)

**Scenario.** With at least one unarchived quick chat in existence, open a project chat and press F5 (URL `?project=3&chat=12`), or paste that URL. The app lands on project 3's landing page and the URL is rewritten to `?project=3`.

**Evidence.**
- Mount effect order: `loadProjects(); loadStandaloneChats(); loadAllProjectChats()` (`page.tsx:526-528`).
- Next serialises server actions through one queue: `node_modules/next/dist/client/components/app-router-instance.js`, `dispatchAction` — a non-navigation action is appended and only started by `runRemainingActions` after the previous settles. So `getStandaloneChats` always resolves before `getAllProjectChats`, a full round-trip apart.
- When `standaloneChats` lands, the validation effect (`page.tsx:537-551`, deps `[projects, chats, standaloneChats]`) runs with `chats === []`: `allChats.length > 0` is true, chat 12 is not found → `suppressNextPush(); setActiveChatId(null)`.
- `getStandaloneChats` returns only `projectId IS NULL` rows (`actions.ts:180-184`), so a project chat is never in the first list.
- Standalone-chat deep links are unaffected (their list loads first). No e2e covers a `?chat=` URL.

Not executed (requires rendering `page.tsx` against a database); confidence rests on the two source reads above.

**Fix.** Track `chatsLoaded` / `standaloneLoaded` flags and validate only when both are true; include `archivedChats` in the lookup (ties into F2).

### U3 — Stale `activeProjectId` mis-scopes embeddings and memory suggestions (High)

**Scenario.** Open project B's landing page → sidebar Artifacts → click the source-chat chip on an artifact that belongs to project A (or to a quick chat) → chat there. Message embeddings are stored under project B, and every 6 messages the auto-memory pass files facts from A's conversation as pending suggestions on project B.

**Evidence.**
- `selectView` leaves `activeProjectId` untouched (`page.tsx:1238`); `ArtifactsView.onOpenChat` sets only view + chat (`:1306`); command palette `onSelectChat={setActiveChatId}` (`:1523`); a `?chat=N` deep link sets project `null`; `handleMoveChat` (`:1086`) never updates it. The code already documents the staleness (`:166-167`, `:243-245`) and works around it for URL and doc-scope only.
- Consumers still on the stale ref: user-message embed `projectId: activeProjectIdRef.current` (`:978`); `useChatPersistence.ts:58` → embed (`:128`) and `/api/memory/suggest` (`:150-158`); `recordPersonaUsage` (`:1168`).
- The server trusts the body: `api/embed/route.ts:46,58`, `api/memory/suggest/route.ts:43-108`.
- Probe: `activeChatIdRef=7`, `activeProjectIdRef=42` → embed body `{"messageId":900,"chatId":7,"projectId":42,…}`.
- Effect on retrieval: semantic message retrieval is project-scoped, so mis-tagged messages surface in the wrong project and are missing from their own. With project `null` (deep link) a project chat gets no memory suggestions at all.

**Fix.** Derive the project from the chat, not from nav state — ideally server-side from `chatId` in `/api/embed` and `/api/memory/suggest`; client-side use `currentChat.projectId`.

### U4 — Chat image attachments exceed the platform body limit (High)

**Scenario.** Attach a 5 MB photo (or two 2 MB photos) to a chat message on production and send.

**Evidence.**
- Client cap is 10 MB per image (`ChatInputArea.tsx:148`, `fileAttachments.ts:19`); images become base64 data URLs (`fileAttachments.ts:36`) and go inline in the `/api/chat` JSON body (`page.tsx:821-835`). Base64 adds 33 %, so anything over ~3.3 MB total exceeds Vercel's 4.5 MB request limit — the same limit the handoff documents for `/api/extract`.
- Failure surfaces as the generic chat error, auto-dismissed after 5 s (`page.tsx:367-379`).
- The user message with its data URLs stays in the `useChat` store, so every retry and every later turn in that session re-sends it and fails again until reload. Smaller images accumulate the same way across turns.
- Persistence: all of a message's images go in one `saveMessageAttachments` server action (`page.tsx:987-996`), also subject to the platform limit; failure is `console.error` only → images vanish on refresh with no warning.

Platform rejection not exercised (no deploy access from this lane); client-side numbers are from the code.

**Fix.** Upload chat images through the signed direct-to-Storage flow and send URLs, or downscale client-side and enforce a combined-size guard with a specific message; surface attachment-save failure to the user.

### U5 — Double-submit on first send creates duplicate chats (Medium)

**Scenario.** On Home or a project landing page, type a message and press Enter twice quickly (or double-click Send).

**Evidence.** `handleSendMessage` guards only on `isLoading` (`page.tsx:776`), which is still false while `createStandaloneChat` / `createChat` and `updateChatSystemPrompt` are awaited (`:785-799`). `activeChatId` in the closure is still null and `input` is cleared only after the awaits (`:827`). `handleProjectLandingCompose` has a wider window — `getProjectDefaults` + `createChat` + `updateChatSystemPrompt` in sequence (`:873-904`) — and never checks `activeChatId`. Each invocation creates a chat row and calls `sendMessage`.

**Fix.** A `sendingRef` set synchronously at entry and cleared in `finally`; clear the input before the awaits.

### U6 — Accepted memory suggestion overwritten by stale parent state (Medium)

**Scenario.** On a project landing page accept a suggested memory. Open a chat, return to the landing page, type one character in Memory.

**Evidence.** `handleAccept` updates only the rail's local state (`ProjectContextRail.tsx:87`); the parent's `projects[].memory` changes only via `handleSaveProjectContext` (`page.tsx:1206-1209`) and `loadProjects` runs once at mount. The rail is keyed by project and re-initialises from `project.memory` (`:44`), so on return it shows the pre-accept text. The next keystroke debounce-saves that stale text (`:197`, `:33-38`) through `updateProjectContext`, replacing the server value that contained the accepted fact.

**Fix.** Give the rail an `onMemoryChanged` callback that updates `projects` state after accept, or reload the project on rail mount.

### U7 — Command palette navigation is a no-op from tab views (Medium)

**Scenario.** On Projects, Artifacts or Images, press Ctrl+K and pick a chat or project. The palette closes and the same view stays on screen.

**Evidence.** `onSelectProject={handleSelectProject}`, `onSelectChat={setActiveChatId}`, `onSelectStandaloneChat={handleSelectStandaloneChat}` (`page.tsx:1522-1524`) — none sets `activeView` to `'home'`, unlike the sidebar equivalents (`:1222,1228,1229`). Render precedence puts tab views first (`:1293-1310`). The chat loads invisibly and `activeChatId` / `activeProjectId` are left set, which feeds U3.

**Fix.** Pass the `sidebarActions` variants.

### U8 — Model list cached for 5 minutes after an API-key change (Medium)

**Scenario.** Fresh setup: open the app (no models, "No models found"), add an Anthropic key in Settings → Save Keys. The picker stays empty.

**Evidence.** `GET /api/models` always returns `Cache-Control: public, max-age=300` (`route.ts:25-27`), including the empty no-key list. `onSettingsChanged={fetchModels}` (`page.tsx:1583`) calls `fetch("/api/models")` with default cache mode (`:385`), which the browser serves from HTTP cache while fresh. The server-side `clearModelRegistryCache()` cannot help.

**Fix.** `fetch('/api/models', { cache: 'no-store' })` on the settings-changed path, or drop the browser `max-age`.

### U9 — "Default System Prompt" is write-only (Medium)

**Evidence.** `default-system-prompt` appears only in `ModelDefaultsSettingsTab.tsx:42,60` across all of `src`. The UI says "Applied to new chats unless overridden by a persona or custom prompt" (`:127-130`); nothing in `page.tsx` or `/api/chat` reads it.

**Fix.** Apply it in the deferred-create paths, or remove the control.

### U10 — Attachment extraction races the send (Medium)

**Scenario.** Attach `a.txt`, then drop a large PDF and press Enter while "Extracting…" shows. The message goes without the PDF; when extraction finishes, both `a.txt` (already sent) and the PDF appear in the composer.

**Evidence.** The send button's disabled state ignores `isExtracting` (`ChatInputArea.tsx:524`). `processFiles` awaits `/api/extract` and then calls `onFilesChange([...attachedFiles, ...results])` with the `attachedFiles` captured before the await (`:214`). State lives in `page.tsx`, so the late result also lands after a chat switch. Same closure is the cause of prior F18.

**Fix.** Functional update (`setAttachedFiles(prev => [...prev, ...results])`), and disable send while extracting.

### U11 — Unsupported image types accepted for chat (Medium, PLAUSIBLE)

**Evidence.** `IMAGE_MIME_TYPES` includes `image/avif`, `image/heic`, `image/svg+xml` (`fileAttachments.ts:14-17`); the picker accepts `image/*` (`ChatInputArea.tsx:411`). `/api/chat` does no media-type filtering, and `@ai-sdk/anthropic` forwards any `image/*` media type unchanged (`dist/index.mjs:2342-2350`). Anthropic documents JPEG/PNG/GIF/WebP only. The attachment is persisted and reloaded as a file part (`page.tsx:494-502`), so the chat would keep failing after refresh. Provider rejection not exercised.

**Fix.** Restrict to the four supported types client-side (convert or reject the rest).

### U12 — Upload / ingest failures are misreported (Medium)

**Evidence.**
- `useDocumentUpload.ts:16,28,43,55` and `useWebIngest.ts:16,25` do `(await res.json()).error` on a non-OK response. A platform 504 from the long-running `/api/documents/process`, a 413, or an HTML auth page makes `json()` throw, and callers toast `e.message` — "Unexpected token '<'…".
- Document delete: `if (res.ok) {…}` with no else (`ProjectContextRail.tsx:122-127`, `ProjectDocumentsDialog.tsx:90-99`) — a failed delete does nothing visible.
- `AddFromWebDialog.tsx:39` toasts `Failed: <url>` and discards `r.error`, so "no Tavily key" (503) and "empty page" (422) look identical in single-page mode.
- `ProjectContextRail.handleFiles` silently ignores files dropped while another upload runs (`:104`).
- After a processing timeout the document stays `processing` with a spinner; nothing polls.

**Fix.** A shared `readError(res)` helper (`res.json().catch(() => null)` then status-based fallback); add the else branches.

### U13–U20 (Low)

- **U13.** The rail's empty-state button opens `ProjectDocumentsDialog` (`ProjectContextRail.tsx:289` → `page.tsx:1457`); an upload there never refreshes the rail's own `documents` (loaded on mount only, `:60-66`). `projectFileCounts` is loaded once (`page.tsx:412-414`).
- **U14.** `handleConfirmDeleteProject` filters `projects` only (`page.tsx:1013`); cascaded chats stay in `chats`, are listed under "Project Chats" in the palette, and pass the validator.
- **U15.** `onKeyDown` on the `role="button"` row (`ProjectLandingPage.tsx:173-175`) receives keydown from the nested `ChatContextMenu` trigger and, through React's portal bubbling, from its menu items; `ChatContextMenu.tsx:90` stops click propagation only. Radix internals not executed.
- **U16.** `openInEdit` stays true after `handleNew` (`ArtifactsView.tsx:62`), so `initialMode` remains `'edit'` and the reset effect (`ArtifactWorkspace.tsx:53`) re-applies it on every `artifact.content` change. `createBlankArtifact` also creates a host quick chat (`actions.ts:983`) that page state never learns about, so its header reads "Select a Chat" and it is absent from Recents until reload.
- **U17.** Listed handlers have no `try/catch`; dialogs close before the action resolves. `ModelDefaultsSettingsTab.handleSave` gives no success or failure feedback. `ApiKeysSettingsTab.tsx:21` has no `.catch`.
- **U18.** `DOCUMENT_URL_TTL_SECONDS = 3600` (`storage.ts:61`, used at `api/documents/route.ts:20-21`); `projectDocuments` is fetched only when the chat's project changes.
- **U19.** `canStop` is true only while `streaming`; during `submitted` there is no cancel and the textarea is disabled.
- **U20.** The follow-ups effect depends on `[status, messages]`; `onFinish` calls `setMessages` after image tool output, which runs the cleanup and sets `cancelled`. Timing-dependent; not reproduced.
- **Also noted:** Escape in the composer wipes the whole draft with no undo (`page.tsx:851-853,946-948`); `ArtifactGalleryCard` "open chat" for an archived chat is nulled by the validator; `ImagesView` prepends a newly generated image regardless of the active filter and maps every 503 to "Set a Gemini API key" (`:74-78`), including "storage not configured".

---

## Prior findings re-verified

| Item | Status | Evidence |
|---|---|---|
| **F1** wrong-chat write (Critical) | **STILL OPEN** | No `stop()` in the chat-change effect (`page.tsx:565-606`); `useChatPersistence.ts:57` still resolves the chat at completion. Probe: `saveMessage(2,"assistant","answer for chat 1")`. See U1 for the unrecorded consequences and a caution on the proposed fix. |
| **F2** archived chats unreachable (High) | **STILL OPEN** (planned) | `Sidebar.tsx:18` declares `archivedChats`, never destructures it; no caller passes `variant="archived"`; `currentChat` (`page.tsx:125-127`) and the validator (`:539`) ignore `archivedChats`. Dead `createChat` still wired (`page.tsx:1225`, `types.ts:28`) with no caller of `actions.createChat`. Matches the fix plan; nothing implemented yet. |
| **F3** duplicate re-save (High) | **STILL OPEN** | `page.tsx:958-1002` guards only on `lastSavedMessageIdRef`; DB-loaded ids never match. Now also triggered by every reply dropped via U1. |
| **F4** `useLocalStorage` writes initial over stored (High) | **MOSTLY FIXED** | Probe: mounting over stored `700` with initial `448` still writes `448` then `700` (two `setItem`s plus two broadcasts). The mounted-sibling reset no longer produces a visible intermediate render in the probe. Residual is Low. CLAUDE.md's "initial values are never persisted until the first real `set`" holds only for an empty bucket. |
| **F5** raw `-400/-500` colours | **STILL OPEN** | 42 raw colour classes, 9 `dark:` classes (grep). Not re-measured for contrast. |
| **F6** error banner only in chat branch (High) | **STILL OPEN** | Banner at `page.tsx:1321-1330` inside the `activeChatId` branch; `setError` at `:402,406,417,427,437,447,693,808,913` fire on Home / landing with nothing rendering them. 5-second auto-dismiss (`:374-379`, prior C9) also unchanged. |
| **F7** hover-only controls, no focus reveal | **STILL OPEN** | 8 `opacity-0` hover-reveal sites; `focus-visible` appears once app-wide. |
| **F8** `isApplyingPopRef` stuck | **STILL OPEN** | `useUrlNavSync.ts:109` returns before clearing the flag. Probe: after a no-op popstate, navigating to Projects yields 0 pushes, 0 replaces, address bar still `?chat=5`. |
| **F9** phantom history entry on `?chat=N` | **STILL OPEN** | Probe: `pushState("/?project=3&chat=5")` once the project resolves. |
| **F10** palette Escape / dialog semantics | **STILL OPEN** | No Escape handler in `CommandPalette.tsx` or `page.tsx:667-676`; plain `div`, no role or focus trap. |
| **F11** click-only rows / cards | **STILL OPEN** | `ChatItem.tsx:57-58`, `DocumentCard.tsx:24-26`, `ArtifactGalleryCard.tsx:29-30`, `ImageCard.tsx:27-29` are `div onClick` with no role / tabIndex. |
| **F12** dialogs lacking `Description` | **STILL OPEN** | 3 of 9 `Dialog.Root` files use `Dialog.Description`. |
| **F13** localStorage write per `pointermove` | **STILL OPEN** | `ArtifactWorkspace.tsx:33-35`, `ProjectContextRail.tsx:148-149`. |
| **F14** `reconstructChunks` O(chunks×500) | **STILL OPEN** | `DocumentPreviewDialog.tsx:198-215` unchanged. |
| **F15** mobile sidebar over hamburger | **STILL OPEN by code** | Classes unchanged at `page.tsx:1258-1283` (sidebar `z-30`, hamburger `z-20`). Not re-tested in a browser. |
| **F16** `HomeGreeting` hydration mismatch | **STILL OPEN** | `new Date().getHours()` in render (`HomeGreeting.tsx:8`). |
| **F17** Images filter row disappears | **STILL OPEN** | `ImagesView.tsx:236` renders the row only when `loading || images.length > 0`; an empty project filter leaves no way back to "All". |
| **F18** concurrent drops clobber attachments | **STILL OPEN** | `ChatInputArea.tsx:178,214`; broader form in U10. |
| **F19** `ArtifactThumbnail` cross-origin PDF iframe | **STILL OPEN** | `ArtifactThumbnail.tsx:67-69` uses `downloadUrl`; `DocumentPreviewDialog.tsx:163` does the same for document PDFs. |
| **F20** fetch effects without cancellation | **STILL OPEN** | `ChatInputArea.tsx:139-142`, `DocumentPreviewDialog.tsx:47-56`, `ProjectContextRail.tsx:60-78`, `ProjectDocumentsDialog.tsx:35-54`. `ImagesView.tsx:50-57` is safe in practice because server actions are serialised. |
| **PDF chat-attachment failure** (handoff item 3) | **STILL OPEN** | `ChatInputArea.tsx:192-209`: no size guard; `res.json()` on a non-JSON error throws into the generic toast. U4 is the same root cause for images. |
| Low: `SheetsPreview` throws on malformed sheets | STILL OPEN | `ArtifactPreview.tsx:43-45` (`row.map` on a non-array row; null sheet). Reaches `app/error.tsx`. |
| Low: gallery dropdowns close only on mouse-leave | STILL OPEN | `ArtifactsView.tsx:79,94`. |
| Low: `ArtifactWorkspace` reset / stale versions / `pointercancel` | STILL OPEN | `:53`; `loadVersions` not re-run after `restore` (`:55-58,87-91`); only `pointerup` removes listeners (`:36-43`). |
| Low: stale `default-model` survives Save; name-prefix family detection | STILL OPEN | `ModelDefaultsSettingsTab.tsx:59` skips the write when empty; `:91-92` use `startsWith('claude')` / `includes('image')`. |
| Low: `ProjectDocumentsDialog` uploads first file only | STILL OPEN | `:77,86`. |
| Low: `PROJECT_CAPACITY_BYTES` read client-side | STILL OPEN | `lib/projectCapacity.ts` reads a non-`NEXT_PUBLIC` env var; always 2 GB in the browser. |
| Low: `global-error.tsx` cool-palette hex | STILL OPEN | `#6F7781`, `#4F7396` at `:13,18`. |
| Low: dead props | STILL OPEN | `Sidebar.activeProjectId`, `MessagesList.onDeleteMessage`, `MessageActions.onRegenerate`, `SmartChatMenu` `expanded` branch — no callers. |
| Low: composer disabled while streaming | STILL OPEN | `ChatInputArea.tsx:505`. |
| Low: `Lightbox` scroll lock / focus | STILL OPEN | `Lightbox.tsx` has an Escape handler only. |
| Low: no loading state for projects / chats | NOT RE-VERIFIED | Not examined this pass. |

## Checked and clean

- **Refs-for-closures on the transport body** (`page.tsx:253-262`): model, chat id, effort, grounded and excluded-doc ids are all read through refs updated every render; the deferred-create paths set `activeChatIdRef.current` synchronously before `sendMessage` (`:792,803,909`).
- **`loadMessages` staleness guards** (`:466,482`) and the `messagesLoading` stale-finish guard (`:590`); `getChatWithContext` stale-resolve guard (`:598`).
- **`skipLoadOnceRef`** correctly prevents the empty-DB snapshot clobbering a just-created chat (it is the missing clear, not the skip, that causes U1).
- **Assistant-save dedup** (`useChatPersistence.ts:73-74`) and the existing 14 hook tests' assertions.
- **`useDialogs`**: targets are read synchronously before the first `await` in every confirm handler, so the dialog clearing its target on close does not lose it.
- **`useLocalStorage`** key-change handling, validator, in-tab sync loop terminator; `useDocScope` never writes under `'none'`.
- **`useGroundedCompose`** pick-wins precedence; grounded reset on chat open.
- **`useAutoCollapseSidebar`** restore-on-unmount.
- **`navState.ts`** parse / serialise round-trip; `useUrlNavSync` mount restore and `suppressNextPush` replace path.
- **`chatStage.ts`**, **`remarkCitations.ts`**, **`CitationChip`** page clamping; **`ToolProgressCard`** stalled state and signed-URL dedup by pathname.
- **`CodeBlock` / `CodePreview`** highlight effects cancel correctly.
- **`UsageSettingsTab`** loading / error / empty states are distinct and cancel on unmount.
- **Login page**: error and loading states always resolve; `next` re-validated.
- **Generated-image and artifact reload**: image tool outputs are linked via `saveGeneratedImage` and rebuilt as file parts; artifacts refetch on chat open and after artifact turns.
- **ESLint**: 0 errors, 25 warnings, none indicating a defect beyond those above.

## Probe artefacts

`C:\tmp\audit-2026-11-12\frontend-scratch\`: `vitest.probe.config.mjs`, `persistence.probe.test.ts` (F1, U1 drop, U3 embed), `navsync.probe.test.ts` (F8, F9), `localStorage.probe.test.tsx` (F4). Run from PowerShell after `Set-Location 'C:\dev\atelier_ai_gpt'`: `npx vitest run --config 'C:\tmp\audit-2026-11-12\frontend-scratch\vitest.probe.config.mjs' --disable-console-intercept`. The probes print observations (`PROBE …` lines) rather than assert the buggy behaviour, so they pass either way — read the output.
