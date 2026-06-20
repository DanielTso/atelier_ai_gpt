# Session Handoff — 2026-06-19

_Resume doc for the next session. Read `docs/SESSION_HANDOFF.md` for the long program history and the project `CLAUDE.md` for how the code works. THIS file captures what shipped 2026-06-19 and what's in-flight._

## TL;DR — where we are
- **Everything is merged to `master` and released.** Working tree clean (only pre-existing untracked files: `ATELIER_BRAND_SKILL_V2.md`, `atelier_brand_board.html`, `docs/plans/Coding_Sessions_Agent_Stack_Reference.docx.pdf`, `scripts/smoke-*.mjs`). No open feature branches.
- **Three releases shipped today:** v4.7.0, v4.8.0, v4.9.0 (details below). Prior: v4.6.0 (A→D1 program).
- **Next up: auto-memory** — design approved (mode: *suggest-you-approve*). _Update 2026-06-20: spec'd + built on branch `feat/auto-memory` (v4.10.0), gate green, pending live `0008` migration + merge. See `docs/SESSION_HANDOFF_2026-06-20.md`._
- **Live Supabase:** migrations `0000`–`0007` applied. Org on **Pro**. Production: **https://atelier-ai-app.vercel.app** (and `atelier-ai-studio.vercel.app`). ⚠️ bare `atelier-ai.vercel.app` is a DIFFERENT project — don't use it.

## Shipped today (all on `master`, GitHub-released, prod-deployed)

### v4.7.0 — Claude.ai-style layout (3 slices)
- **Shell + Home:** sidebar nav (New chat · Projects · Artifacts · Customize + flat Recents), centered time-of-day greeting, centered composer, quick-action chips, responsive off-canvas sidebar. Layout dimension tokens in `globals.css`. New `HomeGreeting`, `QuickActions`, `SidebarNav`, `RecentsSection`, `ProjectsView`, `ArtifactsView`; `Sidebar` rebuilt; `AppView` router (`home|projects|artifacts`) via `selectView`/`activeView` on `SidebarActions`.
- **Project context rail (3-pane):** `ProjectContextRail` with editable **Memory** + **Instructions** (functional — injected into the chat system prompt via `buildProjectPreamble`; `projects.memory`/`instructions` cols, migration `0006`) + **Files** with a `CapacityBar` (`PROJECT_CAPACITY_BYTES`, 2 GB). `ProjectLandingPage` → chats-column + rail (keyed per project).
- **Artifacts list + display name:** `getAllArtifacts` + real `ArtifactsView`; `display-name` setting → greeting.
- **Bug fixes from smokes:** project-view render guarded against the projects-load race; **New chat** goes to a fresh Home compose (no empty rows); `activeChatId`/`activeProjectId` no longer persist → app **starts on Home**.

### v4.8.0 — Persona system v2 + construction quick actions
- **Unified persona list** (`usePersonas.ts`) — one flat list, each persona = **prompt + model + effort** (`Persona.effort?: low|medium|high|max`). Roster (9): General Assistant (default), Coding, Code Review, Deep Analysis, Creative Writing, Brief, Teacher, **Construction Pro**, **Plan & Spec Reader**. Dropped the two-tier split + duplicates.
- **Default = General Assistant · Sonnet 4.6 · Medium.** (Live `default-model` setting aligned to `claude-sonnet-4-6` this session.)
- **Adaptive thinking + effort** — `createProvider(modelName, effort?)` sets `providerOptions.anthropic = { thinking: {type:'adaptive'}, effort }`. **Effort OMITTED for `claude-haiku-*`** (API 400s). `chatRequestSchema.effort` enum; effort flows client→body→provider. Composer **`EffortPill`** (Low/Med/High/Max) overrides the persona's effort; hidden for Haiku/image. Corrected the stale "no thinking config" note in `CLAUDE.md`.
- **Construction quick actions** — Home chips: **New project · Add documents · Draft RFI · 3-week look-ahead**. **Add documents** is project-aware (active project → its docs dialog; Home → Projects view). Attach tooltip → "Attach to this message" (distinguishes per-message input from project knowledge/RAG).

### v4.9.0 — Document re-versioning (replace in place + retained history)
- **Replace / Update document** action on `DocumentCard` (beside delete) → new revision on the *same* record; re-extract/chunk/embed; **"Rev N"** badge. Migration **`0007`** (applied live): `documents.revision`/`updated_at` + **`document_revisions`** table (superseded revisions retained — files kept in Storage, no chunks; RAG uses latest only).
- `upload-url` gains `replaceDocumentId`; `process` gains the replace path (snapshot old → `deleteDocumentChunks` → process new → `applyDocumentReplacement` → bump revision); `DELETE` sweeps retained files. Actions: `createDocumentRevision`, `deleteDocumentChunks`, `getDocumentRevisions`, `applyDocumentReplacement`. `useDocumentUpload.replace(file, documentId)`.
- **Browser-verified end-to-end** (upload Rev A → Replace with Rev B → Rev 2, Rev 1 retained in `document_revisions`; delete swept both).

## ▶️ NEXT (in-flight): Auto-memory — design APPROVED, not built
Second of two deferred items (first was re-versioning, now shipped). **Mode chosen: "suggest, you approve."**

