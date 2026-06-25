# Changelog

All notable changes to this project will be documented in this file.

## [4.29.0] - 2026-06-25 — Claude-style Artifacts gallery

### Added

- **The Artifacts page is now a Claude-style gallery.** The bare icon+title+Download list is replaced by a responsive 2/3/4-column grid of rich cards, each with a **rendered preview thumbnail**, a **search bar**, a **type filter** (All / HTML / PDF / Spreadsheet / Document / Slides), and a **New artifact** action.
  - **Preview thumbnails** (`ArtifactThumbnail`) render by type — a live, sandboxed, non-interactive mini-render for HTML; first-page for PDF; a table snippet for spreadsheets; a text snippet for docs/slides; a branded type tile as fallback. Thumbnails are **lazy-mounted** via IntersectionObserver (only when scrolled near) so a full grid never mounts dozens of live iframes at once.
  - **Cards** (`ArtifactGalleryCard`) show the title, type label, an "Edited X ago" timestamp, and a **source chip** (project name → else chat title) that opens that chat. Clicking a card opens the existing **ArtifactWorkspace** (Preview / Edit / Versions / Download / regenerate) as a resizable overlay.
  - **Search + type filter** are client-side via a pure `filterArtifacts` reducer (matches title + source text; AND with the type filter).
  - **New artifact** authors any of the 5 types from scratch: `createBlankArtifact(type)` creates a standalone host chat (`chat_id` is NOT NULL — no migration), renders a blank template, persists the artifact (v1), and opens it in the workspace **Edit** tab. Render/upload failures roll back the host chat + storage object (no orphans).
- `getAllArtifacts` now returns `editedAt` (latest version time), `chatTitle`, and `projectName` via joins (new optional `ArtifactSummary` fields; per-chat lists unchanged). `ARTIFACT_TYPE_LABELS` added.

### Notes

- **No DB migration.** Dropped from scope (no backing model): Published/Private visibility and view counts.
- Security: HTML thumbnails render only in a sandboxed `<iframe sandbox="allow-scripts">` (no `allow-same-origin`), matching the existing live-preview sandbox; storage paths use a server-side UUID (no user-controlled segment).
- Built via subagent-driven TDD (8 tasks, per-task spec+quality review, final whole-branch review = "ready to merge"). Spec: `docs/specs/2026-06-25-artifacts-gallery-design.md`; plan: `docs/plans/2026-06-25-artifacts-gallery.md`.
- Gate: typecheck 0 errors, lint 0 errors (27 baseline warnings), build clean, **359 tests pass** (new: `filterArtifacts`, templates, `createBlankArtifact` incl. rollback, `ArtifactGalleryCard`, gallery render/filter).

## [4.28.0] - 2026-06-25 — Audit batch D: page.tsx decomposition (first pass)

### Refactor

- Began decomposing the 1355-line `src/app/page.tsx` god component into cohesive, testable units (behavior-preserving):
  - **`src/lib/generatedImages.ts`** — extracted the `extractGeneratedImageOutputs` helper + `GeneratedImageOutput` type out of the page module (now unit-tested).
  - **`src/hooks/useChatTitle.ts`** — the `maybeGenerateTitle` auto-titling logic, decoupled from page state via stable injected callbacks (`readChats` / `modelRef` / `applyTitle`).
  - **`src/hooks/useSummarization.ts`** — the `triggerSummarization` context-window compression + the `SUMMARIZATION_THRESHOLD` / `MESSAGES_TO_KEEP` constants.
  - Folded the near-identical `handleCreateChat` / `handleCreateChatInProject` into one `createChatForProject(projectId)` helper (the project-defaults block was duplicated verbatim).

### Notes

- No behavior change — pure structural extraction. Gate: typecheck 0 errors, lint 0 errors (27 baseline warnings), build clean, **344 tests pass** (+5 new for the extracted image helper).
- Remaining decomposition (deferred, higher coupling): a `useDialogs` reducer for the 13 dialog-state pairs, and lifting the `onFinish` persistence pipeline into a `useChatPersistence` hook — best done with E2E coverage running, since they touch the central streaming/persistence path.

## [4.27.0] - 2026-06-25 — Audit batch C: auth session hardening

### Security

- **Access cookie now expires server-side.** The cookie was a static `HMAC-SHA256(secret, "atelier-authed-v1")` over a fixed string — no expiry, no nonce, valid forever once issued. It's now `base64url({exp, n}).HMAC(secret, payload)`: a signed 30-day **expiry** (enforced in `verifyAuthCookie`) and a random **nonce** per issue. **Upgrading invalidates existing cookies — everyone re-logs-in once.** (`src/lib/auth.ts`: `mintAuthToken` replaces `authToken`; `AUTH_TTL_SECONDS` added.)
- **Login is now rate-limited.** `POST /api/auth` throttles failed attempts per client IP (best-effort in-memory `src/lib/rateLimit.ts`: 10 failures / 15-min window → `429` + `Retry-After`, plus a 250ms per-failure delay). A successful login clears the counter. Documented Vercel WAF as the cross-instance hard guarantee.
- **Password compare no longer leaks length.** `checkPassword` now compares HMAC digests of both sides (fixed 64-hex length, collision-resistant) instead of the raw strings, closing the early-length-return timing side-channel — without the collision risk of a non-cryptographic normalizer. (Now async.)
- **Middleware matcher tightened.** The gate excluded *any* path ending in an image extension (`.svg/.png/…`) anywhere in the URL — a latent bypass where a future route ending in one of those would be reachable unauthenticated. Scoped the exclusion to Next internals (`_next/static`, `_next/image`, `favicon.ico`) only. `public/` assets are gated too, but none are needed pre-auth (the login page references no static assets).

### Notes

- `docs/AUTH.md` updated to the new cookie format, throttle, and matcher.
- Gate: typecheck 0 errors, lint 0 errors (27 baseline warnings), build clean, **339 tests pass** (+4 new: cookie expiry, nonce uniqueness, login throttle, counter-reset-on-success).

## [4.26.0] - 2026-06-25 — Audit batch B: correctness, perf & cleanup

### Fixed

- **pgvector HNSW index was being bypassed.** `findSimilarMessages` / `findSimilarDocumentChunks` ordered by `1 - distance DESC`, which the planner treats as an opaque expression → sequential scan + sort on every chat turn (time-to-first-token critical path). Now they `ORDER BY` the raw `cosineDistance` **ascending** (so the `vector_cosine_ops` HNSW index drives the top-k scan) and apply the similarity threshold as a post-filter on the small result. Verified semantics-preserving by the real-pgvector `vector-search` test.
- **Media-only assistant turns no longer leak a `(image)` placeholder.** Image-only replies were saved with the literal content `"(image)"`, which rendered as a stray text bubble after reload. They now persist empty content, and `loadMessages` skips empty text parts (the image/artifact still reconstructs).
- **Artifact-only turns are now persisted.** A turn that only called `generate_artifact` with no surrounding prose matched none of the save-guard conditions and vanished from message history on reload. The guard now also detects `tool-generate_artifact` parts.

### Changed

- **`getProjectChatPreviews`** replaced a fetch-all-user-messages-then-truncate-in-JS pass with a single `DISTINCT ON (chat_id) … left(content, 120)` query — transfers ~120 bytes/chat instead of full message bodies.

### Security

- **HTML artifacts now download instead of executing inline.** `createSignedDownloadUrl` forces `Content-Disposition: attachment` for `.html` objects, so model-generated HTML/JS no longer runs on the `*.supabase.co` storage origin when the Download link is clicked. The in-app live preview (sandboxed `<iframe srcDoc>`) is unaffected; PDFs (previewed inline via the signed URL) and binaries stay inline.
- **`AUTH_SECRET` fallback now warns.** When the gate is enabled with only `APP_ACCESS_PASSWORD` set (cookie signed with the low-entropy password), `authSecret()` logs a one-time warning recommending a high-entropy `AUTH_SECRET`.

### Refactor / cleanup

- Removed dead exports `applyDocumentReplacement` and `updateArtifactStoragePath` (superseded by the transactional `commitDocumentReplacement` and insert-time `createArtifact` seeding); repointed the re-versioning test to the live `commitDocumentReplacement` path.
- Added a `signedArtifactUrl(path)` helper (bakes in the artifact TTL + null-swallow) and replaced the 4 byte-identical artifact signing sites (versions/summary/edit/regenerate).
- Fixed a stale `// virtual model resolution` comment in the chat route (no virtual models exist).

### Notes

- Gate: typecheck 0 errors, lint 0 errors (27 baseline warnings), build clean, **335 tests pass**. No DB migration required (HNSW indexes already exist; the fix is query-shape only).

## [4.25.0] - 2026-06-25 — Dependency security bump (audit batch A)

### Security

- **`next` 16.1.6 → 16.2.9** — clears the high-CVSS advisories affecting 16.1.6: HTTP request smuggling in rewrites, SSRF via WebSocket upgrades (CVSS 8.6), **middleware/proxy bypass via dynamic-route param injection (CVSS 8.1)** — directly relevant since the access gate is a middleware — and the image-cache / RSC / postponed-resume DoS advisories. `eslint-config-next` bumped to match. (Next 16.2 renames the middleware build output to "Proxy".)
- **`drizzle-orm` 0.45.1 → 0.45.2** — patches GHSA-gpj5-g38j-94v9 (SQL injection via unescaped identifiers). The sink was unreachable here (no `sql.identifier`/`sql.raw` with user input), but the patch removes the risk class.
- **`@xmldom/xmldom` 0.8.11 → 0.8.13** (transitive via `mammoth`) — clears the XML-injection/recursion-DoS advisories.
- **`vitest` 4.0.18 → 4.1.9** + **`vite`** to a patched 7.x (dev-only) — clears the critical "arbitrary file read+exec when the Vitest UI server is listening" and the vite path-traversal advisories. Not shipped to production.

### Notes

- Audit dropped from 21 vulnerabilities (1 critical, 8 high, …) to **8 moderate**, all dev-tooling or internal transitives whose only available "fix" is a breaking major *downgrade* (`next`→9, `exceljs`→3) — deliberately left: `esbuild ≤0.24.2` (via `drizzle-kit`, dev-server only), `postcss <8.5.10` (nested in `next`), `uuid <11.1.1` (via `exceljs`, server-side file gen only).
- Gate: typecheck 0 errors, lint 0 errors (27 baseline warnings), build clean, **335 tests pass**. First batch of a multi-batch codebase security/quality audit.

## [4.24.2] - 2026-06-24 — Docs refresh

### Docs

- Refreshed the project docs to current state: `CLAUDE.md` (artifact engine now `xlsx|docx|pdf|pptx|html` with the `style.ts`/`markdown.ts` formatting layer, live-preview `ArtifactWorkspace`, resizable + auto-collapse panel, and the `generate_image` Nano Banana tool), `README.md` (artifact + inline-image capabilities), and a new `docs/SESSION_HANDOFF_2026-06-24.md` (current-state bootstrap through v4.24.1) with the canonical `docs/SESSION_HANDOFF.md` pointing at it. No code change.

## [4.24.1] - 2026-06-24 — Auto-collapse sidebar for a wide artifact panel

### Added

- When you drag the artifact panel wide enough to cramp the chat (chat column < ~520px with the sidebar expanded), the **sidebar auto-collapses** to give the chat more room — and **auto-restores** when you narrow the panel or close the artifact. It only restores what it auto-collapsed, so a sidebar you collapsed yourself stays collapsed.

### Notes

- Reacts to the panel-width drag, not to manual sidebar toggles (no fighting). Verified live: drag wide → sidebar collapsed; drag narrow → sidebar restored. typecheck clean, lint 0 errors, build clean, 335 tests pass.

## [4.24.0] - 2026-06-24 — Resizable artifact panel

### Added

- **The artifact workspace panel is now resizable** — drag its left edge to widen/narrow it (was a fixed 448px). Width is clamped (min 360px, max 80% of the viewport) and **persisted** (`artifact-panel-width` in localStorage), so it survives reloads and reopening artifacts.

### Notes

- Verified live: dragging the handle resized the panel and the width persisted. typecheck clean, lint 0 errors, build clean, 335 tests pass.

## [4.23.0] - 2026-06-24 — Inline image generation (Nano Banana tool for Claude)

