# Atelier Studio — Dead code, staleness & docs-accuracy lane

Audit of `C:\dev\atelier_ai_gpt` at `master` / `b64850c` (v4.55.1), 2026-11-12. Read-only: nothing in the repo was edited, no app/DB/external call was made. Tool scratch lives in `C:\tmp\audit-2026-11-12\dead-scratch\`.

## Summary

The codebase is clean at the line level (0 TODO/FIXME/HACK, 0 `.only`/`.skip`, 0 SQLite/PRAGMA/Ollama references in `src/`, `tsc --noUnusedLocals --noUnusedParameters` finds only 5 unused symbols in `src/`, lint is exactly the documented 25 warnings). The staleness is at the feature level: the v4.51.0 sidebar decomposition removed the only entry points to several features and left their back halves in place. The per-project defaults dialog is unreachable, message delete/regenerate menu items can never render, `/api/classify` has no caller, the "Default system prompt" setting is written and never read, and seven `SidebarActions` members have no consumer. Docs are the weaker half: `README.md` is still about 20 releases stale and points at an obsolete handoff, and most of the 2026-09-01 audit's doc-vs-code table is still open because the 2026-11-12 CLAUDE.md split moved the text "word for word" into `docs/architecture/` without correcting it. Repo clutter is small but real: a tracked Ollama-era `sqlite.db`, five unused create-next-app SVGs, two throwaway scripts, and 33 dated handoff/chatlog files in `docs/`.

Method: `npx knip` (36 candidates), a custom export scan (every `export` in `src/` grepped for non-comment references outside its own file), `tsc --noEmit --incremental false --noUnusedLocals --noUnusedParameters`, `npm run lint`, and targeted greps. Each item below was checked by grep; "CONFIRMED" means I saw the absence/contradiction directly, "PLAUSIBLE" means it depends on something I could not observe (live catalog, runtime).

Counts: D 27 · P 6 · C 14 · K 31 · T 7 · R 9 · prior findings re-verified 38 (5 fixed, 32 still open, 1 not re-verified).

---

## D — Dead code

### D-A. Unreachable features (highest value)

| # | Location | What | Evidence | Delete? |
|---|---|---|---|---|
| D1 | `src/components/ui/ProjectDefaultsDialog.tsx` (174 lines); `src/app/page.tsx:1179-1184`, `:1593-1600`; `useDialogs.ts` `projectDefaults` controller; `actions.ts` `updateProjectDefaults` | **Per-project default persona/model dialog is unreachable.** Its only opener is `handleOpenProjectSettings`, which is exposed only as `sidebarActions.openProjectSettings` (`page.tsx:1224`). No component reads that member. | `grep -rn "openProjectSettings" src` → `page.tsx:1224` (assignment) and `sidebar/types.ts:26` (type) only. `dialogs.projectDefaults.open(` has one call site, inside that handler. `ProjectsView`, `ProjectLandingPage`, `ChatHeader`, `ProjectContextRail`, `CommandPalette` have no settings prop. `updateProjectDefaults` is called only from the dialog. | **N — re-wire, don't delete.** This is a lost feature, not junk: `getProjectDefaults` is still read on chat create (`page.tsx:720`, `:873`) and by `useSmartDefaults`, so existing defaults still apply but can no longer be changed. `docs/PERSONAS.md` documents the entry point as live (see K21). CONFIRMED. |
| D2 | `src/components/chat/MessageActions.tsx:11-12, 65-95`; `MessagesList.tsx:41, 359, 527`; `actions.ts:214` `deleteMessage` | **Message "Delete" and "Regenerate" menu items can never render.** `MessagesList` forwards `onDelete` only if it received `onDeleteMessage`; `page.tsx:1339-1351` never passes it. `onRegenerate` is never passed by anyone. | `grep -rn "onDeleteMessage\|onRegenerate" src` → only the declarations and the one forwarding line. `deleteMessage` has 0 `src` callers (test-only: `tests/unit/actions/messages.test.ts`). | Y for the dead props/branches, or wire them up. `deleteMessage` also carries Storage-cleanup logic that is therefore untested in the real flow. CONFIRMED. |
| D3 | `src/app/api/classify/route.ts` (105 lines); `actions.ts:553-563` `saveChatTopics`/`getChatTopics`; `validation.ts:64` `classifyRequestSchema`; `schema.ts:195` `chat_topics` table; `tests/unit/api/classify-route.test.ts` | **`POST /api/classify` has no caller.** Persona suggestions use the local keyword matcher (`useSmartDefaults` → `detectTopicsFromMessages`), not this route. | `grep -rn "/classify" src` outside the route → comments only. `saveChatTopics`/`getChatTopics` are imported only by the route. | Y for route + two actions + schema + test. **N for the table without a migration**, and `'classify'` must stay in `usage_events_purpose_chk`/`UsagePurpose` while historical rows exist. CONFIRMED. |
| D4 | `src/components/settings/ModelDefaultsSettingsTab.tsx:20, 41, 60` | **"Default system prompt" setting is write-only.** The tab loads and saves `default-system-prompt`; nothing else reads it. | `grep -rn "default-system-prompt\|defaultSystemPrompt" src tests e2e` → that file only. (`default-model` by contrast is read at `page.tsx:392`.) | Y (remove the field) or wire it into new-chat creation. The user can type a default prompt today and it silently does nothing. CONFIRMED. |
| D5 | `src/components/chat/sidebar/types.ts:21-28`; `page.tsx:1219-1225` | **Seven `SidebarActions` members have no consumer:** `createProject`, `renameProject`, `deleteProject`, `selectProject`, `openProjectDocuments`, `openProjectSettings`, `createChat`. | For each, `grep -rnE "actions\.<name>\b" src/components` → 0 hits. Consumers were the section components deleted in v4.51.0. Only `createChat` is covered by `docs/plans/2026-11-12-sidebar-review-fixes.md` Task 1. | Y — with them goes `handleCreateChat` (`page.tsx:748`, referenced only at `:1225`) and `handleOpenProjectSettings` (see D1 first). CONFIRMED. |
| D6 | `src/components/chat/sidebar/Sidebar.tsx:14, 18`; `RecentsSection.tsx:28`; `ChatItem.tsx:15, 29, 36-37` | **Dead sidebar props/variants.** `SidebarProps.activeProjectId` and `archivedChats` are declared and passed (`page.tsx:1269`) but never destructured. `RecentsSection` computes `variant='project'` for chats the parent already filtered to `projectId === null`, so `ChatItem`'s `'project'` and `'archived'` branches never run. | `Sidebar.tsx:23-30` destructures 6 of 8 props; `:43` filters `c.projectId === null`. Only one `<ChatItem` exists (`RecentsSection.tsx:23`). | Hold until the sidebar plan lands: its Task 3 re-adds an archived section and will use `archivedChats`/`'archived'`. `activeProjectId` and the `'project'` variant are deletable now. CONFIRMED. |
| D7 | `src/components/chat/MessagesList.tsx:387-404` | **"No Chat Selected" empty state is unreachable**, and its copy is stale ("Create a new project and chat to start…"; sending a message auto-creates a quick chat). | `MessagesList` renders only inside `activeChatId ? (…)` (`page.tsx:1310`, `:1339`). | Y. CONFIRMED. |
| D8 | `src/lib/providers.ts:68-69` | **Google Search grounding branch output is never used.** Gemini text callers (`generate-title`, `summarize`, `suggest-followups`) destructure only `{ model }`; `/api/chat` cannot reach this branch because `resolveRequestedModel` falls back for `gemini-3.5-flash` (not in the registry). | `grep -rn "createProvider(" src` → 4 call sites; only `chat/route.ts:105` reads `tools`. `grep -rn "google_search" src` → this line and one comment. | Y (return `{ model }`). Also retires three CLAUDE.md gotchas (K10). CONFIRMED. |

### D-B. Unused files

| # | Location | Evidence | Delete? |
|---|---|---|---|
| D9 | `tests/global-setup.ts` | Not referenced by `vitest.config.ts` (no `globalSetup`); body is a no-op; comment says "in-memory SQLite". | Y. CONFIRMED. |
| D10 | `tests/helpers/mock-ai.ts` | `grep -rn "mock-ai" tests` → 0. Three exported factories, none imported. | Y. CONFIRMED. |
| D11 | `scripts/spike-vision-extract.mjs` | Header: "THROWAWAY… Delete this file once C2's approach is chosen" (C2 shipped 2026-06). Defaults to `gemini-3.1-pro-preview`. | Y. CONFIRMED. |
| D12 | `scripts/smoke-c2-render.mjs` | Header: "Throwaway… Mirrors `src/lib/visionExtraction.ts` exactly (unpdf legacy + @napi-rs/canvas scale 3)". That path was replaced by native-PDF segments in v4.45.0, so it mirrors nothing. Tracked despite `.gitignore:59` (`/scripts/smoke-*.mjs`). | Y (`git rm`). CONFIRMED. |
| D13 | `public/file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg` | create-next-app leftovers. `grep -rn "<name>.svg" src e2e README.md` → 0 for each (`logo.svg` is used). | Y. CONFIRMED. |

### D-C. Unused exports and symbols

Zero references anywhere (src or tests):

| # | Location | Symbol | Note |
|---|---|---|---|
| D14 | `src/components/chat/LoadingSkeletons.tsx:27, 40` | `ChatListSkeleton`, `ProjectListSkeleton` | Delete. |
| D15 | `src/lib/fileExtraction.ts:32` | `isImageExtension` | Delete (`isImageUpload` is the live one). |
| D16 | `src/lib/motion.ts:17, 19, 40, 43` | `baseTransition`, `fadeRise`, `MENU_CONTENT_ANIM`, re-export `useReducedMotion` | Delete. The file's header says "Components import from here instead of hard-coding values", but only `viewVariants`, `staggerDelay`, and the two `DIALOG_*` strings are imported; e.g. `MessagesList.tsx:391-393` hard-codes its own fade/rise. |
| D17 | `src/hooks/usePersonas.ts:491, 514` | `updatePersona` (returned by `usePersonas()`) | 0 consumers in src or tests; there is no custom-persona edit UI. |
| D18 | `src/lib/fileAttachments.ts:176-177` | `export { formatFileSize }` "for backward compatibility" | Every importer uses `@/lib/fileUtils` directly. |
| D19 | `src/app/globals.css:76-78, ~103-105` | `--surface-raised`, `--surface-sunken`, `--surface-divider` (light + dark) | 0 uses outside their own definitions. |
| D20 | `src/app/globals.css:132` | `--color-ink` | `text-ink`/`bg-ink` have 0 uses; the comment three lines above says "dead exports pruned". |
| D21 | `src/components/settings/ModelDefaultsSettingsTab.tsx:6, 26`; `ui/ProjectDefaultsDialog.tsx:7, 9`; `lib/artifacts/render.ts:18`; `lib/visionExtraction.ts:163` | Unused `Persona` import ×2, `customPersonas`, `cn`; unused params `title` (`renderArtifact`) and `_mimeType` (`extractViaVisionImage`) | From `tsc --noUnusedLocals --noUnusedParameters` + lint. The two params are part of signatures callers pass; removing them touches call sites. |

Used only by tests (0 `src` callers; decide whether the test justifies the code):

| # | Location | Symbol |
|---|---|---|
| D22 | `src/lib/models/registry.ts:303` | `resolveTier()` — tests only (`registry.test.ts`, `usePersonas.test.tsx`). Tier resolution is client-side. CLAUDE.md and `model-registry.md` describe it as a live server path and a landmine. |
| D23 | `src/app/actions.ts:133, 301` | `getChats(projectId)`, `getSettings(keys)` — tests only. (`deleteMessage` is under D2.) |
| D24 | `src/lib/topicDetection.ts:68` | `detectTopics` is exported but used only by `detectTopicsFromMessages` in the same file — un-export. |

Needlessly exported (used only inside their own file; un-export, don't delete): `MESSAGES_TO_KEEP`, `artifactSlug`, `MODEL_TIERS`, `DUR`, `EASE_OUT`, `STAGGER`, `STAGGER_CAP`, `LOGIN_WINDOW_MS`, `uiMessageSchema`, `SUPPORTED_EXTENSIONS`, `IMAGE_EXTENSIONS`, `TEXT_MIME_PREFIXES`, and types `OnOpenCitation`, `CitationChipProps`, `UseChatPersistenceOpts`, `Simple/Toggle/TargetDialogController`, `Dialogs`, `UrlNavSync`, `CodeLanguage`, `BlankTemplate`, `DocWindow`, `EmbeddingProvider`, `GeneratedImageOutput`, `KeywordChunk`, `ModelRegistry`, `NavTab`, `ProviderResult`, `RagConfig`, `RecordUsageArgs`, `DocumentStatus`, `SidebarProps` (re-export in `sidebar/index.ts:2`), `Project`/`Chat` (re-export in `sidebar/index.ts:3`). Counted as one item (D25).

### D-D. Vestigial wire fields and columns

| # | Location | What | Status |
|---|---|---|---|
| D26 | `useSummarization.ts:40`, `useChatTitle.ts:44`; `validation.ts:36-47` | Clients still send `model` to `/api/summarize` and `/api/generate-title`; the routes ignore it (the schema comments say so). `useSummarization(selectedModelRef)` and `useChatTitle({ modelRef })` exist only to feed the ignored field. Also `GET /api/models` emits `digest` "for back-compat with existing clients" (`models/route.ts:14-18`) — an Ollama-era field whose only use is a React `key` in `CommandPalette.tsx:115`. | CONFIRMED. Safe to remove both ends together. |
| D27 | `src/db/schema.ts:134-135` `artifacts.status` / `error_message` | `createArtifact` accepts them but its only caller (`lib/artifacts/tool.ts:47`) never passes either, so every row is `'ready'`/`null`; the failure path returns a tool error and writes no row. `status` is selected in `getAllArtifacts` (`actions.ts:950`). | PLAUSIBLE vestigial (I did not trace every reader of `ArtifactSummary.status`). Needs a migration to drop; low priority. |

---

## P — Dependencies

| # | Item | Evidence | Verdict |
|---|---|---|---|
| P1 | `npm run test:coverage` is broken | Script is `vitest run --coverage`; `node_modules/@vitest/` contains `expect, pretty-format, runner, snapshot, spy, utils` — no `coverage-v8`/`coverage-istanbul`, and neither is in `package.json`. | CONFIRMED. Add `@vitest/coverage-v8` or drop the script. |
| P2 | `dotenv` (runtime dep) | Only `src` use is `import 'dotenv/config'` in `src/db/index.ts:1`. That loads `.env`, not `.env.local`; Next already loads env files at runtime and `drizzle.config.ts` does not import dotenv at all. Other uses are the gitignored smoke scripts. | PLAUSIBLE unnecessary at runtime (I did not run without it). If kept for scripts it is a devDependency. |
| P3 | `tailwindcss-animate`, `@tailwindcss/typography` in `dependencies` | Both are build-time Tailwind plugins (`globals.css:3-4` `@plugin`), while `tailwindcss` and `@tailwindcss/postcss` sit in `devDependencies`. | CONFIRMED inconsistency; harmless on Vercel, but pick one side. |
| P4 | No unused dependency | Every `dependencies`/`devDependencies` entry has at least one importer in `src`, config, or tests (table in scratch output). `@types/mdast` is type-only via `remarkCitations.ts:11`. `@tailwindcss/postcss` via `postcss.config.mjs`; `jsdom` via per-file `@vitest-environment`. | CONFIRMED clean. |
| P5 | Prior K1 (four undeclared packages) | `@shikijs/langs`, `@shikijs/themes`, `unist-util-visit`, `@types/mdast` are now declared. | FIXED. |
| P6 | No `.nvmrc` / `packageManager`; `engines.node >=22` vs README "v24 LTS" | `package.json:6`, `README.md` Prerequisites. The handoff requires the lockfile to stay valid for npm 10 and 11, but nothing pins either. | CONFIRMED (carried from prior audit). |

Not re-run in this lane: `npm outdated` / `npm audit` (the handoff already lists `next@16.3.8` and `axios` as the open security bump).

---

## C — Stale comments and TODOs

No TODO/FIXME/HACK/XXX anywhere in `src`, `tests`, `e2e`, `scripts`, or root configs. No SQLite/PRAGMA/Ollama/Qwen/`createDocument`/`budget_tokens`/`maxTokens`/`bg-gradient-to`/`middleware.ts` references in `src`. The stale comments are:

| # | Location | Comment says | Reality |
|---|---|---|---|
| C1 | `tests/global-setup.ts:2` | "Using in-memory SQLite per test" | PGlite; file is dead (D9). The last SQLite mention in code. |
| C2 | `src/lib/models/seed.ts:5-6` | Seed "mirrors today's hardcoded list … in `src/app/api/models/route.ts`" | That route has had no hardcoded list since the registry shipped. |
| C3 | `src/lib/models/seed.ts:69-70` | Haiku: "see providers.ts's existing special case" | `providers.ts` has no Haiku special case; effort is gated by `effortLevels` only. |
| C4 | `src/components/chat/ArtifactPreview.tsx:62` | "pdf → exact signed-URL iframe" | Line 86 iframes the same-origin proxy `/api/artifacts/:id/raw`; lines 81-83 explain why the signed URL is not used. |
| C5 | `src/components/chat/MessagesList.tsx:48-52` | `documentsById` / `onOpenCitation` "default to empty / a no-op until page.tsx threads the real map / wires the real handler" | `page.tsx:1348-1349` passes both. |
| C6 | `src/lib/image/tool.ts:8-12` | Descriptor is `{ storagePath, url, mediaType, filename }` | Returns `embedUrl` and `fileSize` too (line 39); `embedUrl` is the one HTML artifacts must use. |
| C7 | `next.config.ts:46-48` vs `:41-43` and `chat/route.ts:39` | `frame-src … youtube-nocookie.com`: "HTML artifacts … may embed videos via the privacy-enhanced player" | The `img-src` comment above it and `TOOL_GUIDANCE` both say embedded players cannot work in the sandbox ("NEVER use `<iframe>` YouTube embeds"). The CSP allowance and its comment are leftovers from the abandoned approach. |
| C8 | `src/app/api/chat/route.ts:115` | "provider tools (web_search for Claude, google_search for Gemini…)" | The Gemini-text branch is unreachable from this route (D8). |
| C9 | `src/lib/providers.ts:68` | "Internal Gemini text (title/summarize utility): Google Search grounding" | No caller uses the tool (D8). |
| C10 | `src/hooks/useSummarization.ts:21-22` | Model ref "is forwarded for routing parity" | Server ignores it (D26). |
| C11 | `src/lib/motion.ts:1-3` | "single source of truth… Components import from here instead of hard-coding values" | Most motion values are still hard-coded per component (D16). |
| C12 | `src/app/globals.css:129-131` | "Only the utilities actually used in components are exported (dead exports pruned)" | `--color-ink` is exported and unused (D20). |
| C13 | `src/lib/validation.ts:29-30` | `excludedDocumentIds` scopes "per chat" | Scope is per project (`useDocScope`, key `project-doc-scope-<id>`); `rag-pipeline.md` says per-chat is a follow-up. |
| C14 | `src/lib/models/registry.ts:16` | "Mirrors the TTL pattern in `src/lib/settings.ts:5-40`" | Hard-coded line range in a comment; already drifts with any edit to `settings.ts`. |

Stale data rather than comments (PLAUSIBLE — depends on the live catalog, which I did not query): `EXACT_PRICING` (`pricing.ts:11-21`), `STATIC_SEED` (`seed.ts`) and `MODEL_SHORT_LABELS` (`usePersonas.ts:129-134`) list Opus 4.8 / Sonnet 5 / Haiku 4.5, while `docs/PERSONAS.md` and the handoff say the live picker now serves Opus 5 and Sonnet 5.5 and quote Haiku 5.5 at $0.10/$0.50. If so, every current-model row is priced from `FAMILY_TIER_PRICING` with `cost_estimated: true`, and a Haiku 5.5 row would be costed at the 4.5 tier ($1/$5). Flagged for the cost lane.

---

## K — Docs claims that are wrong

Format: claim → correct value (evidence).

### README.md (stale since roughly v4.35)

| # | Claim | Correct |
|---|---|---|
| K1 | Docs link "Session Handoff → `docs/SESSION_HANDOFF.md`" (`:118`) | That file is the undated v4.35-era pointer ("276 tests", "28 commits ahead", "D2 next"). Current is `docs/SESSION_HANDOFF_2026-11-12.md`. `PLAN.md:16` has the same link. |
| K2 | Claude models "Opus 4.8 default, Sonnet 4.6, Haiku 4.5" (`:10`, `:16`) | Live registry, one newest per family incl. Fable; Sonnet 4.6 is a legacy pin only (`seed.ts:87`). |
| K3 | "Node.js: v24 LTS" | `engines.node >=22`, CI Node 22. |
| K4 | "215 unit/integration tests" | 143 test files, ~999 tests (handoff; 975 `it(` literals + `it.each`). |
| K5 | "Atelier Technologies brand system" (Tech Stack) | Warm-minimal re-theme, v4.30.0 (the same README says so under Customization). |
| K6 | Vision: "thin/empty-text PDFs fall back to per-page vision rendering" | Native-PDF page-range segments since v4.45.0, plus per-page hybrid splice (`visionExtraction.ts`, `process/route.ts:22-25`). |
| K7 | Retrieval: "query-rewrite → vector top-N → MMR → rerank" | Missing the keyword leg + RRF fusion (`retrieval.ts`, `keywordSearch.ts`, `rrf.ts`). |
| K8 | Artifacts tech line lists `exceljs`, `docx`, `pdf-lib` | Also `pptxgenjs`; code artifacts exist (`artifacts/code.ts`). |
| K9 | Silent on shipped features | Access gate, grounded/cited answers, web ingestion (Tavily + `TAVILY_API_KEY`), code artifacts, Images studio, Usage tab, `read_document`. Setup block omits `APP_ACCESS_PASSWORD`, `AUTH_SECRET`, `TAVILY_API_KEY`. |

### CLAUDE.md (HEAD, 213 lines)

| # | Claim | Correct |
|---|---|---|
| K10 | Gotchas 3, 6, 8 (`:168`, `:171`, `:173`) and Provider Routing `:139`: internal Gemini text uses Google Search grounding; tool must be named `google_search`; dedupe Google `source-url` parts | No model call ever receives the Google Search tool (D8). `sendSources`/dedup still matter, but for Claude web search. |
| K11 | "`.glass-panel` … retained (16 consumers)" (`:127`) | 21 `.tsx` files, 25 occurrences. |
| K12 | "There is no backdrop-blur … anywhere in the system" (`:127`) | 11 `backdrop-blur-sm` sites (9 dialog overlays, `CommandPalette.tsx:55`, `Lightbox.tsx:33`, `ChatInputArea.tsx:333`). `multimodal-artifacts.md` itself says the lightbox uses "backdrop blur". |
| K13 | Direct brand utilities "`text-ink`, `bg-warm-sand`, `text-stone-sage`, `text-success`, `text-warning` (these are the only ones in use)" (`:124`) | `text-ink` has 0 uses; the other four have 1/1/5/1. |
| K14 | "All POST API routes validate request bodies with Zod schemas" (`:69`, `:142`) | `POST /api/extract` parses `formData` and uses `validateUploadedFile` (`extract/route.ts:7-18`). |
| K15 | Security headers list (`:73`) | Omits `connect-src 'self' https:`, `object-src 'self'`, `Referrer-Policy`, `X-DNS-Prefetch-Control`, and the `i.ytimg.com` / `youtube-nocookie.com` allowances (`next.config.ts:36-70`). |
| K16 | "HTML artifact previews stay sandboxed (`sandbox="allow-scripts"`…)" (`:162`) | `ArtifactPreview.tsx:74`: `allow-scripts allow-popups allow-popups-to-escape-sandbox`. Still no `allow-same-origin`, so the security point holds. |
| K17 | "PDF previews iframe the same-origin proxy … never the cross-origin Supabase signed URL" (`:161`) | True for `ArtifactPreview`; `ArtifactThumbnail.tsx:67-69` iframes `artifact.downloadUrl` (signed, cross-origin); `DocumentPreviewDialog` also iframes the signed `url` (as `source-map.md` states). |
| K18 | E2E: "Textarea is always enabled" (`:199`) | `ChatInputArea.tsx:505` `disabled={isLoading}`. |
| K19 | "Session logs in `docs/chatlog-*.md`. Update before compacting…" (`:213`) | Convention abandoned: newest chatlog is 2026-06-17; 21 `SESSION_HANDOFF_*` files replaced it. |
| K20 | Tailwind `@source not` list (`:106`) | Also excludes `CHANGELOG.md` (`globals.css:19`). `rag-pipeline.md`'s copy of the list omits both `CLAUDE.md` and `CHANGELOG.md`. |
| — | "The two AI keys can also be configured … Settings → API Keys" (`:50`) | Three keys (Tavily too; the env block above says so). Minor. |

### docs/PERSONAS.md

| # | Claim | Correct |
|---|---|---|
| K21 | "Per project: … default persona and model (project header ⋮ → Project settings, or the Projects view)" | No such entry point exists; the dialog is unreachable (D1). |
| K22 | Custom personas: "add a persona: name, icon, prompt, model, effort" | The form has name, icon, prompt, and a Grounded toggle only (`ModelDefaultsSettingsTab.tsx:32-36, 68-75`); model/effort silently default to `sonnet`/`medium` (`usePersonas.ts:480-481`). No edit UI either (D17). |

### docs/AUTH.md

| # | Claim | Correct |
|---|---|---|
| K23 | Gate exemptions: `_next/static`, `_next/image`, `favicon.ico`, `/login`, `/api/auth` | `/api/files/raw` is also exempt (`proxy.ts:17`), protected by an HMAC path signature (`auth.ts:120-134`). Header says "Last updated: 2026-06-25". |

### docs/architecture/*.md (moved "word for word", so prior errors moved with them)

| # | File | Claim | Correct |
|---|---|---|---|
| K24 | data-flow.md | Route list | Missing `GET /api/files/raw`, `POST /api/suggest-followups` (a live 7th LLM route, `useFollowUps.ts:41`), `POST/DELETE /api/auth`, and `?download=1` on `/api/artifacts/[id]/raw`. Lists `POST /api/classify` as live (D3). |
| K25 | data-flow.md | `process` "records `extraction_method` (`'text'` or `'vision'`)"; `GET /api/documents` returns `extractionMethod` (`'text'` or `'vision'`) | Also `'hybrid'` (`types.ts:56`); response also carries `failedPages`, `revision`, `pageCount`. |
| K26 | data-flow.md | "Default model fallback is `claude-opus-4-8`" | Default is the first Anthropic entry in the curated registry; the literal is only the last-resort fallback when no Anthropic model is curated (`registry.ts:269`). |
| K27 | rag-pipeline.md | "Recent messages — Last 20 messages in full detail" | Sliced to 20 only when a context prefix **and** a summary exist (`chat/route.ts:144-156`); otherwise all messages are sent. |
| K28 | rag-pipeline.md, database.md | "an oversize page that's skipped records its absolute page range into `failedPages`" | Oversize skips increment a `skippedPages` count only (`pdfSegments.ts:42, 63-66`); `failedPages` is built solely from failed segments (`visionExtraction.ts:127, 152`). Page-capping is likewise not in `failedPages`. |
| K29 | model-registry.md | "`selectedEffort` is clamped on model switch" | No clamp in `page.tsx`; `clampEffort` is display-only (`ChatInputArea.tsx:32-41, 363` — its own comment says so) and the server strips an unsupported level. Also "~6 files by hand" names four; `resolveTier()` is described as a live path (D22); "one newest entry per family" ignores that unrecognized ids collapse into family `'other'` and surface an extra row (`curate.ts:12-14`, `registry.ts:210-212`). |
| K30 | source-map.md | (a) `useDocumentUpload` "used by both `ProjectDocumentsDialog` and `ProjectLandingPage`"; `DocumentCard` "used in both `ProjectDocumentsDialog` and `ProjectLandingPage`" (b) `ArtifactCard`: "icon by type (xlsx/docx/pdf)" (c) artifact path `artifacts/<projectId|standalone>/<id>/<slug>.<ext>` (d) image tool returns `{ storagePath, url, mediaType, filename, fileSize }` (e) sidebar sections "were dead and removed" (f) `DocumentCard` "a `vision` chip" | (a) The consumer is `ProjectContextRail` (`:10, :101`), not `ProjectLandingPage`; same error in multimodal-artifacts.md (b) also pptx/html/code (`ArtifactCard.tsx:7`) (c) `<id>` is a random UUID, not the artifact id (`artifacts/path.ts:10`) (d) plus `embedUrl` (e) `ArchivedSection` was the only archived-chats UI (audit F2) (f) also `hybrid`, `Rev N`, and Replace. |
| K31 | source-map.md / database.md | Coverage | 39 modules under `src/{lib,hooks,components}` are named in neither CLAUDE.md nor `docs/architecture/` (e.g. `useFollowUps`, `useSmartDefaults`, `useChatTitle`, `useSummarization`, `topicDetection`, `embedChunks`, `motion`, `projectCapacity`, `artifacts/templates`, `ArtifactsView`, `ProjectsView`, `ToolProgressCard`). Env vars `DOCUMENT_MAX_CHARS`, `EMBED_CONCURRENCY`, `EMBED_MAX_RETRIES`, `PROJECT_CAPACITY_BYTES` are read by code and documented nowhere; there is no `.env.example`. database.md's table list omits `usage_events` (16 tables, 15 listed) and its `artifacts` column list omits `format`, `content`, `current_version` and the `project_id` index. |

Verified accurate (no action): 14 personas / 13 tiered / Contract Abstract pinned; three grounded personas; migrations `0000`–`0021` (22 journal entries) and every migration filename cited; all RAG and extraction env defaults; `PENDING_CAP = 10`, `MEMORY_SUGGEST_EVERY = 6`, summarize threshold 30 / keep 10; registry TTLs 5 min / 60 s and 5 s fetch timeout; `ARTIFACT_URL_TTL_SECONDS` 24 h; login limiter 10 / 15 min; DB pool options; CI step order; `useDialogs` 10 flags + 6 targets; image sizes 512 / 300 px; "~25 baseline lint warnings" (exactly 25); 143 test files. `docs/MODEL_ROUTING.md` makes no code claims (its `/model claude-fable-5-1` example is one release behind).

Other root docs: `PLAN.md` (phase checklist is SQLite/Ollama/DashScope history, self-labelled historical, but its header links the stale handoff and says "Atelier Technologies brand"); `TECH_STACKS.md` (last touched 2026-07-13: fixed model list "Opus 4.8 (default), Fable 5, Sonnet 5, Haiku 4.5", "effort omitted for Haiku" as a rule rather than a capability); `REQUIREMENTS_QUESTIONS.md` (2026-03 Ollama/glassmorphism planning Q&A, no current value); `ATELIER_BRAND_SKILL_V2.md` (305 lines, declared historical for colour by CLAUDE.md).

---

## T — Test hygiene

| # | Item | Evidence |
|---|---|---|
| T1 | `tests/audit-tmp/` hazard is still unmitigated | Directory does not exist now, but `vitest.config.ts:11` includes `tests/**/*.test.{ts,tsx}`, `tsconfig.json` includes `**/*.ts`, ESLint ignores only `.agents/**` and `.superpowers/**`, and `.gitignore` has no entry. The 2026-09-11 handoff finding 6 asked for exactly these excludes. STILL OPEN. |
| T2 | `tests/unit/api/classify-route.test.ts` tests a route nothing calls | D3. |
| T3 | Tests are the only consumers of `deleteMessage`, `getChats`, `getSettings`, `resolveTier` | D2, D22, D23. They pass while the production path is dead. |
| T4 | `e2e/project-management.spec.ts` asserts less than its names say | "new project button exists in sidebar" matches `QuickActions`' "New project" on the home view — the sidebar has no such button (`grep -rniE "new project" src`). "sidebar is visible" uses `aside, nav, [class*="sidebar"]`.first(). |
| T5 | `e2e/chat-flow.spec.ts` "send button is visible" | Locator `button[type="submit"], button:has(svg)').last()` matches any icon button on the page. "textarea is always enabled" only checks the idle state (K18). |
| T6 | Dead test scaffolding | `tests/global-setup.ts`, `tests/helpers/mock-ai.ts` (D9, D10). |
| T7 | Unused locals in tests | `chats.test.ts:44` `chat1`, `context.test.ts:76` `m1`, `summarize-route.test.ts:133` `m1`, `download.test.ts:74` `result` (lint + tsc). |

Clean: 0 `.only` / `.skip` / `.todo` / `xit` / `fixme`; every one of the 143 test files and every `it(` block (heuristic scan) contains an assertion; no test imports a module that no longer exists. E2E coverage is 9 smoke tests across 4 specs and never sends a message.

---

## R — Repo clutter

| # | Item | Evidence | Recommendation |
|---|---|---|---|
| R1 | `sqlite.db` tracked (32 KB, Ollama-era data) | `git ls-files -i -c --exclude-standard` → `sqlite.db`, `scripts/smoke-c2-render.mjs`. `.gitignore:53` lists it but it was committed first (`25aabd2`). | `git rm --cached sqlite.db`. It may hold early chat content — consider history too. |
| R2 | `scripts/smoke-c2-render.mjs` tracked though ignored | Same command. | `git rm` (D12). |
| R3 | `.gitignore` contradicts itself | Line "reproducible via skills-lock.json" is followed by ignoring `skills-lock.json`; the handoff then lists it as a file to hand-copy. | Track it or drop the claim. |
| R4 | 5 unused `public/*.svg` | D13. | Delete. |
| R5 | `docs/SESSION_HANDOFF.md` | Undated, v4.11–v4.35 content, still linked from `README.md:118` and `PLAN.md:16`. | Replace with a three-line pointer to the newest dated file (or delete and fix both links). |
| R6 | 20 dated `SESSION_HANDOFF_*.md` + 12 `chatlog-*.md` at `docs/` root (~300 KB) | `ls docs`. Only `2026-11-12` (current) and `2026-09-11` (still referenced for rulings) are live. | See layout below. |
| R7 | `docs/audits/2026-09-01-codebase-audit.html` (71 KB) | Rendered duplicate of the `.md` beside it. | Keep one. |
| R8 | Root planning docs | `REQUIREMENTS_QUESTIONS.md`, `PLAN.md`, `TECH_STACKS.md`, `ATELIER_BRAND_SKILL_V2.md`. | Move to `docs/archive/` (or fold `TECH_STACKS.md` into README). |
| R9 | `docs/plans/` (31 files, 1 MB) and `docs/specs/` (29 files) are all completed work except `2026-11-12-sidebar-review-fixes.md` | `ls docs/plans`. | Archive shipped plans; keep specs that architecture docs cite (`2026-07-21-dynamic-model-registry-design.md`, `2026-07-17-grounded-cited-answers-design.md`). |

No large binaries are tracked (largest tracked file is `package-lock.json`, 549 KB; pack is 2.7 MiB). Untracked-but-present local files (`GradingPlanIFC.pdf`, `atelier_brand_board.html`, `.agents/`, `tsconfig.tsbuildinfo`) are correctly ignored.

Suggested layout (nothing moved):

```
docs/
  SESSION_HANDOFF.md              <- pointer only: "current = handoffs/2026-11-12.md"
  handoffs/2026-11-12.md, 2026-09-11.md
  architecture/  audits/  AUTH.md  PERSONAS.md  MODEL_ROUTING.md
  plans/2026-11-12-sidebar-review-fixes.md      <- open work only
  specs/                                         <- specs still cited by architecture docs
  archive/
    handoffs/2026-06-18 … 2026-09-01             (18 files)
    chatlogs/                                    (12 files)
    plans/  specs/                               (shipped)
    root/PLAN.md, REQUIREMENTS_QUESTIONS.md, ATELIER_BRAND_SKILL_V2.md
```

Moving these changes paths that CLAUDE.md, the handoffs, and `globals.css` `@source not "../../docs"` reference; the `@source` exclusion covers the whole `docs/` tree, so the Tailwind gotcha is unaffected.

---

## Prior findings re-verified (`docs/audits/2026-09-01-codebase-audit.md` §2.7 and §3)

| Prior finding | Status | Evidence |
|---|---|---|
| K1 four undeclared packages | FIXED | All four in `package.json`. |
| K2 README → stale handoff | STILL OPEN | K1 above. |
| K3 CLAUDE.md SQLite mentions | FIXED | `:110`, `:188` now say Postgres / PGlite. |
| K3 `sqlite.db` tracked | STILL OPEN | R1. |
| K4 no `.env.example`; four undocumented env vars | STILL OPEN | K31. |
| K5 ~46 modules + two routes undocumented | STILL OPEN | 39 modules; both routes (K24, K31). |
| K6 README wrong on tests/models/brand/Node, silent on five features | STILL OPEN | K2–K9. |
| No genuinely unused dependency | STILL TRUE | P4. |
| Dead: `tests/global-setup.ts`, `tests/helpers/mock-ai.ts`, `scripts/spike-vision-extract.mjs` | STILL OPEN | D9–D11. |
| Dead: `ChatListSkeleton`, `ProjectListSkeleton`, `isImageExtension` | STILL OPEN | D14, D15. |
| ~21 needlessly exported symbols | STILL OPEN | D25 (now ~35 incl. types). |
| Duplicate `IMAGE_MIME_TYPES` with different members | STILL OPEN | `fileExtraction.ts:40` (png/jpeg/webp) vs `fileAttachments.ts:14` (adds gif/avif/heic/svg+xml). |
| "0 `eslint-disable`" | WAS INACCURATE | 21 in `src` today (e.g. `providers.ts:6`, `page.tsx:551`, `DocumentPreviewDialog.tsx:65`); all carry a rule name, most a reason. |
| 0 TODO/FIXME, no legacy markers | STILL TRUE | Section C. |
| `db/index.ts` "FK enforcement" | FIXED | `source-map.md` now says "postgres-js pool". |
| "Last 20 messages in full detail" | STILL OPEN | K27 (text moved to rag-pipeline.md). |
| "one newest entry per family" / `'other'` leak | STILL OPEN | K29 (PLAUSIBLE: depends on the live catalog containing such ids). |
| Sonnet 5 pricing "reverting after 2026-08-31" | FIXED | `pricing.ts:19` is $3/$15 and the doc matches. |
| "six capture sites" vs 11 generation sites | STILL OPEN | 6 `recordUsage` calls vs 12 `generateText`/`streamText` sites; tracked as C5 in the handoff. |
| `selectedEffort` "clamped on model switch" | STILL OPEN | K29. |
| Thinking described as capability-driven | STILL OPEN | `providers.ts:41` sets adaptive thinking for every Claude model. |
| Google Search grounding on internal Gemini | STILL OPEN | D8, K10. |
| `failed_pages` oversize claim | STILL OPEN | K28. |
| PGlite "once per worker ~15 s" | FIXED | `:190` now "once per test file … ~65 s". |
| "All POST routes validate with Zod" | STILL OPEN | K14. |
| CSP omissions | STILL OPEN | K15. |
| Styling: no backdrop-blur / 16 consumers / `text-ink` | STILL OPEN | K11–K13. |
| `ArchivedSection` "dead and removed" | STILL OPEN | K30(e); fix planned in the sidebar plan. |
| E2E "Textarea is always enabled" | STILL OPEN | K18. |
| PDFs via same-origin proxy (thumbnail exception) | STILL OPEN | K17. |
| "~6 files by hand" names four | STILL OPEN | K29. |
| Migrations line | ACCURATE | 22 journal entries = `0000`–`0021`. |
| Vercel CLI installed/authenticated | NOT RE-VERIFIED | Out of scope (no external calls). |
| AUTH.md exemptions | STILL OPEN | K23. |
| README lines | STILL OPEN | K1–K9. |
| SESSION_HANDOFF_2026-09-01 "5 commits ahead" | STILL OPEN | Historical file, unchanged; archive rather than fix. |
| CHANGELOG 4.52.0 advisory/warning counts | STILL OPEN | Historical entry, unchanged. |
| PERSONAS.md "accurate" | NO LONGER FULLY TRUE | K21, K22. |
| Handoff 09-11 finding 6 (`tests/audit-tmp/`) | STILL OPEN | T1. |