**Design (locked at the concept level; write the spec next):**
- After exchanges in a **project** chat, a **throttled, best-effort** housekeeping pass (Gemini `gemini-3.5-flash` — never Claude tokens) extracts **candidate durable job facts** (names, roles, locations, key dates, decisions).
- Surfaced as **pending suggestions** in the rail's Memory section → **Accept** (append to `projects.memory`) / **Edit** / **Dismiss**. Nothing enters Memory without a click (the safety gate).
- **Route** `POST /api/memory/suggest` mirroring `/api/classify` (generateText → parse → fallback); prompt gets current Memory + recent messages, returns only facts **not already in Memory** (dedup). Degrades silently with no Gemini key.
- **New table** `memory_suggestions` (migration **`0008`**): `id, projectId, chatId?, text, status (pending|accepted|dismissed), createdAt`. Accepted facts append to the existing `projects.memory` field (one source of truth; already injected into chat + shown in rail).
- **Actions:** `createMemorySuggestions`, `getPendingSuggestions(projectId)`, `acceptSuggestion` (append to Memory + mark accepted), `dismissSuggestion`. **UI:** "Suggested memories (N)" strip in `ProjectContextRail` Memory section.
- **Two open defaults to confirm with user (else use these):** (a) throttle cadence — default **every 6 messages** in a project chat; (b) cap pending suggestions — default **~10**.
- **Scope/YAGNI:** in = throttled extraction + suggestions table + rail review + accept→Memory. Deferred = fully-automatic writing, cross-project memory, structured/categorized store, auto-pruning.
- **Process:** brainstorm (done — present spec next) → spec (`docs/specs/2026-06-19-auto-memory-design.md`) → writing-plans → implement → gate → **pause before live `0008` migration** → merge + release (v4.10.0).

## Deferred / known follow-ups
- **Capacity meter is revision-unaware** — counts current documents only; retained revision files aren't counted (accepted on Pro). Make it revision-aware later.
- **No retention/pruning** policy for retained revisions (storage grows; revisit if it balloons).
- **RLS on new tables:** verify RLS is enabled on `document_revisions` (and will be on `memory_suggestions`) — the app connects as `postgres` owner (bypasses RLS), but enable it for consistency with the other 11 tables.
- Throwaway `scripts/smoke-*.mjs` + `c:\tmp\*.ps1` from earlier sessions to delete eventually.

## Operational facts (important)
- **Verification gate:** `npm run lint` (0 errors; ~26–30 warnings baseline), `npm run typecheck`, `npm run build`, `npm test` (**248 tests** currently). If `npm run build` fails with an EPERM/unlink on `.next` (OneDrive lock), `rm -rf .next` and rebuild.
- **Live migrations (gated):** `set -a; . ./.env.local; set +a; npx drizzle-kit migrate` (sources `DIRECT_URL`, keeps Drizzle journal in sync). Pause for user go-ahead; they typically approve.
- **Releases:** merge feature branch → `master` (no-ff) triggers CI (`.github/workflows/ci.yml`) + Vercel prod deploy. Then `git tag -a vX.Y.Z`, push tag, `gh release create`, delete branch. User is solo → **no PRs**; direct merge to master is the workflow.
- **Do NOT** run `vercel env pull` / `vercel dev` — they clobber `.env.local`. Vercel **sensitive** env vars can't be read back — verify by **presence** (`vercel env ls`), not value.
- **Web search is provider-native** (Anthropic `web_search` for Claude, Google grounding for Gemini) — **not Tavily / no external search lib**.
- **Browser smoke (Playwright MCP):** file uploads must be **inside the project dir** (Playwright restricts roots) — copy temp files into a `.smoke/` dir under the repo, then clean up. The browser session sometimes errors "Target page closed" on first `navigate` — just call `navigate` again.
- **User works as a construction Project Superintendent (Daniel Tso, Brycon, Drover/YAWN job)** — the app is a construction-document workhorse; personas/quick-actions/features lean construction. The live `Drover` project (id 3) has 2 real PDFs — don't mutate them in smokes; use throwaway docs.
- **Settings live in DB:** `default-model = claude-sonnet-4-6`, `display-name = Daniel`. Upload limit 200 MB (app `MAX_FILE_SIZE` + bucket `file_size_limit` + project-global Storage limit).
- **Cadence the user expects:** brainstorm → spec → plan → implement → gate → finish-branch → merge+release. They delegate heavily ("you are Sr Fullstack Engineer") and approve merges/releases readily, but **confirm production cutovers and live migrations**.

## Quick links
- Specs: `docs/specs/2026-06-18-claude-ai-layout-design.md`, `…2026-06-19-persona-system-v2-design.md`, `…2026-06-19-quick-actions-file-flow-clarity-design.md`, `…2026-06-19-document-reversioning-design.md`. (Auto-memory spec: TO BE WRITTEN.)
- Plans: `docs/plans/2026-06-18-claude-ai-layout-slice{1,2}-*.md`, `…2026-06-19-claude-ai-layout-slice3-*.md`.
- CHANGELOG: `[4.9.0]`…`[4.6.0]` entries.