### Added

- **`generate_image` tool** — Claude can now generate images **inline mid-conversation** via Nano Banana 2 (`gemini-3.1-flash-image`), instead of only being available as a separately selectable model. Ask "generate/draw/design an image of …" and the picture appears in the reply. New `src/lib/image/tool.ts`; merged into the Claude tool set (with `generate_artifact`) when storage is configured; system guidance steers chat-first / image-on-explicit-request.
- The tool generates server-side, **uploads the image to storage, and returns only a small descriptor** (path + signed URL) — no base64 in the conversation, so token cost stays low. `onFinish` links it to the assistant message (new `saveGeneratedImage` action) and renders it inline immediately, reusing the existing `message_attachments` path (durable across reloads).

### Notes

- The standalone Nano-Banana-as-a-model picker entry is unchanged. Verified live: Claude generated a construction-dashboard image inline that persisted across reload. typecheck clean, lint 0 errors, build clean, 335 tests pass (new: image-tool + `saveGeneratedImage`).

## [4.22.0] - 2026-06-24 — HTML artifacts with live preview

### Added

- **`html` artifact type with a live side-panel preview** (Claude.ai-style). Claude can now produce a web page / landing page / interactive HTML mockup as an artifact (`type:"html"`, `format:"html"`, content = a complete standalone HTML document). It renders live in the `ArtifactWorkspace` via a sandboxed `<iframe srcDoc>` (Preview / Edit / Versions tabs, Download, and AI regenerate all work). Previously Claude could only return webpages as Markdown code blocks.
- HTML passes through the renderer unchanged (`text/html`, no conversion); edit/regenerate keep raw HTML (no Markdown coercion). New `<>` icon on HTML artifact cards.

### Notes

- Security: the preview iframe uses `sandbox="allow-scripts"` (no `allow-same-origin`) — the previewed page runs its own JS but can't reach app cookies/session.
- No DB migration (artifact `type`/`format`/`content` are flexible text columns). Verified live: Claude built an HTML landing page → opened with a working live preview. typecheck clean, lint 0 errors, build clean, 331 tests pass.

## [4.21.2] - 2026-06-24 — Fix chats stuck on "New Chat"

### Fixed

- **Chats stayed titled "New Chat"** instead of getting an auto-generated title. Two causes: (1) the title model (`gemini-3.5-flash`) was capped at `maxOutputTokens: 50`, and its internal thinking consumed the budget — so it returned an **empty title** that the client then skipped; (2) titling only ran during the live turn, so any chat that missed it never got a second chance.
- **Fixes:** raised the title generation budget to 512 tokens; extracted a `maybeGenerateTitle` helper that now **also backfills the title when a still-"New Chat" with an exchange is opened**; and added a fallback that derives a title from the first user message if the model still returns nothing. A chat with a real exchange no longer stays "New Chat".

### Notes

- Verified live: opening a stuck "New Chat" retitled it ("2026 Transformer Lead Times"). typecheck clean, lint 0 errors, build clean, 328 tests pass.

## [4.21.1] - 2026-06-24 — Fix expired artifact download links (InvalidJWT)

### Fixed

- **Artifact "Download" failed with `InvalidJWT — "exp" claim timestamp check failed`** once the artifact workspace had been open longer than 5 minutes. Artifact download URLs were signed with the default 300s TTL, so the link expired before it was clicked. They now use a 24h TTL (`ARTIFACT_URL_TTL_SECONDS`, matching chat attachments), applied at every mint site: the `generate_artifact` tool, `getChatArtifacts`/`getAllArtifacts`, `getArtifactVersions`, and the edit/regenerate routes.

### Notes

- typecheck clean, lint 0 errors, build clean, 328 tests pass (artifact storage mocks updated for the new export).

## [4.21.0] - 2026-06-24 — Clean thinking + sources UI (Claude.ai-style)

### Added

- **Collapsible "Thought process" block** — the assistant's reasoning now renders as a tidy collapsible section (✳ icon). It auto-expands and shows live "Thinking…" while the model reasons before answering, then collapses once the answer begins (re-openable). Previously reasoning was streamed but never shown. Stream now sends reasoning explicitly (`sendReasoning: true`).

### Changed

- **Sources are now collapsible** — replaced the always-expanded wall of web-search links with a compact "🌐 N sources" toggle (collapsed by default), so a search-heavy reply no longer buries the answer under 30 links.

### Notes

- Verified live: reasoning shows as "Thinking…" while streaming → "Thought process" (collapsed) after; sources collapse to "N sources". typecheck clean, lint 0 errors, build clean, 328 tests pass.

## [4.20.5] - 2026-06-24 — Enter sends the message

### Changed

- **Enter now sends** a chat message; **Shift+Enter** inserts a newline (Ctrl/Cmd+Enter still sends too). Previously only Ctrl+Enter sent. Enter is ignored while an IME composition is active (CJK input) so it never sends mid-word. Composer placeholder updated.

### Notes

- typecheck clean, lint 0 errors, build clean, 328 tests pass.

## [4.20.4] - 2026-06-24 — Fix double "AI" bubble during streaming

### Fixed

- During a streaming reply the UI showed **two assistant bubbles** — the actual streaming message (with its cursor) *and* a separate typing-dots indicator. The dots now appear only while waiting for the reply to begin; once the assistant message starts streaming, only the message + cursor show (matches Claude.ai). `MessagesList` typing indicator is gated on the last message not already being the assistant's.

### Notes

- typecheck clean, lint 0 errors, build clean, 328 tests pass.

## [4.20.3] - 2026-06-24 — Fix raw Markdown (`**`, `##`) leaking into documents

### Fixed

- **Excel cells dumped raw Markdown** — `## Section`, `**bold**`, etc. showed their literal markers because the xlsx renderer never parsed Markdown in cells. Cells now run through `mdToPlainText()` so they show clean plain text (markers stripped), keeping the formula-injection guard.
- **Word/PDF/PPTX list items leaked raw `**`/`*`** — marked nests a list item's inline content under a `text` token that the flattener didn't recurse into, so bold/italic inside bullets stayed literal. `inlines()` now recurses nested tokens, so list-item emphasis renders as real bold/italic.

### Notes

- Verified on rendered output: Word list item "bullet with **strong**" now renders as real bold with no leftover markers; Excel "## Section" → "Section". typecheck clean, lint 0 errors, build clean, **328 tests pass**.
- Applies to **newly generated** documents. Documents created before this release still contain the old raw text — regenerate them to get the fix.

## [4.20.2] - 2026-06-22 — Chat-first: stop over-generating downloadable files

### Fixed

- **The model was generating downloadable Word/Excel/PDF files for ordinary requests** (e.g. "write an email"), instead of answering in the chat. Because those turns were tool-only (no chat text), nothing visible was saved, so users assumed it failed and re-sent — producing duplicate messages and repeated documents.
- **Now behaves like a normal chat assistant:** answers directly in the conversation (Markdown), and only calls `generate_artifact` when the user **explicitly** asks for a downloadable/exported file ("make a spreadsheet", "export to Word", "create a PDF", "build a deck"). Tightened the tool description and added an `ARTIFACT_GUIDANCE` system rule (prepended when the tool is active for Claude).

### Notes

- Verified by replaying the failing request: "write an email…" now streams a text reply (0 tool calls); "make me an .xlsx schedule" still generates the file. typecheck clean, lint 0 errors, build clean, 324 tests pass.

## [4.20.1] - 2026-06-22 — Artifact polish: PDF tables + PPTX overflow

Follow-up to v4.20.0 closing the two deferred fidelity gaps.

### Changed

- **PDF tables** — columns are now sized **proportionally to content** (was evenly divided), cell text **wraps within its column** (was truncated at 40 chars), and the **navy header row repeats** when a table spans a page break.
- **PowerPoint overflow** — a slide whose body exceeds the content box is split into **continuation slides** (`"… (cont.)"`) instead of overflowing off the bottom. Pagination is a pure `paginate()` helper.

### Notes

- Verification: typecheck clean, lint 0 errors, build clean, **324 tests pass** (new: PDF wide-table render, PPTX overflow + 4 `paginate` unit tests).

## [4.20.0] - 2026-06-21 — Professionally formatted artifacts

Generated artifacts (xlsx/docx/pdf/pptx) are now brand-styled instead of plain text. Spec `docs/specs/2026-06-21-artifact-formatting-design.md`, plan `docs/plans/2026-06-21-artifact-formatting.md`.

### Added

- **`src/lib/artifacts/style.ts`** — Atelier brand palette (navy/steel-blue/ink/…) + per-library color/font helpers, one source of truth for document styling.
- **`src/lib/artifacts/markdown.ts`** — shared `parseMarkdown()` → neutral AST (headings, paragraphs, inline bold/italic/code, ordered/unordered lists, GFM tables, code) via the `marked` lexer. New dep `marked` (pure-JS).

### Changed

- **Excel** — navy frozen header row (white bold), banded body rows, muted borders, auto column widths, numeric right-align; formula-injection guard retained.
- **Word** — Markdown **tables → styled Word tables** (navy header, banded rows), real heading styles (navy/steel-blue/ink), inline bold/italic/mono, bulleted + numbered lists, default Calibri/ink run style, footer page numbers.
- **PDF** — branded headings, wrapped paragraphs, bullet lists, simple branded tables (header band + alternating rows), multi-page flow, code blocks.
- **PowerPoint** — slides split on `#` H1, navy title strip with white title, branded body (bullets/sub-headings/paragraphs/tables/code).
- **`generate_artifact` tool description** now guides the model to emit structured content (headings, tables, bold, lists) so the styling has structure to work with.

### Notes

- No schema/migration/storage/version-flow changes; `ArtifactPreview` untouched. Verification: typecheck clean, lint 0 errors, build clean, **315 tests pass** (6 new artifact test files). Known minor gaps (deferred): PDF/PPTX render ordered lists as bullets; PDF doesn't wrap very long unbroken tokens or code lines.

## [4.19.1] - 2026-06-21 — Fix: artifact titles truncated (looked like duplicates)

### Fixed

- **Artifact cards truncated their titles** (`truncate`), so artifacts whose names differed only in a suffix (e.g. "… (60% Plans)" vs "… (60% Plans) – Revised") looked like duplicates. Titles now **wrap** (`break-words`) so the full name — and the `· v<n>` revision marker — is always visible. Card layout switched to `items-start` so the icon/Download button align cleanly with multi-line titles. Affects both the Artifacts view and the in-chat artifact cards (`ArtifactCard`).

### Notes

- No true duplicate rows existed — the artifacts are distinct; only the display was clipped.

## [4.19.0] - 2026-06-21 — Chat header breadcrumb (project context)

### Added

- **Chat header breadcrumb** showing whether the open chat lives in a project. Project chats show a clickable **📁 \<project\> › \<title\>** crumb (clicking the project navigates to its landing page); standalone chats show **⚡ Quick chat › \<title\>**.

### Notes

- Verification: lint 0 errors / 27 warnings, typecheck clean, build clean, **297 tests pass** (new: `ChatHeader` breadcrumb tests).

## [4.18.0] - 2026-06-21 — Projects: real "Updated" timestamp

Follow-up to 4.17.0 — replaces the cards' "Created" date with a true last-activity "Updated" timestamp.

### Added

- **`projects.updated_at`** column (migration `0011_mysterious_darwin.sql`; applied to live Supabase + drizzle ledger synced). Existing rows backfilled to `GREATEST(created_at, latest chat / message / document activity)`.
- `touchProject()` / `touchProjectForChat()` helpers bump `updated_at` (best-effort) on: project rename, memory/instructions edit, new chat in project, new message in a project chat, and document upload.

### Changed

- Project cards now show **"Updated &lt;date&gt;"** (was "Created"); the header sort relabelled **"Last updated"** and sorts by `updated_at` (falling back to `created_at`).
- Optimistic local `updatedAt` bump on rename + context save so the UI reorders immediately.

### Notes

- Verification: lint 0 errors / 27 warnings, typecheck clean, build clean, **295 tests pass** (PGlite applies `0011` in-process).
- Migration is backward-compatible (nullable column with default) — DB was migrated before the code deploy, so old code tolerated the new column.

