# Chatlog — 2026-06-14 — Phase C-storage Stage 2: chat attachments to Storage

## Goal

Migrate chat image attachments (user-attached + Nano-Banana-generated) off base64-in-DB to Supabase Storage, with backward compatibility for existing rows and graceful degradation when Storage is not configured.

## Design decisions

- **Dual-write, not a hard cutover.** When `isStorageConfigured()` is true, `saveMessageAttachments` decodes the base64 data URL, uploads bytes to `attachments/<chatId>/<messageId>/<i>-<filename>`, and stores `storage_path` with `data_url` null. When Storage is NOT configured, the base64 `data_url` is stored as before. Chat image attach keeps working with no Storage environment — unlike documents, which require Storage.
- **Dual-read, no backfill.** `getChatAttachments` returns `{ messageId, mediaType, filename, url }` where `url` is a short-lived signed URL for `storage_path` rows, or the legacy `data_url` string for old rows. Existing rows read unchanged.
- **Delete cleanup.** `deleteChat` and `deleteMessage` remove relevant Storage objects best-effort before the DB cascade delete. Project delete does NOT sweep attachment objects — deferred, consistent with Stage 1.
- **Schema: additive.** Migration `0003` adds `storage_path text` (nullable) and makes `data_url` nullable. One or the other is populated per row.
- **Client read-path unchanged.** `loadMessages` in `page.tsx` resolves `att.url` (signed URL or data URL) when building `file` parts; skips any that fail to resolve. `MessagesList` and the lightbox already consume a URL string — no UI change needed.
- **Reuses Stage 1 infrastructure.** `src/lib/storage.ts`, all `SUPABASE_*` env vars, and the bucket are unchanged.

## Tasks and outcomes

Tasks 2–4 were implemented together as the `actions.ts` lifecycle (save, read, delete) rather than as separate files — spec had them as distinct steps but the code naturally cohered into one PR-sized change.

1. **Spec + plan authored** (`docs/specs/2026-06-14-phase-c-storage-design.md` updated, `docs/plans/2026-06-14-phase-c-storage-stage2-attachments.md` created). Scope, dual-write strategy, graceful degradation, schema delta, client read-path, and known deferrals documented. Done.
2. **Schema migration `drizzle/0003_superb_roughhouse.sql`** — `storage_path text` added; `data_url` made nullable. Done.
3. **`saveMessageAttachments` (dual-write)** — detects Storage config, uploads bytes, stores `storage_path`; falls back to base64. Done (implemented alongside Tasks 3–4 in `src/app/actions.ts`).
4. **`getChatAttachments` (dual-read)** — signed URL for Storage rows, legacy data URL passthrough for old rows. Done.
5. **`deleteChat` / `deleteMessage` (Storage cleanup)** — `removeObjects` called best-effort before cascade. Done.
6. **Client `loadMessages` (`src/app/page.tsx`)** — builds `file` parts from `att.url`; skips failed resolves. Done.
7. **Tests** — `tests/unit/actions/attachments-storage.test.ts`: 5 tests covering dual-write (with/without Storage), dual-read (signed URL / legacy data URL), and delete cleanup. Full actions suite green. Done.
8. **Documentation** (this task) — CHANGELOG [4.4.0], CLAUDE.md Multimodal section, SESSION_HANDOFF.md, chatlog. Done.

## Test counts

- New: `tests/unit/actions/attachments-storage.test.ts` — **5 tests** (all passing).
- Full actions suite: green.

## Pending USER action

Run `DIRECT_URL=… npx drizzle-kit migrate` to apply migration `0003` before deploying.

## What's next

**C3 (UI)** — thumbnail display in the project landing page, document viewer, attachment previews. Separate brainstorm → spec → plan.