## [4.17.0] - 2026-06-21 — Projects view: search, sort, create, rename, kebab menu

Brings the Projects view up to a dashboard-grade layout (closer to the Claude.ai projects reference).

### Added

- **Search** — filter projects by name or description (memory) via a search box.
- **Sort** — "Newest" (by creation date) or "Name (A–Z)" via a header dropdown.
- **New project** button in the header (and in the empty state).
- **Richer cards** — each card shows the project **description** (from `memory`, or "No description") and a **Created <date>** footer.
- **Per-card ⋮ kebab menu** (always visible) with **Rename** and **Delete** — replaces the bare trash icon and matches the affordance users instinctively look for.
- `RenameDialog` generalized with optional `title`/`placeholder` props (reused for project rename).

### Notes

- Verification: lint 0 errors / 27 warnings, typecheck clean, build clean, **295 tests pass** (ProjectsView tests expanded to 6: select, search, new, kebab delete, kebab rename, empty state).
- Deferred (follow-up): the cards show **Created** date — the reference's **"Updated"** timestamp needs an `updated_at` column on `projects` (a live-DB migration, user-gated).

## [4.16.1] - 2026-06-21 — Fix: project deletion from the UI

### Fixed

- **Projects could not be deleted from the UI.** The only delete control lived in `ProjectItem` (sidebar), which the current layout no longer mounts — so the Projects grid and project landing page had no delete affordance at all. Added a delete control to both surfaces, routed through a confirmation dialog.

### Added

- **Delete button on each Projects-grid card** (`ProjectsView`) — visible trash icon; clicking it requests deletion without opening the project.
- **Delete button in the project landing-page header** (`ProjectLandingPage`).
- Both route through a new **project delete-confirmation dialog** (reuses `DeleteConfirmDialog`) that names the project and warns the action cascade-deletes all of its chats, messages, and documents. Previously the (unreachable) handler deleted immediately with no confirmation.

### Notes

- Verification: lint 0 errors / 27 warnings, typecheck clean, build clean, **291 tests pass** (new: `ProjectsView` delete test).
- Housekeeping: removed an empty duplicate "Drover" project row created accidentally (the app allows two same-named projects — left as-is, no uniqueness constraint added).

## [4.16.0] - 2026-06-21 — Artifacts: edit, regenerate, versions (D2.2)

Second slice of Phase D2. No migration (uses the `artifact_versions` table from D2.1).

### Added

- **Edit** — edit an artifact's source in the workspace panel (Markdown, or JSON for sheets) and **Save version** → re-renders the file and appends a new version. `POST /api/artifacts/:id/edit`.
- **Regenerate** — an instruction box (“Ask Claude to revise…”) sends the current source + your instruction to Claude (`claude-sonnet-4-6`), which returns revised content; it's re-rendered into a new version. `POST /api/artifacts/:id/regenerate`.
- **Version history** — a Versions tab lists every version with per-version download and one-click **restore** (re-points the artifact to that version). Actions `addArtifactVersion` (transactional) + `restoreArtifactVersion`.
- Workspace panel reworked with Preview / Edit / Versions tabs; the artifact card shows `· v2` when versioned. Shared `artifactStoragePath` helper (DRY with the generate tool).

### Notes

- Verification: lint 0 errors / 27 warnings, typecheck clean, build clean, **290 tests pass** (new: version actions, edit route, edit/regenerate/restore component flows).
- Phase D2 complete (D2.1 + D2.2). Deferred: WYSIWYG binary editing, version pruning, per-message pinning.

## [4.15.0] - 2026-06-21 — Artifacts workspace (D2.1)

First slice of Phase D2. Spec `docs/specs/2026-06-21-d2-artifacts-workspace-design.md`, plan `docs/plans/2026-06-21-d2-artifacts-workspace.md`.

### Added

- **Artifact workspace panel** — clicking a generated artifact opens a right-side panel (`ArtifactWorkspace`) with an **inline preview** + download, instead of just a download card. Preview renders from the artifact's **source**: Markdown → HTML, sheets → table, PDF → exact signed-URL iframe (`ArtifactPreview`); non-PDF previews are labeled "approximate" (the binary download is exact).
- **PPTX export** — Claude can now generate PowerPoint decks (`toPptx.ts`, `pptxgenjs`; `# Heading` starts a new slide). `generate_artifact` accepts `type: 'pptx'`.
- **Source + versioning storage** — artifacts now persist their source `content` + `format`, and each create seeds an `artifact_versions` row (migration `0010`; `artifacts.current_version` + `artifact_versions` table). Foundation for D2.2 edit/regenerate. New action `getArtifactVersions`; `ArtifactSummary` gains `format`/`content`/`version`.

### Notes

- Verification: lint 0 errors / 27 warnings, typecheck clean, build clean, **282 tests pass** (new: pptx render, content/version persistence, preview + workspace components).
- **Migration `0010`** applied to live Supabase (additive: 2 columns + 1 table). Layout token `--artifact-panel-width` added.
- D2.2 (edit/regenerate/version history UI) is next.

## [4.14.1] - 2026-06-21 — Access gate: activation + docs

Operational/docs follow-up to the Phase 1 access gate (no code change — the gate shipped in v4.11.0).

### Added

- **`docs/AUTH.md`** — full guide to the access gate: how it works, how it was set up, how to activate on Vercel, rotate/disable, and when to upgrade to per-user auth (Clerk). Decision recorded: stay on the single-password gate while the app is single-user; defer Clerk + `ownerId` data-scoping to its own project.
- **CLAUDE.md env section** now documents `APP_ACCESS_PASSWORD` + `AUTH_SECRET`.

### Ops

- **Access gate ACTIVATED in production** — installed the Vercel CLI, linked the repo to `danieltsos-projects/atelier-ai` (prod alias `atelier-ai-app.vercel.app`), set `APP_ACCESS_PASSWORD` + generated `AUTH_SECRET` on Production + Preview, and redeployed. Verified live: `/` → 307→`/login`, `/api/models` → 401 unauthenticated, correct password → 200 + httpOnly cookie. Local `.env.local` seeded to match (gitignored).

## [4.14.0] - 2026-06-21 — Hardening Phase 4: Code health

Final phase of the hardening pass. Plan at `docs/plans/2026-06-21-hardening.md`.

### Changed

- **Removed dead code** — deleted the unreferenced `getAllEmbeddings`, `getEmbeddingsForChat`, `getEmbeddingsForProject` actions and the `getChatWithSummary` alias (summarize route now calls `getChatWithContext` directly).
- **Shared `messageParts` helper** — `extractText`/`messageText` (`src/lib/messageParts.ts`) replace six duplicated part-extraction snippets across `page.tsx`, the classify/memory-suggest routes, and `retrieval.ts`.
- **`toArtifactSummary`** — one row→summary mapper shared by `getChatArtifacts` + `getAllArtifacts`.
- **De-duplicated `Project`/`Chat` interfaces** — `ChatContextMenu` and `CommandPalette` now import the canonical types from `sidebar/types.ts`.
- **`typecheck` script** — `npm run typecheck` (`tsc --noEmit`) added and wired into CI before the build step.
- **Repo hygiene** — committed the brand reference (`ATELIER_BRAND_SKILL_V2.md`, cited by CLAUDE.md); gitignored local scratch (`atelier_brand_board.html`, `scripts/smoke-*.mjs`, `docs/plans/*.pdf`).

### Notes

- Verification: lint 0 errors / 27 warnings, typecheck clean, build clean, **276 tests pass**. No behavior change — pure cleanup.

## [4.13.0] - 2026-06-21 — Hardening Phase 3: Performance

Third phase of the hardening pass. Plan at `docs/plans/2026-06-21-hardening.md`.

### Performance

- **RAG critical path** (`src/lib/retrieval.ts`) — message and document retrieval branches now run **concurrently** (`Promise.all`) instead of back-to-back, overlapping their rerank Flash calls; **query-rewrite is skipped on the first turn** (nothing to resolve). Cuts time-to-first-token on project chats.
- **Parallelized independent awaits** — `/api/memory/suggest` (`getProjectContext` + pending + dismissed) and `/api/chat` (`getProjectContext` ‖ `retrieveContext`) now `Promise.all` rather than running in series.
- **Bounded `getAllArtifacts`** — selects a recent page (`limit 60`) and signs only those, instead of every artifact in the DB (was unbounded, one Storage request per row).
- **`MessagesList` re-render cost** — extracted a memoized `MessageBody`, so during streaming only the active row re-parses its markdown (prior messages skip re-render) instead of re-parsing every message on every token.
- **Index** — `idx_memory_suggestions_project_status` now includes `created_at DESC` to cover the pending-suggestions ORDER BY (migration `0009`).

### Fixed

- Stabilized the flaky exceljs render test (raised its timeout; it's CPU-heavy under parallel-worker load).

### Notes

- Verification: lint 0 errors / 27 warnings, build clean, **276 tests pass**. **Migration `0009` applied to live Supabase** (2026-06-21; index verified `(project_id, status, created_at DESC)`, `__drizzle_migrations` ledger in sync).

## [4.12.0] - 2026-06-21 — Hardening Phase 2: Robustness & correctness

Second phase of the hardening pass. Plan at `docs/plans/2026-06-21-hardening.md`.

### Fixed

- **`projects.memory` lost-update race** — `acceptSuggestion` is now a single transaction that appends in SQL (`memory || chr(10) || …`), so two concurrent accepts (or an accept racing the rail's debounced textarea save) can't clobber each other or leave the project + suggestion inconsistent. The rail also cancels its pending debounce on accept.
- **Document-replace data loss** — `/api/documents/process` now embeds the new revision **first**, then atomically swaps (delete old chunks + insert new + update row) via `commitDocumentReplacement`. A mid-flight embed/commit failure leaves the prior revision fully intact (was: old chunks deleted before new committed, leaving a "ready" doc with zero chunks).
- **`classify` wrote unvalidated LLM output** — parsed topics are now Zod-shape-checked before insert (prevents garbage/`undefined` rows from malformed model responses).
- **Auto-memory trigger** — replaced the `count % 6` gate with a monotonic per-chat delta (`count - lastSuggested >= 6`), robust to message-count jumps and overlapping `onFinish` (no missed boundaries / double-fires).
- **Artifact orphan blob** — `generate_artifact` now cleans up the uploaded object if the DB insert returns no row.
- **Unhandled rejection** — `triggerSummarization` call is now `.catch`-guarded.

### Added

- **Error boundaries** — `src/app/error.tsx` (with `reset()`), `global-error.tsx`, and `not-found.tsx` so a render error no longer blanks the single-page app.
- **`uiMessageSchema`** — shared message-shape validation replacing `z.array(z.any())` in the chat/classify/title/memory-suggest routes.

### Notes

- Verification: lint 0 errors / 27 warnings, build clean, **275 tests pass** (new: atomic-accept, replace-commit).

## [4.11.0] - 2026-06-21 — Hardening Phase 1: Security

First phase of a four-phase hardening pass (security → robustness → performance → code-health) from a full codebase audit. Plan at `docs/plans/2026-06-21-hardening.md`.

### Added

- **Lightweight access gate** — optional single-password gate over the whole app. `src/middleware.ts` requires a signed httpOnly cookie; `/login` + `POST/DELETE /api/auth` issue/clear it; `src/lib/auth.ts` does HMAC-SHA256 (Web Crypto, runtime-agnostic) + constant-time compare. **Off by default** — set `APP_ACCESS_PASSWORD` (and optional `AUTH_SECRET`) in env to activate. Closes the anonymous-access exposure on the public deployment.

### Security

- **Model allow-list** — `chat`/`classify`/`summarize`/`generate-title` now validate `model` against a `z.enum(MODEL_IDS)` (was a free `z.string()`), blocking selection of an arbitrary/expensive model (cost amplification).
- **Document-process path trust** — `/api/documents/process` no longer accepts a client `storagePath`; the replace revision path is **derived server-side** (shared `sanitizeStorageName`), so a caller can't process an arbitrary object in the private bucket. New uploads use `upsert:false`.
- **Error-detail leakage** — `apiError` no longer returns raw exception detail in production (logged server-side only); `models`/`artifacts`/`documents` routes unified onto `apiError` with try/catch.
- **Security headers** — `next.config.ts` now sends CSP, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, and HSTS (CSP scoped to the Supabase origin for images/PDF iframe).
- **Signed-URL TTL** shortened 3600s → 300s; **spreadsheet-injection** guard in `toXlsx` (cells starting with `= + - @` are escaped).

### Notes

- Verification: lint 0 errors / 27 warnings, build clean, full suite green (1 known load-timeout flake in the exceljs render test, passes isolated). New: 9 auth tests.
- **User action to activate the gate:** set `APP_ACCESS_PASSWORD` + `AUTH_SECRET` in `.env.local` + Vercel. **Browser-verify the CSP** after deploy (chat, document/PDF preview, AI images).

## [4.10.0] - 2026-06-20 — Auto-memory (suggest, you approve)

Spec at `docs/specs/2026-06-19-auto-memory-design.md`, plan at `docs/plans/2026-06-19-auto-memory.md`. Durable job facts now accrue into a project's Memory with near-zero effort, behind a human approval gate.

### Added

- **Auto-memory suggestions** — after exchanges in a **project** chat, a throttled (every 6 messages) best-effort housekeeping pass on Gemini `gemini-3.5-flash` (never Claude tokens) extracts candidate durable facts (people/roles, companies, locations, key dates, decisions) and stores them as **pending** suggestions. They surface as a **"Suggested memories (N)"** strip in the project rail's Memory section with **Accept / Edit / Dismiss**. Accepting appends to `projects.memory` (already injected into every project chat via `buildProjectPreamble`); nothing enters Memory without a click.
- **Route** `POST /api/memory/suggest` — mirrors `/api/classify` (generateText → parse → fallback). Key-guarded (returns `{ created: 0 }` with no Gemini key), **cap-gated** (no model call once ~10 suggestions are pending → `{ created: 0, capped: true }`), and dedups proposed facts against current Memory + pending + recently-dismissed (so a dismissed fact isn't re-proposed). Never surfaces as a user error.
- **Schema** — `memory_suggestions` table (migration `0008`): `id, project_id (cascade), chat_id (set null, nullable), text, status (pending|accepted|dismissed), created_at`, indexed on `(project_id, status)`. `chat_id` is SET NULL on chat delete so project-level suggestions survive.
- **Actions** — `createMemorySuggestions`, `getPendingSuggestions`, `countPendingSuggestions`, `getRecentlyDismissed`, `acceptSuggestion(id, overrideText?)` (append to Memory + mark accepted; honors an edited override), `dismissSuggestion`. **Trigger** — throttled best-effort `fetch` in `page.tsx`'s `useChat` `onFinish` (reads recent messages via `getChatMessages`, project chats only).

### Notes

- Verification: lint 0 errors / 27 warnings, build clean, **263 tests pass** (new: 6 actions, 6 route, 3 rail-strip). **Migration `0008` pending live apply** (user-gated).
- **Defaults:** 6-message cadence, ~10 pending cap.
- Design refinement vs. spec: the spec floated a "prop-tick" to live-refresh the rail; the rail only renders in the project landing view (not while a chat is open), so its mount-time fetch suffices — no tick wiring needed.

## [4.9.0] - 2026-06-19 — Document re-versioning (replace in place + retained history)

Spec at `docs/specs/2026-06-19-document-reversioning-design.md`. Construction plans/specs get revised constantly; this lets a document be **updated in place** instead of delete + re-upload.

### Added

- **Replace / Update document** — a `DocumentCard` action (beside delete) swaps a document's file for a **new revision** on the *same* record. The new revision is re-extracted → re-chunked → re-embedded and becomes the active RAG knowledge; the card shows a **"Rev N"** badge + updated date.
- **Retained revision history** — `document_revisions` table (migration `0007`) snapshots each superseded revision (filename, size, retained Storage file, etc.); `documents` gains `revision` + `updated_at`. Prior files are **kept in Storage** (no chunks) so an audit trail exists and a future restore/compare UI is additive. RAG always searches the latest revision only.
- **Pipeline** — `POST /api/documents/upload-url` gains `replaceDocumentId` (new revision path, old file untouched); `POST /api/documents/process` gains the replace path (snapshot old → delete old chunks → process new → `applyDocumentReplacement` → bump revision). `DELETE` sweeps retained revision files. New actions: `createDocumentRevision`, `deleteDocumentChunks`, `getDocumentRevisions`, `applyDocumentReplacement`. `useDocumentUpload.replace(file, documentId)`.

### Notes

- Verification: lint 0 errors / 26 warnings, build clean, **248 tests pass** (new: re-versioning actions). **Migration `0007` applied to live Supabase.** Browser-verified end-to-end: upload Rev A → Replace with Rev B → card shows Rev 2, `documents` at revision 2 (new path), Rev 1 retained in `document_revisions`; delete sweeps both.
- **Known:** the project capacity meter counts current revisions only (retained files aren't counted) — accepted on Supabase Pro; a revision-aware meter is a deferred follow-up. No retention/pruning policy yet.

## [4.8.0] - 2026-06-19 — Persona system v2 (adaptive thinking + effort) + construction quick actions

Specs at `docs/specs/2026-06-19-persona-system-v2-design.md` and `docs/specs/2026-06-19-quick-actions-file-flow-clarity-design.md`.

### Added

- **Unified persona system** (`src/hooks/usePersonas.ts`) — collapsed the two-tier "Personas" + "Model + Persona" model into **one flat list** where every persona carries **prompt + model + effort**. `Persona.effort?: 'low'|'medium'|'high'|'max'`; `modelShortLabel`/`effortLabel` helpers. Roster (9): General Assistant (default), Coding, Code Review, Deep Analysis, Creative Writing, Brief, Teacher, plus new **🏗️ Construction Pro** and **📐 Plan & Spec Reader**. Dropped the duplicates (Debug Mode, Quick Code Help, the regular Coding/Creative).
- **Default = General Assistant · Sonnet 4.6 · Medium effort.** Fresh chats seed the model from the default persona (live `default-model` setting aligned to `claude-sonnet-4-6`).
- **Adaptive thinking + effort on Claude** — `createProvider(modelName, effort?)` sets `providerOptions.anthropic = { thinking: { type: 'adaptive' }, effort }`. **Effort omitted for `claude-haiku-*`** (the API 400s on Haiku). `chatRequestSchema.effort` enum; effort flows client → chat body → provider. (Corrects the stale "no thinking config" note — AI SDK v6 supports both.)
- **Composer effort pill** (`src/components/ui/EffortPill.tsx`) — Low/Med/High/Max selector that defaults to the active persona's effort and overrides per-chat; hidden for Haiku/image models. Plus a flat-list `PersonaSelector` with `model · effort` chips that set model+effort on select.
- **Construction quick actions** (`src/components/chat/QuickActions.tsx`) — Home chips are now **New project · Add documents · Draft RFI · 3-week look-ahead** (replaced placeholder Write/Code). **Add documents is project-aware**: opens the project's docs dialog when a project is active, else routes to the Projects view (no more silent no-op on Home).
- **File-flow clarity** — persistent project knowledge ("Add documents" / project Files, RAG) vs per-message input: the composer **Attach** tooltip now reads "Attach to this message".

### Notes

- Verification: lint 0 errors / 26 warnings, build clean, **247 tests pass** (new: providers effort + Haiku guard, usePersonas v2, PersonaSelector, updated QuickActions). Browser-verified: flat persona list + chips, default General Assistant/Sonnet/Medium, effort pill, Brief-on-Haiku omits effort, project-aware Add documents.
- No DB migration — personas are code/localStorage; chats match personas by prompt (unmatched → "Custom").
- Informed by a comparison of Claude Projects / ChatGPT Projects+GPTs / Gemini Gems: the app's three-layer model (Personas = behavior · Projects = knowledge+memory+instructions · Attach = per-message) matches industry best practice.

## [4.7.0] - 2026-06-19 — Claude.ai-style layout

Spec at `docs/specs/2026-06-18-claude-ai-layout-design.md`; plans at `docs/plans/2026-06-18-claude-ai-layout-slice1-shell-home.md`, `…-slice2-context-rail.md`, `docs/plans/2026-06-19-claude-ai-layout-slice3-artifacts-displayname.md`. Restyles three surfaces to the Claude.ai layout on the existing Atelier brand. Built in three verified slices.

### Added

- **Home screen** — centered time-of-day greeting (`HomeGreeting` + `greetingForHour`), centered composer, and quick-action chips (`QuickActions`: New project / Upload / Write / Code). Greeting reads a **display name** from settings ("Good morning, Daniel").
- **Claude.ai sidebar** — `SidebarNav` (New chat · Projects · Artifacts · Customize) + flat `RecentsSection`; `Sidebar` rebuilt. New `AppView` view-router (`home` | `projects` | `artifacts`) via `selectView`/`activeView` on `SidebarActions`. New `ProjectsView` grid and `ArtifactsView`.
- **Project context rail (3-pane)** — `ProjectContextRail` with editable, debounced-save **Memory** + **Instructions** and a **Files** section (`DocumentCard` grid moved in) with a **capacity bar** (`CapacityBar`, `PROJECT_CAPACITY_BYTES` default 2 GB, env-overridable). `ProjectLandingPage` refactored to chats-column + rail (keyed per project).
- **Functional Memory + Instructions** — `projects.memory` + `projects.instructions` columns (migration `0006`, applied live); `updateProjectContext`/`getProjectContext` actions; the chat route prepends them to the system prompt via `buildProjectPreamble` so they steer every chat in the project.
- **Artifacts list** — `getAllArtifacts` action; `ArtifactsView` renders the real grid of generated artifacts (reuses `ArtifactCard`) with signed download links.
- **Display name** — non-sensitive `display-name` setting; editable in Settings → Appearance; drives the home greeting.
- **Layout tokens** — `--sidebar-width`, `--rail-width`, `--thread-max-width` in `globals.css` (structure/theme separated). Responsive off-canvas sidebar on narrow widths.

### Fixed

- **Project-view race crash** — guarded the `ProjectLandingPage` render until the `projects` list has loaded (restored `activeProjectId` no longer dereferences an undefined project).

### Notes

- Verification: lint 0 errors / 30 warnings (baseline), build clean, **242 tests pass** (+27 across the three slices). Migration `0006` is additive + nullable, applied to live Supabase. Browser-verified: home greeting with name, sidebar view routing, 3-pane rail with live Memory persistence + capacity bar, Artifacts list with downloads.
- Out of scope (Claude.ai products, not layout): Cowork/Code tabs, Google integrations, share chip, full D2 artifact preview panel.

## [4.6.0] - 2026-06-17 — Phase D1: artifact engine — Claude-generated downloadable XLSX/DOCX/PDF

Spec at `docs/specs/2026-06-17-phase-d1-artifact-engine-design.md`; plan at `docs/plans/2026-06-17-phase-d1-artifact-engine.md`.

### Added

- **`generate_artifact` tool** (`src/lib/artifacts/tool.ts`) — AI SDK v6 `tool()` definition wired into `POST /api/chat` for Claude models when a `chatId` is present and Storage is configured. Claude calls it with `{ type: 'xlsx'|'docx'|'pdf', title, format: 'markdown'|'sheets', content }`; `execute` renders the file, uploads to `artifacts/<projectId|standalone>/<id>/<slug>.<ext>` in the `atelier-files` bucket, persists an `artifacts` row, and returns `{ artifactId, title, type, downloadUrl }`.
- **Renderers** (`src/lib/artifacts/`): `toXlsx.ts` (exceljs), `toDocx.ts` (docx; Markdown → headings/paragraphs/bullets), `toPdf.ts` (pdf-lib; Markdown → clean wrapped-text PDF), dispatched by `render.ts` `renderArtifact(type, title, content)`. Types in `types.ts` (`ArtifactType`, `SheetSpec`, `RenderedArtifact`).
- **`artifacts` table** — migration `drizzle/0005_lyrical_onslaught.sql`: `id, chat_id, project_id, type, title, storage_path, status, error_message, created_at` + index on `chat_id`. Applied to live Supabase.
- **Server actions**: `createArtifact`, `getArtifactById`, `getChatArtifacts` (rows + signed `downloadUrl`), `updateArtifactStoragePath`, `deleteArtifact` in `src/app/actions.ts`.
- **`GET /api/artifacts?chatId=`** — returns all chat artifacts with short-lived signed `downloadUrl`. **`DELETE /api/artifacts?id=`** — removes the Storage object then the row (`src/app/api/artifacts/route.ts`).
- **`ArtifactSummary` type** in `src/types.ts`; **`ArtifactCard`** (`src/components/chat/ArtifactCard.tsx`) — icon by type, title, type label, Download link. Rendered by `MessagesList` (new `artifacts?` prop).
- **Client load + re-fetch** in `page.tsx`: artifacts fetched from `/api/artifacts?chatId=` on chat open and re-fetched after each assistant response.
- **New deps**: `docx`, `pdf-lib` (pure-JS). `exceljs` already present.

### Notes

- Verification: lint 0 errors / 30 warnings (baseline — zero new), build clean, full suite **215 tests pass** (new: 4 render, 2 tool, 2 actions, 2 route, 2 ArtifactCard).
- Migration `0005` applied to live Supabase. Migrations `0000`–`0005` are current.
- Artifacts are keyed by chat; per-message pinning is D2. **D2 next: artifact workspace panel, live preview, versioning, edit/regenerate, PPTX.**
- Chat-driven live smoke (ask Claude to generate a schedule) is best done in-browser with the real Anthropic key + Storage configured.

### Deployment & release (2026-06-18)

Tagged and released as **v4.6.0** — the production-readiness milestone for Phases A→D1.

- **Supabase live:** project `evhgyudnjyryayazupgh`, migrations `0000`–`0005` applied. **RLS enabled on all 11 public tables** (the app connects as the `postgres` table owner, which bypasses RLS; the anon key is used only for Storage uploads).
- **D1 artifact smoke PASSED live:** a real Claude `generate_artifact` tool call rendered a valid `.xlsx` (6492 bytes), stored it, and produced a working signed download URL — the engine works end-to-end against live Supabase Storage.
- **Vercel env configured:** all 8 runtime vars set for **Production + Preview** (`DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`). Stored as Sensitive type — verify by presence (`vercel env ls`), not value (`vercel env pull` cannot read sensitive values back).
- **Production cutover held:** released/tagged on `phase-c-extraction`; `master` is **not** yet merged. The one open risk is whether `@napi-rs/canvas` (native PDF render for thumbnails/vision) loads on Vercel's Linux runtime — validate on a Preview deploy first (upload a PDF, confirm a thumbnail renders), then merge `phase-c-extraction` → `master` for the production deploy. Thumbnails are best-effort and degrade gracefully if it fails.

## [4.5.0] - 2026-06-17 — Phase C3: documents UI — thumbnail cards, tabbed preview, extraction badge

Spec at `docs/specs/2026-06-17-phase-c3-documents-ui-design.md`; plan at `docs/plans/2026-06-17-phase-c3-documents-ui.md`. **This release closes Phase C (C2 + C-storage + C3).**

### Added

- **`src/components/chat/DocumentCard.tsx`** — shared thumbnail card component. Renders the signed `thumbnailUrl` (WebP first-page thumbnail from Storage) with a file-type-tile fallback for text/code/docx/xlsx. Shows filename, status icon (spinners for `uploading`/`processing`; check for `ready`; alert for `error`), chunk count, hover-to-reveal delete, and a `vision` chip when `extractionMethod === 'vision'`. Clicking the card opens `DocumentPreviewDialog`.
- **`src/hooks/useDocumentUpload.ts`** — shared 3-step upload hook used by both document surfaces (request upload-url → `uploadToSignedUrl` → process). Centralises progress/error state; both surfaces now accept images (png/jpg/jpeg/webp) in addition to PDF/DOCX/XLSX.
- **Tabbed `DocumentPreviewDialog`** — two tabs: "Preview" renders the original file inline (images directly; PDFs via `<iframe>` on the signed `url`; docx/text show text-only); "Extracted text" reconstructs chunks (existing behaviour). An "Open original" link is always present. Preview tab is only rendered for visual originals (image/* or pdf).
- **`DocumentStatus` + `DocumentSummary` types** in `src/types.ts` — canonical document shape shared across `ProjectDocumentsDialog`, `ProjectLandingPage`, and `DocumentCard`, replacing three formerly duplicated local `Document` interfaces.
- **`documents.extraction_method` column** — migration `drizzle/0004_sudden_ben_grimm.sql` adds `extraction_method text` (nullable) to the `documents` table. `/api/documents/process` records `'text'` or `'vision'`; `GET /api/documents` returns it; `DocumentCard` displays it as a badge.

### Changed

- **`ProjectDocumentsDialog`** and **`ProjectLandingPage`** both migrated to `DocumentCard` grid + `useDocumentUpload`; now accept image uploads.
- **`updateDocumentStatus` server action** — accepts the new optional `extractionMethod` parameter.
- Migration `0004` applied to the live Supabase project.

### Fixed

- **Project landing-page uploader regression** — `ProjectLandingPage` was still POSTing to the retired inline `/api/documents` endpoint (broken since C-storage Stage 1). Switching to `useDocumentUpload` restores drag-drop upload from the project Files panel.

### Notes

- Verification: lint 0 errors / 30 warnings (baseline — zero new), build clean, full Vitest + Playwright suite **203 tests pass** (new: 2 hook, 5 DocumentCard, 2 preview dialog, 2 process-method tests).
- **Phase C is complete.** Next up: **Phase D (Artifacts)** — Claude-style artifact panel with versioned previews and export to PDF/DOCX/XLSX/PPTX. See `docs/SESSION_HANDOFF.md` for scope.

## [4.4.0] - 2026-06-14 — Phase C-storage Stage 2: chat attachments to Storage

Spec at `docs/specs/2026-06-14-phase-c-storage-design.md`; plan at `docs/plans/2026-06-14-phase-c-storage-stage2-attachments.md`.

### Added

- **Dual-write in `saveMessageAttachments`**: when Storage is configured, decodes the base64 data URL and uploads attachment bytes to `attachments/<chatId>/<messageId>/<i>-<filename>` in the private Supabase Storage bucket; stores `storage_path` with `data_url` null. When Storage is NOT configured, falls back to the base64 `data_url` column — chat image attach keeps working with no Storage configured (graceful degradation; unlike documents, which require Storage).
- **Dual-read in `getChatAttachments`**: returns `{ messageId, mediaType, filename, url }` where `url` is a short-lived signed Storage URL for `storage_path` rows, or the legacy `data_url` for old rows. No backfill of old rows — they read unchanged.
- **Delete cleanup**: `deleteChat` and `deleteMessage` remove relevant Storage objects best-effort before the DB cascade delete.
- **Schema migration `drizzle/0003_superb_roughhouse.sql`**: adds `storage_path text` (nullable) to `message_attachments`; makes `data_url` nullable (was NOT NULL). One or the other column is populated per row.
- **Client read-path (`page.tsx` `loadMessages`)**: resolves `att.url` (signed URL or legacy data URL) when building `file` parts; skips any that fail to resolve. No UI change — `MessagesList` and the lightbox already consume a URL string.

### Changed

- `message_attachments.data_url` is now nullable (migration `0003`). Existing rows are unaffected (they retain their base64 value).

### Notes

- Reuses Stage 1's `src/lib/storage.ts` and all `SUPABASE_*` / `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_STORAGE_BUCKET` env vars — no new env vars.
- **Pending USER action:** run `DIRECT_URL=… npx drizzle-kit migrate` to apply migration `0003`.
- **Known deferral:** deleting a whole **project** cascades `message_attachments` rows via FK but does NOT sweep their Storage objects — consistent with Stage 1's orphan-sweep deferral.
- C-storage is now **complete** (Stage 1: documents; Stage 2: attachments). Next sub-phase is **C3 (UI)**.

## [4.3.0] - 2026-06-14 — Phase C-storage Stage 1: document storage

Spec at `docs/specs/2026-06-14-phase-c-storage-design.md`; plan at `docs/plans/2026-06-14-phase-c-storage-stage1-documents.md`.

### Added

- **`src/lib/storage.ts`** (server-only): Supabase Storage wrapper using `@supabase/supabase-js` (Storage API only; DB stays on Drizzle). Exports `isStorageConfigured`, `createSignedUploadUrl`, `uploadBuffer`, `downloadToBuffer`, `createSignedDownloadUrl`, `removeObjects`, `storageBucketName`. Reads `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (service-role key never sent to client). Bucket name from `SUPABASE_STORAGE_BUCKET` (default `atelier-files`), private.
- **`src/lib/thumbnails.ts`**: `generatePdfThumbnail` (renders page 1 at scale 1) and `generateImageThumbnail` (downscale), both → WebP at `THUMBNAIL_WIDTH` (default 600px) via `@napi-rs/canvas`. Best-effort; failures are non-fatal.
- **`src/lib/storageClient.ts`** (browser): anon-key Supabase client for `uploadToSignedUrl`. Uses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
- **3-step direct-upload flow** replacing the old inline `POST /api/documents`:
  1. `POST /api/documents/upload-url` — validates name/type/size, creates a `documents` row with status `uploading`, returns `{documentId, path, token, bucket}`.
  2. Browser `uploadToSignedUrl` — file goes straight to Supabase Storage, bypassing the Vercel function request-body limit (large construction plans now work).
  3. `POST /api/documents/process` `{documentId}` — downloads from Storage, runs the C2 extract pipeline (text / thin-PDF vision fallback / image vision), uploads thumbnail, chunks + embeds, sets status `processing` → `ready | error`.
- **Document originals + thumbnails persisted** in private Supabase Storage; paths recorded in `documents.storage_path` + `documents.thumbnail_path`.
- **`GET /api/documents`** returns short-lived signed `url` (original) + `thumbnailUrl` (best-effort, `null` if absent). **`DELETE /api/documents`** removes Storage objects (original + thumbnail) before deleting the row.
- **New server actions**: `createUploadingDocument`, `updateDocumentStoragePath`, `getDocumentById`; `updateDocumentStatus` widened (added `uploading`/`processing` to status union + accepts `charCount`/`thumbnailPath`); `deleteDocument` now returns the deleted row.
- **Schema migration `drizzle/0002_left_patriot.sql`**: adds `storage_path` and `thumbnail_path` columns to `documents`; `status` enum extended with `uploading` and `processing`.
- **New env vars**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server-only), `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (browser), `SUPABASE_STORAGE_BUCKET` (default `atelier-files`), `THUMBNAIL_WIDTH` (default 600).

### Changed

- **Old inline `POST /api/documents`** (extract → chunk → embed in one function body) retired. Replaced by the 3-step flow above.
- **`createDocument` server action** retired; superseded by `createUploadingDocument`.

### Notes

- **Pending USER actions before this ships:**
  1. Create a **private** Supabase Storage bucket named `atelier-files` (or set `SUPABASE_STORAGE_BUCKET`).
  2. Add the four Supabase Storage env vars to `.env.local` and the Vercel dashboard.
  3. Run `DIRECT_URL=… npx drizzle-kit migrate` to apply migration `0002`.
- **Stage 2 (chat-attachment migration off base64 → Storage) not done** — its own brainstorm→spec→plan follows.
- **Live-Storage smoke** (UI upload end-to-end with real Supabase bucket) not yet run; unit tests use mocked storage; build and Vitest suite are green locally.

## [4.2.0] - 2026-06-07 — Phase C2: Vision extraction

Spec at `docs/specs/2026-06-07-phase-c-construction-extraction-design.md`; plan at `docs/plans/2026-06-07-phase-c2-vision-extraction.md`.

### Added

- **Vision-extraction module** (`src/lib/visionExtraction.ts`) with two entry points: `extractViaVision(buffer)` renders each PDF page (pdfjs-dist@5 *legacy* build + `@napi-rs/canvas`, scale 3) and sends each page image to Gemini Flash (`generateText`, image content part `{ type: 'image', image: Uint8Array }`), best-effort per page (page failure is logged and skipped), capped at `EXTRACTION_MAX_PAGES`; `extractViaVisionImage(buffer, mimeType)` vision-extracts a single uploaded image. Both return `''` if no Gemini key (graceful degradation).
- **Image-upload support in `/api/documents`**: PNG/JPG/JPEG/WEBP by extension, or any `image/*` MIME type, are routed directly to `extractViaVisionImage`. The upload guard was broadened to accept images (they intentionally remain outside the shared `isSupported` list — see Changed).
- **Vision fallback for thin-text PDFs**: after standard text extraction via `unpdf`, if the result is shorter than `EXTRACTION_MIN_TEXT_CHARS` (default 100) the route falls back to `extractViaVision`; the vision result is used if it yields more text. All other files continue through `extractTextFromBuffer` unchanged. Downstream chunk → embed → pgvector RAG pipeline is untouched.
- **`isImageExtension(ext)` helper** in `src/lib/fileExtraction.ts` and `IMAGE_EXTENSIONS` set for opt-in image acceptance per route.
- **`EXTRACTION_*` env knobs** (read in `visionExtraction.ts`): `EXTRACTION_MODEL` (default `gemini-3.5-flash`), `EXTRACTION_MAX_PAGES` (default `30`), `EXTRACTION_RENDER_SCALE` (default `3`), `EXTRACTION_MAX_OUTPUT_TOKENS` (default `8000`); `EXTRACTION_MIN_TEXT_CHARS` (default `100`, read in the documents route).
- **Tests**: `tests/unit/lib/visionExtraction.test.ts` (5 tests), `tests/unit/api/documents-route.test.ts` (3 tests). Full API suite: 39 tests green.

### Changed

- **Images intentionally excluded from shared `SUPPORTED_EXTENSIONS`/`isSupported`**: the shared `/api/extract` text extractor has no image handling and would emit garbage — image acceptance is localized to `/api/documents` only. A prior spike that widened `isSupported` globally was caught and reverted before merge.
- **`pdfjs-dist@^5.7.284` and `@napi-rs/canvas@^0.1.100` promoted from devDependencies to dependencies** (they now run at request time, not only in tests). pdfjs-dist v5 *legacy* build (`pdfjs-dist/legacy/build/pdf.mjs`) is required; v6 breaks the API. `@napi-rs/canvas` 0.1.x is the verified compatible series.

### Notes

- **Unverified deploy risk**: whether native `@napi-rs/canvas` builds/runs on Vercel Fluid Compute has not yet been confirmed (Task 6). Documented fallback is client-side pdf.js rendering if the native canvas module is unavailable.
- Page extraction is sequential (one page at a time) — rate-limit-safe and bounded by `EXTRACTION_MAX_PAGES`. Bounded concurrency is a later optimization if throughput becomes a bottleneck.
- Spike-validated: `gemini-3.5-flash` (not a reasoning-heavy pro model) reads real IFC construction plans well.

## [4.1.0] - 2026-06-07 — Phase B2: Advanced RAG

Spec at `docs/specs/2026-06-07-phase-b2-advanced-rag-design.md`; plan at `docs/plans/2026-06-07-phase-b2-advanced-rag.md`.

### Added

- **Multi-stage retrieval pipeline** (`src/lib/retrieval.ts` `retrieveContext()`): query-rewrite → vector top-N → MMR diversity → LLM rerank → top-k. New modules: `ragConfig.ts`, `queryRewrite.ts`, `rerank.ts`, `mmr.ts`. Query-rewrite resolves follow-up pronouns into standalone search queries; MMR removes near-duplicate (overlapping) chunks; rerank re-scores candidates for precision. Rewrite + rerank run on in-stack Gemini Flash via the proven `generateText`+parse+fallback pattern.
- **Tunable RAG config** (`ragConfig.ts`) with env overrides + sane defaults: `RAG_DOC_THRESHOLD`, `RAG_MSG_THRESHOLD`, `RAG_TOP_N`, `RAG_DOC_TOP_K`, `RAG_MSG_TOP_K`, `RAG_MMR_LAMBDA`, and per-stage toggles `RAG_REWRITE_ENABLED`/`RAG_RERANK_ENABLED`/`RAG_MMR_ENABLED`.

### Changed

- **Every retrieval stage is best-effort and degrades to the prior stage** — with all toggles off the pipeline reduces to plain pgvector top-k, so it can never retrieve worse than before. The chat route's inline retrieval block is replaced by a single `retrieveContext()` call.
- **Test suite ~40s → ~15s**: `tests/helpers/test-db.ts` now reuses one PGlite instance per worker and `TRUNCATE … RESTART IDENTITY CASCADE`s between tests instead of recreating Postgres each time.

### Notes

- Rewrite + rerank add two Gemini Flash calls per message (~1–2s latency) — toggle off via env. Thresholds ship as configurable defaults (not data-tuned) since real construction-doc usage hasn't happened yet.

## [4.0.0] - 2026-06-07 — Phase B: Supabase Postgres + pgvector

Phase 2 of the workhorse program. Spec at `docs/specs/2026-06-07-phase-b-supabase-pgvector-design.md`; plan at `docs/plans/2026-06-07-phase-b-supabase-pgvector.md`.

### Changed (Breaking)

- **Data layer migrated from libSQL/SQLite (Turso) to Supabase Postgres.** Drizzle moved from `sqlite-core` to `pg-core` on the `postgres-js` driver (pooled `DATABASE_URL` with `prepare:false` at runtime; `DIRECT_URL` for migrations). All 10 tables ported with integer `GENERATED ALWAYS AS IDENTITY` PKs, `timestamptz`, `boolean`, and native FK cascade. **Fresh start — no data migrated.** `@libsql/client` removed; `TURSO_*` env vars replaced by `DATABASE_URL` + `DIRECT_URL`.
- **RAG retrieval is now native pgvector.** The two `embedding` columns are `vector(768)` with **HNSW** (`vector_cosine_ops`) indexes. `findSimilarMessages`/`findSimilarDocumentChunks` run one indexed SQL query each via Drizzle `cosineDistance` (`1 - (embedding <=> query) > threshold`), replacing the brute-force "load every vector and loop in JS" path. Public signatures unchanged, so the chat context pipeline is untouched. Embeddings still generated by Gemini `gemini-embedding-001`.
- **Versioned Drizzle migrations introduced** (`drizzle/`): `0000_enable_vector.sql` (`CREATE EXTENSION vector`) + `0001_init_schema.sql`. `drizzle-kit push` workflow replaced by `generate` + `migrate`.

### Added

- **PGlite test harness.** `tests/helpers/test-db.ts` runs an in-process Postgres (`@electric-sql/pglite`, pinned `^0.4.6`) with the `vector` extension and applies the real migrations — CI stays secret-free. New `tests/unit/db/harness.test.ts` + `tests/unit/db/vector-search.test.ts` (pgvector ordering/threshold/scoping).

### Notes

- Reranking/MMR/query-rewriting deferred to **Phase B2**. Test suite is slower (~40s) because PGlite provisions a fresh Postgres per test — a shared-instance optimization is a possible future nicety.

## [3.0.0] - 2026-06-07 — Phase A: Claude provider

First of a four-phase program (A: Claude provider · B: RAG upgrade · C: construction plan/image extraction · D: Excel/Word artifacts). Design spec at `docs/specs/2026-06-07-phase-a-claude-provider-design.md`; plan at `docs/plans/2026-06-07-phase-a-claude-provider.md`.

### Added (Breaking)

- **Claude is now the primary chat provider** via `@ai-sdk/anthropic`. Picker offers **Claude Opus 4.8** (`claude-opus-4-8`, default), **Sonnet 4.6** (`claude-sonnet-4-6`), and **Haiku 4.5** (`claude-haiku-4-5`). Claude text models have **web search** enabled (`anthropic.tools.webSearch_20250305`). New `getAnthropicApiKey()` (DB-first, env `ANTHROPIC_API_KEY`); `anthropic-api-key` added to the sensitive-key read block.
- **API Keys settings tab.** New Settings → API Keys tab to view configured status and set the Gemini + Anthropic keys in-app (`getApiKeyStatus()` returns booleans only; inputs are write-only/password). Previously keys were `.env.local`-only.

### Changed (Breaking)

- **Gemini text models retired from the picker.** Only the Gemini **image** model (Nano Banana 2) remains user-selectable. Gemini still powers **embeddings** (`gemini-embedding-001`) and image generation under the hood — Anthropic has no embeddings API, so the RAG pipeline is unchanged. The Deep Think virtual model and per-level thinking handling were removed from `createProvider`.
- **Persona "Model + Persona" combos repointed to Claude**: Code Review → Opus 4.8, Creative Writing → Sonnet 4.6, Quick Code Help → Haiku 4.5, Deep Analysis → Opus 4.8, General Assistant → Sonnet 4.6. `modelShortLabel`/`MODEL_SHORT_LABELS` updated to the Claude lineup.
- **Housekeeping pinned to Gemini Flash.** `title` / `summarize` / `classify` always run on the internal `gemini-3.5-flash` regardless of the chat model — cheap, fast, no Claude tokens on background tasks.
- **Default chat-model fallback** moved from `gemini-3.5-flash` to `claude-opus-4-8`.

### Notes

- **Thinking config deferred.** Opus 4.8 rejects `budget_tokens` (the only thinking knob AI SDK v6 exposes), so Claude ships without an explicit thinking config; adaptive thinking is a future follow-up.

## [2.1.0] - 2026-06-07

### Changed

- **Personas / "Model + Persona" combos refreshed for the Gemini-only lineup.** The **Deep Analysis** combo now uses the **Deep Think** model (`gemini-3.1-pro-preview-deep-think`). All five combos pair a current model: Code Review → 3.1 Pro, Creative Writing → 3.5 Flash, Quick Code Help → 3.5 Flash, Deep Analysis → Deep Think, General Assistant → 3.5 Flash.
- **Persona selector now shows the paired model.** The "Model + Persona" section displays a model-name chip (e.g. `3.1 Pro`, `Deep Think`) and the project-defaults picker labels combos with their model — replacing the now-meaningless "Cloud" badge.

### Removed

- **Dropped the stale `modelConstraint: 'cloud' | 'any'` persona field** (a leftover from when local models were a possibility) in favour of a clear `isCombo` flag. Added a `modelShortLabel()` helper for friendly model names.

## [2.0.0] - 2026-06-07

### Removed (Breaking)

- **Alibaba Cloud Qwen / DashScope provider removed entirely.** The app is now Google Gemini only. Dropped the Qwen branch and `DASHSCOPE_BASE_URL` from `createProvider`, the `getDashScopeApiKey` helper, the `dashscope-api-key` sensitive-key guard, the Qwen option groups in both model selectors, the `DASHSCOPE_API_KEY` env var, and the `@ai-sdk/openai` dependency (it was used only for DashScope). Existing chats created with a Qwen model will need a Gemini model selected to continue.

### Changed (Breaking)

- **Gemini model list updated to the current lineup, with the latest GA IDs.** Two of the previous IDs were dead: `gemini-3.1-flash-lite-preview` was shut down and `gemini-3.1-flash-image-preview` is deprecated (shutdown 2026-06-25). New curated list: **Gemini 3.5 Flash** (`gemini-3.5-flash`, now the default), **Gemini 3.1 Pro** (`gemini-3.1-pro-preview`), **Gemini 3.1 Deep Think** (virtual → Pro at high thinking), **Gemini 3.1 Flash-Lite** (`gemini-3.1-flash-lite`), and **Nano Banana 2** (`gemini-3.1-flash-image`). Default model fallback across the chat/summarize/classify/generate-title routes and the built-in personas moved from `gemini-3-flash-preview` to `gemini-3.5-flash`.
- **Per-level thinking variants dropped.** The `-think-{minimal|low|medium|high}` model entries and the model-selector "thinking level" strip were removed; the corresponding virtual-model handling in `createProvider` and `ModelSelect` is gone. Deep Think (high reasoning) remains as its own selectable model.

## [1.10.0] - 2026-06-07

### Added

- **Excel (`.xlsx`) upload support.** Spreadsheets can now be attached in chat and added to project documents, alongside PDF and Word. Extraction (via `exceljs`) emits one tab-separated block per worksheet (prefixed `# Sheet: <name>`), with a cell formatter that flattens dates (→ ISO date), formulas (→ cached result), rich text, and hyperlinks. Wired into the extraction allow-list, both file pickers' `accept` filters, and the attachment type label. Covered by new unit tests.

### Changed

- **Clearer extraction errors on the chat attachment path.** `POST /api/extract` now surfaces the real failure reason (oversized body, encrypted PDF, etc.) instead of a generic "Failed to extract text from file." toast — matching the behaviour added for project documents in v1.9.1.

## [1.9.1] - 2026-06-07

### Fixed

- **File drag-and-drop in the chat input.** Dropping a file onto the chat box flickered and the browser fell back to opening/downloading the file instead of attaching it. Root causes: the drop overlay rendered without `pointer-events-none` (stealing drag events from its container) and the `isDragOver` boolean toggled on every child-boundary crossing, producing a mount/unmount flicker loop; and there was no window-level guard, so a drop landing just outside the input `div` hit the browser's default file handler. Fixed with a drag-depth counter (state flips only on true enter/leave), a `dragenter` handler, `pointer-events-none` on the overlay, a `Files`-type check to ignore text drags, and a window-level `dragover`/`drop` `preventDefault`.
- **Opaque document-upload failures.** Project document uploads surfaced a generic "Failed to process document." toast that hid the real cause. `apiError()` now takes an optional `includeDetail` flag and the documents route opts in, so the toast reports the actual reason (oversized body, encrypted PDF, etc.).

### Build

- Pinned the Turbopack `root` to the project directory to silence workspace-root inference warnings.

## [1.9.0] - 2026-04-15

### Atelier Studio Rebrand

Full visual + verbal rebrand under the **Atelier Technologies, Inc.** master brand. Product renamed from _Atelier AI_ to **Atelier Studio**. Light-first, executive-grade, calm palette — glassmorphism retired.

#### Brand identity
- **Product name:** Atelier AI → Atelier Studio. User-facing strings updated across landing, sidebar, metadata, and docs. Repo / Vercel slugs unchanged (tracked separately).
- **Copy voice:** README tagline + vision and empty-state CTA rewritten to the Atelier voice (calm, direct, evidence-focused). Removed "all-in-one", "focus on what matters", "decision fatigue", "get started immediately".
- **Metadata:** `<title>` and `<meta description>` updated.

#### Design system
- **New palette:** Atelier Navy `#1F3447`, Steel Blue `#4F7396`, Ink `#16202A`, Canvas Light `#F7F6F2`, Pure Surface `#FFFFFF`, Warm Sand `#D9CFBF`, Stone Sage `#8C9A86`, Soft Mist `#F3F1EC`, Muted Line `#E3DDD2`, Slate Text `#6F7781`, plus Success / Warning. Exposed as Tailwind utilities.
- **Semantic tokens remapped:** `primary` = Steel Blue (CTAs), `background` = Canvas Light, `foreground` = Ink, `border` = Muted Line, `accent`/`secondary`/`muted` = Soft Mist, `ring` = Steel Blue.
- **Default theme is now `light`** (brand is light-first). Dark mode retained and re-themed around Ink with Steel Blue accents.
- **`.glass-panel` redefined** as a light modular card (Pure Surface, Muted Line border, soft layered shadow). Same class name; all 16 consumers migrated automatically without per-file edits. Zero `backdrop-blur` / `bg-background/60` dark-translucent glass remains.

#### Component cleanup
- **Landing:** dropped blue→purple gradient heading; solid `text-foreground` instead.
- **Sidebar cluster** (`SidebarHeader`, `CollapsedSidebar`, `Sidebar`, `SmartChatMenu`, `ArchivedSection`, `SidebarFooter`): replaced `bg-white/X`, `border-white/X`, `via-white/X` opacity patterns with semantic tokens (`bg-accent`, `border-border`, `bg-border`). Removed inline `borderImage` rgba gradient.
- **Error banner:** raw red-500 scale → `destructive` token.
- **Archive chip:** amber utilities → Stone Sage icon + Warm Sand badge.
- **Settings icon hover:** `text-blue-400` → `text-primary`.

#### Docs
- **CLAUDE.md:** rewrote the Styling section to document the Atelier brand system, token hierarchy, and forbidden patterns (no blue→purple gradients, no `white/X` utilities).
- **README / TECH_STACKS / PLAN:** copy + tech-stack descriptions updated to reflect the brand system (glassmorphism references removed except in the Phase 4 historical record).

#### Out of scope (inherited tokens; deferred to a later pass)
- Message bubbles, settings dialog, command palette, chat input area — render correctly on the new palette via inherited tokens but not hand-tuned.

## [1.5.0] - 2026-03-19

### Bug Fixes
- **Image Persistence:** AI-generated images now persist across page refreshes (`await` added to `saveMessageAttachments` in `onFinish` callback). Also increased Next.js server action body size limit from 1MB to 10MB — Gemini-generated base64 images exceed the default limit.
- **Lightbox Escape Key:** Fixed unreliable Escape key handling by using `window` event listener instead of `onKeyDown` on unfocused div.
- **Invalid Model IDs:** Fixed `gemini-2.0-flash` (nonexistent) in summarize, generate-title, and classify routes → `gemini-3-flash-preview`.
- **Classify Message Format:** Fixed classification reading `m.text` instead of SDK v6 `m.parts[]` — classification was always getting empty context.
- **Chunking Infinite Loop:** Fixed broken loop guard that compared char positions to array indices. Now tracks forward progress correctly.

### Security
- **Image Size Limit:** Added 10MB cap on image uploads in `fileToAttachedImage()`.
- **Filename Sanitization:** `buildFileMessage()` now sanitizes filenames to prevent HTML comment injection.
- **Modern Image Formats:** Added `image/avif`, `image/heic`, `image/svg+xml` to recognized MIME types.

### Performance
- **Settings Caching:** `getServerSetting()` now caches results for 5 minutes (3+ fewer DB queries per chat request). Cache clears automatically when settings are saved.
- **Embedding Provider Caching:** `ensureEmbeddingModel()` caches availability for 5 minutes (no more 1s network probe per request).
- **Parallel Document Embedding:** Document chunks are now embedded concurrently via `Promise.allSettled()` instead of serially.
- **Embedding Failure Tracking:** Documents with all chunks failing to embed are marked `'error'` instead of `'ready'`.

### Data Integrity
- **UNIQUE constraint on `messageEmbeddings.messageId`:** Prevents duplicate embeddings per message.
- **UNIQUE index on `chatTopics(chatId, topic)`:** Prevents duplicate topic entries per chat.
- **Vector Dimension Warning:** `cosineSimilarity()` now logs a warning when vectors have mismatched dimensions instead of silently returning 0.

### Tests
- Added 27 new tests (105 → 132): classify route, embeddings, chunking, settings, file attachments security.

## [1.4.1] - 2026-03-19

### Image Viewing & Persistence
- **Image Lightbox:** Clicking any image (user-attached or AI-generated) now opens a fullscreen lightbox overlay with backdrop blur instead of opening a broken `data:` URL in a new tab. Click backdrop or press Escape to close.
- **Larger Generated Images:** AI-generated images render at 512px (up from 300px) in chat. User-attached images remain at 300px.
- **Image Persistence Fix:** AI-generated images from Nano Banana 2 now persist across page refreshes. The `onFinish` callback saves `file` parts to the `messageAttachments` table (previously only text parts were saved).

## [1.4.0] - 2026-03-19

### Nano Banana 2 (Image Generation)
- **Native Image Generation:** Gemini image model (`gemini-3.1-flash-image-preview`) now works correctly with `responseModalities: ['TEXT', 'IMAGE']` provider option.
- **Image Rendering:** AI-generated images in assistant messages now render inline (previously only user-attached images were displayed).
- **Provider Isolation:** Image models skip Google Search grounding (incompatible with image generation).

### Gemini Deep Think
- **Virtual Model:** "Gemini 3.1 Deep Think" is now a virtual model that routes to `gemini-3.1-pro-preview` with `thinkingConfig: { thinkingLevel: 'high' }` for extended reasoning.

### Model ID Fixes
- **Fixed:** `gemini-3.1-flash-preview` → `gemini-3-flash-preview` (3.1 Flash doesn't exist; use 3.0 Flash).
- **Fixed:** `gemini-3.1-deep-think` → virtual model routing to `gemini-3.1-pro-preview` with high thinking level.
- **Verified:** `gemini-3.1-pro-preview`, `gemini-3.1-flash-lite-preview`, `gemini-3.1-flash-image-preview` confirmed valid against Google API docs.

### Test Fix
- **Fixed:** Models route test expected 4 models but route had 5 Gemini models. Updated assertion to match.

## [1.3.0] - 2026-02-15

### Documentation & Maintenance
- **CLAUDE.md Condensation:** Reduced from 346 to 165 lines — removed redundant sections, cut code examples, merged overlapping retrieval docs (Context Management + Semantic Memory + Document RAG → Context Pipeline, Provider Routing, Multimodal).
- **Dependency Updates:** AI SDK 6.0.58→6.0.86, React 19.2.3→19.2.4, Zod 3→4, Playwright 1.58.0→1.58.2, framer-motion, lucide-react, dotenv, tailwind-merge, ai-sdk-ollama.
- **Bug Fix:** Restored drizzle-kit from accidental downgrade (0.18.1→0.31.8).
- **Bug Fix:** Downgraded ESLint from ^10 to ^9 for eslint-config-next compatibility (CI fix).
- **Vercel CLI:** Set up CLI deployment (`npx vercel --prod`).

## [1.2.1] - 2026-01-30

### Smooth Streaming Animation
- **SmoothStreamingWrapper:** New component wraps assistant message content with ResizeObserver-based smooth height transitions during streaming. Eliminates content jumping as new tokens arrive.
- **Chunk Fade-In:** CSS `chunk-fade-in` animation applies a subtle fade-in + slide-up effect to the last paragraph, list item, or code block while streaming.
- **Cursor Blink Tuning:** Streaming cursor blink speed adjusted from 1.0s to 0.8s for a snappier feel.
- **Cleanup:** Removed all debug `console.log` statements from production code (13 statements across summarization, onFinish, useChat, form submit, and message save flows).

### New Files
- `src/components/chat/SmoothStreamingWrapper.tsx` — ResizeObserver wrapper for smooth streaming height transitions

## [1.2.0] - 2026-01-30

### Auto-Title Generation
- **Auto-Title:** New chats automatically receive a descriptive title (3-6 words) after the first AI response. Uses the same LLM that handled the conversation. Replaces "New Chat" in the sidebar without user intervention.
- **Best-Effort:** Title generation is fire-and-forget — failures silently keep "New Chat" as the fallback title.
- **API Endpoint:** `POST /api/generate-title` with same provider routing pattern (Gemini/Qwen/Ollama).
- **Closure Safety:** Added `chatsRef` and `standaloneChatsRef` refs to avoid stale closures in the `onFinish` callback.

### New Files
- `src/app/api/generate-title/route.ts` — LLM-based title generation endpoint
- `tests/unit/api/generate-title-route.test.ts` — 6 unit tests for the endpoint

## [1.1.0] - 2026-01-29

### Google Search Grounding
- **Web Search:** Gemini models automatically use `google.tools.googleSearch({})` for real-time web search when the query benefits from current information.
- **Source Rendering:** Assistant messages display clickable source URL chips (globe icon, "SOURCES" label) below the response text. Sources are deduplicated by URL.
- **Streaming Sources:** Enabled `sendSources: true` in `toUIMessageStreamResponse()` to stream `source-url` parts alongside text.

## [1.0.0] - 2026-01-29

### Intelligent Context Management
- **Semantic Memory:** Messages are embedded via Ollama `nomic-embed-text` (768-dim vectors) and stored in SQLite. During chat, top-5 semantically similar past messages (cosine similarity ≥ 0.7) are injected as context, scoped to the current project.
- **Four-Layer Context:** `/api/chat` now builds context as: system prompt → semantic retrieval → summary → recent 20 messages. All layers degrade gracefully.
- **Embedding Status Indicator:** Brain icon in the input toolbar shows green with embedding count when active, gray "Memory off" when Ollama/model unavailable. Auto-refreshes after each message exchange.
- **Async Embedding Pipeline:** `POST /api/embed` generates embeddings asynchronously after each message exchange (best-effort, zero latency impact).
- **Embedding Status API:** `GET /api/embed` returns `{ available, embeddingCount }` for a chat or project scope.

### Smart Personas
- **Input Toolbar:** PersonaSelector moved from ChatHeader to a toolbar row above the message input, alongside System Prompt button and memory indicator.
- **Combo Presets:** 5 new model+persona combinations: Code Review (Cloud), Creative Writing (Local), Quick Code Help (Cloud), Deep Analysis (Cloud), Private Assistant (Local).
- **Grouped Dropdown:** PersonaSelector shows two sections: "Personas" (prompt-only) and "Model + Persona" (with Cloud/Local badges and descriptions). Selecting a combo switches both persona and model.
- **Smart Suggestions:** Three-layer auto-suggestion system: explicit project defaults → usage pattern stats → keyword heuristics. Suggestion banner appears after 3+ messages when no persona is set.
- **Topic Detection:** Keyword-based heuristics detect conversation topics (coding, debugging, creative, learning, brief) and suggest matching personas.
- **LLM Classification:** Server-side conversation classifier (`POST /api/classify`) for ambiguous topics, cached per chat in `chat_topics` table.

### Project Defaults
- **Defaults Dialog:** Per-project default persona and model configuration via Radix dialog, accessible from sidebar settings icon on project rows.
- **Usage Stats:** Dialog shows persona usage breakdown with progress bars.
- **Auto-Apply:** Project defaults automatically applied when creating new chats within a project.

### Usage Tracking
- **Persona Usage:** Persona selection and model choice recorded in `persona_usage` table.
- **Message Counts:** `incrementUsageMessageCount()` called after each assistant response for pattern-based suggestions.

### Database
- **New Tables:** `message_embeddings` (vector storage with indexes on chatId/projectId), `persona_usage` (tracking with indexes), `chat_topics` (detected topics with chatId index).
- **New Project Columns:** `default_persona_id`, `default_model`.

### New Files
- `src/components/chat/ChatInputArea.tsx` — Input toolbar with PersonaSelector, system prompt button, memory indicator
- `src/components/chat/PersonaSuggestionBanner.tsx` — Animated smart suggestion banner (Framer Motion)
- `src/components/ui/ProjectDefaultsDialog.tsx` — Per-project defaults dialog with usage stats
- `src/lib/embeddings.ts` — Embedding generation, cosine similarity, vector search, storage
- `src/lib/topicDetection.ts` — Keyword-based conversation topic heuristics
- `src/hooks/useSmartDefaults.ts` — Three-layer smart defaults hook
- `src/app/api/embed/route.ts` — Embedding generation + status endpoint
- `src/app/api/classify/route.ts` — LLM conversation classifier

## [0.9.0] - 2026-01-29

### Testing Infrastructure
- **Vitest:** Added 75 unit/integration tests across 12 test files
  - Utility tests: `cn()`, `formatMessageTime`, `formatFullTime`
  - Server action tests: projects, chats, messages, context management (in-memory SQLite)
  - API route tests: models, chat, summarize (mocked AI providers)
  - React hook tests: `useLocalStorage`, `usePersonas`, `useCollapseState` (jsdom)
- **Playwright:** Added 8 E2E tests across 3 test files (Chromium)
  - Chat flow: app loads, create chat + type, send button
  - Project management: sidebar visible, new project button
  - Command palette: Ctrl+K open, toggle close, backdrop close
- **Test Helpers:** In-memory SQLite factory (`tests/helpers/test-db.ts`), AI mock factories (`tests/helpers/mock-ai.ts`)
- **Config:** `vitest.config.ts` (path alias, node env), `playwright.config.ts` (Chromium, auto dev server)

### Developer Experience
- **npm Scripts:** Added `test`, `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:ui`, `test:all`
- **MCP Servers:** Added SQLite, Next.js DevTools, GitHub, Sentry, and Vercel MCP servers for development workflow

### Dependencies
- Added: `vitest`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@playwright/test`

## [0.8.0] - 2026-01-28

### Project Management
- **Project Rename:** Added inline editing for project names with pencil icon, save/cancel buttons, and keyboard shortcuts
- **Alphabetical Sorting:** Projects are now automatically sorted alphabetically in the sidebar

## [0.7.0] - 2026-01-28

### Persona System
- **Persona Selector:** Added dropdown in chat header for quick persona switching
- **Preset Personas:** 6 built-in presets (Default, Coding Assistant, Creative Mode, Debug Mode, Brief Mode, Teacher Mode)
- **Custom Personas:** Ability to customize system prompts via "Customize..." option

### UI Enhancements
- **Streaming Cursor:** Added animated cursor effect (`▎`) while AI generates responses
- **Visual Feedback:** Cursor blinks with smooth animation during streaming

## [0.6.0] - 2026-01-28

### Chat Management
- **Context Menus:** Added 3-dot dropdown menus on all chats with Move, Rename, Archive, Delete options
- **Move to Project:** Nested submenu to move chats between Quick Chats and any project
- **Archive System:** Soft-delete chats to "Archived" section with restore capability
- **Per-Project Collapse:** Each project's chat list can be independently collapsed/expanded
- **Collapse Persistence:** Sidebar collapse states are saved to localStorage

### Context Management
- **Hybrid Context:** Implemented LLM-generated summaries + sliding window for long conversations
- **Auto-Summarization:** Automatically triggers when message count exceeds 30
- **System Instructions:** Added customizable system prompts that are never trimmed from context
- **System Prompt Dialog:** UI for editing system instructions with quick example buttons

### New Components
- `ChatContextMenu.tsx`: Radix dropdown menu with nested submenus
- `DeleteConfirmDialog.tsx`: Confirmation modal for permanent deletion
- `RenameDialog.tsx`: Dialog for editing chat titles
- `SystemPromptDialog.tsx`: Dialog for editing system instructions
- `PersonaSelector.tsx`: Dropdown for persona/system prompt selection

### New Hooks
- `useLocalStorage.ts`: Generic localStorage hook with SSR safety
- `useCollapseState.ts`: Manages sidebar collapse states with persistence
- `usePersonas.ts`: Manages persona presets and custom system prompts

### Database Schema
- Added `archived` boolean field to chats table
- Added `systemPrompt` text field to chats table
- Added `summary` and `summaryUpToMessageId` fields for context management

### New API Routes
- `/api/summarize`: LLM-generated conversation summaries for context compression

## [0.5.0] - 2026-01-28

### Breaking Changes - AI SDK v6 Migration
- **SDK Upgrade:** Migrated from Vercel AI SDK v3.4 to v6 (`ai@^6.0`, `@ai-sdk/react@^3.0`)
- **Client API:** Replaced old `useChat` API with new transport-based approach
  - Now uses `DefaultChatTransport` for API communication
  - `sendMessage({ text })` replaces `handleSubmit`
  - `status` replaces `isLoading` ('ready' | 'streaming' | 'submitted' | 'error')
  - Manual input state management (no built-in `input`, `handleInputChange`)
- **Message Format:** Changed from `content` string to `parts` array structure
  - Messages now use `UIMessage` type with `parts: [{ type: 'text', text: string }]`

### Bug Fixes
- **Build:** Fixed `baseUrl` → `baseURL` typo in Ollama provider config
- **Build:** Removed unsupported `maxTokens` property from `streamText`
- **API:** Added `convertToModelMessages()` to convert UIMessage → ModelMessage for `streamText`
- **API:** Changed response from `toTextStreamResponse()` to `toUIMessageStreamResponse()`
- **Model Selection:** Fixed stale closure issue using ref pattern for dynamic model selection
- **Types:** Added proper typing for `ollamaModels` array (replacing `any`)
- **Lint:** Removed unused imports (`asc`, `formatTime` helpers)
- **Lint:** Removed unused `theme` prop from Sidebar component

### Documentation
- Added `CLAUDE.md` with AI SDK v6 implementation details and common gotchas
- Updated all documentation to reflect v6 changes

## [0.4.0] - 2026-01-28

### UI/UX Enhancements
- **Copy Code Button:** Added hover-activated copy button to all code blocks with visual feedback (checkmark on success).
- **Message Timestamps:** Implemented relative timestamps ("2m ago", "1h ago") with full datetime tooltip on hover.
- **Chat Title Editing:** Added inline chat title editing with edit icon, save/cancel buttons, and keyboard shortcuts (Enter to save, Escape to cancel).
- **Model Selector:** Organized model dropdown into "Cloud Models" and "Local Models" optgroups for better organization.
- **Message Animations:** Added smooth fade-in and slide-up animations for messages with staggered timing.
- **Enhanced Empty States:** Redesigned empty states with larger icons, pulsing animations, and more descriptive text.
- **Hover Effects:** Added subtle border color transitions on message hover for better interactivity.
- **Loading Skeletons:** Created reusable skeleton components for future loading states.
- **Typography:** Improved font sizes, weights, and spacing throughout the interface.

### New Components
- `CodeBlock.tsx`: Reusable code block component with copy functionality
- `InlineCode.tsx`: Styled inline code component
- `LoadingSkeletons.tsx`: Skeleton loaders for messages, chats, and projects
- `formatTime.ts`: Time formatting utilities for relative and absolute timestamps

### Bug Fixes
- Fixed type compatibility issues with message timestamps
- Fixed inline code component prop types to support all HTMLAttributes

## [0.3.0] - 2026-01-28

### Performance Optimizations
- **Database:** Added indexes on `project_id` and `created_at` columns for chats and messages tables, providing 10-100x query speedup.
- **Database:** Added explicit message ordering by `created_at` for consistency.
- **Database:** Implemented message limit (100 most recent) to improve performance on large chat histories.
- **Components:** Extracted and memoized Sidebar, MessagesList, and ChatHeader components to eliminate unnecessary re-renders (50-70% reduction).
- **Rendering:** Moved ReactMarkdown component definitions outside render function to prevent object recreation.
- **API:** Added 5-minute cache control headers to models endpoint to reduce redundant network requests.
- **API:** Created singleton Google provider instance to eliminate per-request instantiation overhead.
- **UX:** Implemented scroll debouncing with requestAnimationFrame for smoother scrolling.
- **UX:** Added auto-dismiss for error messages after 5 seconds.
- **State:** Optimized delete operations to update local state instead of refetching all data.

### Code Quality
- Refactored 388-line monolithic component into smaller, focused, memoized components.
- Improved separation of concerns between UI and business logic.

## [0.2.2] - 2026-01-28

### Fixed
- **Streaming:** Resolved `Unhandled chunk type: stream-start` error by aligning server-side streaming logic (`toDataStreamResponse`) with client-side expectations.
- **Dependencies:** Reverted `ai` SDK to v3.4.0 and `@ai-sdk/google` to v3.0.15 to ensure stability and prevent protocol mismatches.
- **Imports:** Cleaned up unused imports in API routes.

## [0.2.1] - 2026-01-28

### Features
- **Error Handling:** Implemented resilient API that gracefully degrades to Cloud models if Local Ollama instance is unreachable.
- **UI:** Added user-friendly Error Banner for connection failures or missing models.
- **Stability:** Improved build stability by fixing TypeScript directives in server actions.

## [0.2.0] - 2026-01-28

### Features
- **Hybrid AI Engine:** Added support for Google Gemini models alongside local Ollama models.
- **Model Support:** Enabled access to `gemini-3-pro-preview`, `gemini-3-flash-preview`, and `gemini-2.5-flash`.
- **Configuration:** Added `.env.local` support for secure API key management.
- **Code Quality:** Refactored React hooks for strict mode compliance and stability.

## [0.1.0] - 2026-01-28

### Features
- **UI:** Implemented Glassmorphic design with Light/Dark mode toggle.
- **AI:** Integrated local Ollama instance using Vercel AI SDK (v3.4.0).
- **Database:** Added SQLite persistence (via Drizzle ORM) for Projects and Chat History.
- **Organization:** Added ability to create Projects and organize chats within them.
- **Markdown:** Added Markdown rendering for AI responses (code blocks, tables).

### Tech
- Initialized Next.js 15 App Router project.
- Configured Tailwind CSS v4.
- Setup `better-sqlite3` and `drizzle-orm`.

## [Init] - 2026-01-28

### Added
- Created `Gemini.md` for project tracking.
- Created `TECH_STACKS.md` for technology suggestions.
- Created `CHANGELOG.md` for version history.
