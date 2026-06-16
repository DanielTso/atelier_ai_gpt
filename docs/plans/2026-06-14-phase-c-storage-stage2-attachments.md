# Phase C-storage — Stage 2 (Chat attachments) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Frame implementers by role (Backend / Frontend / Docs).

**Goal:** Migrate chat image attachments (user-attached + AI-generated) off base64 `data_url`-in-DB to Supabase Storage references, with a backward-compatible read path for existing rows and graceful degradation when Storage isn't configured.

**Architecture:** Reuse Stage 1's `src/lib/storage.ts`. `saveMessageAttachments` dual-writes (Storage when configured → `storage_path`, else base64 `data_url` unchanged). `getChatAttachments` dual-reads → resolves each row to a display `url` (signed GET URL for `storage_path` rows, else the legacy `data_url`). `deleteChat`/`deleteMessage` remove Storage objects best-effort. The client (`loadMessages`) consumes the resolved `url`.

**Tech Stack:** Next.js 16, Drizzle (postgres-js), `@supabase/supabase-js` Storage (already wired in Stage 1), Vitest + PGlite.

**Spec:** `docs/specs/2026-06-14-phase-c-storage-design.md` (Stage 2 section). **Stage 1 (documents) is already merged.**

**Key decision — graceful degradation (differs from Stage 1):** Documents *require* Storage; chat attachments do NOT. Chat image attach/display is a core feature that must keep working with no Storage configured. So `saveMessageAttachments` falls back to base64-in-DB when `!isStorageConfigured()`. This preserves current behavior locally and on un-configured deploys.

---

## File structure

| File | Change |
|---|---|
| `src/db/schema.ts` (modify) | `message_attachments`: add `storage_path` (nullable); make `data_url` nullable |
| `drizzle/` (generated) | additive migration (`ADD COLUMN storage_path`, `ALTER data_url DROP NOT NULL`) |
| `src/app/actions.ts` (modify) | `saveMessageAttachments` dual-write; `getChatAttachments` dual-read → resolved `url`; `deleteChat` + `deleteMessage` storage cleanup; small `dataUrlToBuffer`/`sanitize` helpers |
| `src/app/page.tsx` (modify) | `loadMessages` uses `att.url` (was `att.dataUrl`); skip empty urls |
| Tests | `tests/unit/actions/attachments-storage.test.ts` (PGlite + mocked `@/lib/storage`) |
| `CLAUDE.md`, `CHANGELOG.md`, `docs/SESSION_HANDOFF.md`, chatlog | docs |

---

## Task 1: Schema migration (Backend)

**Files:** `src/db/schema.ts`, `drizzle/`

- [ ] **Step 1:** In `src/db/schema.ts`, the `messageAttachments` table: add `storagePath: text('storage_path'),` (after `dataUrl`), and change `dataUrl: text('data_url').notNull(),` to `dataUrl: text('data_url'),` (drop `.notNull()`).

- [ ] **Step 2:** `npx drizzle-kit generate` (offline; no DB connection). Expect a new `drizzle/000X_*.sql` with `ALTER TABLE "message_attachments" ADD COLUMN "storage_path" text;` and `ALTER TABLE "message_attachments" ALTER COLUMN "data_url" DROP NOT NULL;`. Verify it contains ONLY those changes (no drops of other tables/columns) — if not, STOP and report drift.

- [ ] **Step 3:** `npx tsc --noEmit` → clean.

- [ ] **Step 4:** Commit:
```bash
git add src/db/schema.ts drizzle/
git commit -m "feat(c-storage): message_attachments storage_path + nullable data_url"
```
(append trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`)

---

## Task 2: saveMessageAttachments dual-write (Backend, TDD)

**Files:** Modify `src/app/actions.ts`; create `tests/unit/actions/attachments-storage.test.ts`

> READ a sibling `tests/unit/actions/*.test.ts` for the exact PGlite harness (`@/db` getter mock + `createTestDb()` in `beforeEach`). This test ALSO mocks `@/lib/storage` — use `vi.mock('@/lib/storage', () => ({ ... }))` with controllable `isStorageConfigured`, `uploadBuffer`, `createSignedDownloadUrl`, `removeObjects`. Because the actions test imports `@/app/actions` (which imports `@/lib/storage`), mock it before importing actions.

- [ ] **Step 1: Write the failing test** (the storage-configured write path). In `tests/unit/actions/attachments-storage.test.ts`, set up the PGlite harness + a storage mock where `isStorageConfigured()` returns `true`, `uploadBuffer` resolves, `createSignedDownloadUrl` returns `signed:<path>`. Create a project→chat→message, then:

```ts
  it('uploads to Storage and stores storage_path (data_url null) when configured', async () => {
    const { saveMessageAttachments } = await import('@/app/actions')
    // ...create project, chat, message → messageId, chatId...
    const [row] = await saveMessageAttachments(messageId, chatId, [
      { filename: 'pic.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])
    expect(row.storagePath).toBe(`attachments/${chatId}/${messageId}/0-pic.png`)
    expect(row.dataUrl).toBeNull()
    expect(mockUploadBuffer).toHaveBeenCalledTimes(1)
    // uploaded bytes decode from base64 "QUJD" → "ABC"
    expect(mockUploadBuffer.mock.calls[0][1].toString()).toBe('ABC')
    expect(mockUploadBuffer.mock.calls[0][2]).toBe('image/png')
  })

  it('falls back to base64 data_url when Storage is NOT configured', async () => {
    mockIsStorageConfigured.mockReturnValue(false)
    const { saveMessageAttachments } = await import('@/app/actions')
    // ...messageId, chatId...
    const [row] = await saveMessageAttachments(messageId, chatId, [
      { filename: 'pic.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 },
    ])
    expect(row.dataUrl).toBe('data:image/png;base64,QUJD')
    expect(row.storagePath).toBeNull()
    expect(mockUploadBuffer).not.toHaveBeenCalled()
  })
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** In `src/app/actions.ts`, add imports near the top: `import { isStorageConfigured, uploadBuffer, createSignedDownloadUrl, removeObjects } from '@/lib/storage'`. Add helpers (module scope):

```ts
function sanitizeAttachmentName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^\.+$/, '_')
}
function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',')
  return Buffer.from(comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl, 'base64')
}
```

Replace `saveMessageAttachments`:

```ts
export async function saveMessageAttachments(
  messageId: number,
  chatId: number,
  attachments: { filename: string; mediaType: string; dataUrl: string; fileSize: number }[]
) {
  if (attachments.length === 0) return []
  if (isStorageConfigured()) {
    const rows = await Promise.all(attachments.map(async (a, i) => {
      const path = `attachments/${chatId}/${messageId}/${i}-${sanitizeAttachmentName(a.filename)}`
      await uploadBuffer(path, dataUrlToBuffer(a.dataUrl), a.mediaType)
      return { messageId, chatId, filename: a.filename, mediaType: a.mediaType, storagePath: path, dataUrl: null, fileSize: a.fileSize }
    }))
    return await db.insert(messageAttachments).values(rows).returning()
  }
  // No Storage configured → keep base64-in-DB (unchanged legacy behavior).
  const rows = attachments.map(a => ({ messageId, chatId, filename: a.filename, mediaType: a.mediaType, dataUrl: a.dataUrl, fileSize: a.fileSize }))
  return await db.insert(messageAttachments).values(rows).returning()
}
```

- [ ] **Step 4: Run — expect PASS.** `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit:** `git add src/app/actions.ts tests/unit/actions/attachments-storage.test.ts && git commit -m "feat(c-storage): dual-write chat attachments to Storage"` (+ trailer)

---

## Task 3: getChatAttachments dual-read (Backend, TDD)

**Files:** Modify `src/app/actions.ts`; extend `tests/unit/actions/attachments-storage.test.ts`

- [ ] **Step 1: Add tests** to the same file:

```ts
  it('resolves a signed url for storage_path rows', async () => {
    // configured; insert via saveMessageAttachments (Storage path) then read back
    const { saveMessageAttachments, getChatAttachments } = await import('@/app/actions')
    // ...messageId, chatId...
    await saveMessageAttachments(messageId, chatId, [{ filename: 'p.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 }])
    const out = await getChatAttachments(chatId)
    expect(out[0].url).toBe(`signed:attachments/${chatId}/${messageId}/0-p.png`)
    expect(out[0].mediaType).toBe('image/png')
    expect(out[0].messageId).toBe(messageId)
  })

  it('returns the legacy data_url for old rows (no storage_path)', async () => {
    mockIsStorageConfigured.mockReturnValue(false)
    const { saveMessageAttachments, getChatAttachments } = await import('@/app/actions')
    // ...messageId, chatId...
    await saveMessageAttachments(messageId, chatId, [{ filename: 'p.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 }])
    const out = await getChatAttachments(chatId)
    expect(out[0].url).toBe('data:image/png;base64,QUJD')
  })
```

- [ ] **Step 2: Run — expect FAIL** (current `getChatAttachments` returns raw rows without `url`).

- [ ] **Step 3: Implement.** Replace `getChatAttachments`:

```ts
export async function getChatAttachments(chatId: number) {
  const rows = await db.select().from(messageAttachments).where(eq(messageAttachments.chatId, chatId))
  return await Promise.all(rows.map(async (r) => {
    let url = r.dataUrl ?? ''
    if (r.storagePath) {
      url = await createSignedDownloadUrl(r.storagePath).catch(() => '')
    }
    return { messageId: r.messageId, mediaType: r.mediaType, filename: r.filename, url }
  }))
}
```

- [ ] **Step 4: Run — expect PASS.** Run the full actions suite `npx vitest run tests/unit/actions/` (no regressions — note `getChatAttachments` shape changed from raw rows to `{messageId, mediaType, filename, url}`; the only consumer is `loadMessages`, updated in Task 5). `npx tsc --noEmit` may now flag `page.tsx`'s use of `att.dataUrl` — that's expected and fixed in Task 5; if tsc fails ONLY on that, proceed (Task 5 resolves it). If you prefer green tsc per-task, do Task 5 before committing — but committing here is fine since the suite is green.
- [ ] **Step 5: Commit:** `git add src/app/actions.ts tests/unit/actions/attachments-storage.test.ts && git commit -m "feat(c-storage): dual-read chat attachments (signed url / legacy data_url)"` (+ trailer)

---

## Task 4: Delete cleanup (Backend, TDD)

**Files:** Modify `src/app/actions.ts`; extend the test file

- [ ] **Step 1: Add a test:**

```ts
  it('deleteChat removes storage objects for its attachments', async () => {
    const { saveMessageAttachments, deleteChat } = await import('@/app/actions')
    // configured; create chat+message, save a Storage-backed attachment
    await saveMessageAttachments(messageId, chatId, [{ filename: 'p.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,QUJD', fileSize: 3 }])
    await deleteChat(chatId)
    expect(mockRemoveObjects).toHaveBeenCalledWith([`attachments/${chatId}/${messageId}/0-p.png`])
  })
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement.** Add a helper + update `deleteChat` and `deleteMessage`:

```ts
async function removeAttachmentObjects(where: ReturnType<typeof eq>) {
  if (!isStorageConfigured()) return
  const rows = await db.select({ storagePath: messageAttachments.storagePath }).from(messageAttachments).where(where)
  const paths = rows.map(r => r.storagePath).filter((p): p is string => Boolean(p))
  if (paths.length) await removeObjects(paths).catch(e => console.warn('[attachments] storage cleanup failed:', e instanceof Error ? e.message : e))
}

export async function deleteChat(id: number) {
  await removeAttachmentObjects(eq(messageAttachments.chatId, id))
  await db.delete(chats).where(eq(chats.id, id))
}

export async function deleteMessage(id: number) {
  await removeAttachmentObjects(eq(messageAttachments.messageId, id))
  await db.delete(messages).where(eq(messages.id, id))
}
```

- [ ] **Step 4: Run — expect PASS.** Full actions suite green; `npx tsc --noEmit` (modulo the known page.tsx `att.dataUrl`, fixed next).
- [ ] **Step 5: Commit:** `git add src/app/actions.ts tests/unit/actions/attachments-storage.test.ts && git commit -m "feat(c-storage): remove attachment objects on chat/message delete"` (+ trailer)

---

## Task 5: Client read path (Frontend)

**Files:** Modify `src/app/page.tsx`

- [ ] **Step 1:** In `loadMessages`, the attachment→`file`-part loop currently does `url: att.dataUrl`. Change it to use the resolved `url` and skip empties:

```ts
        if (msgAttachments) {
          for (const att of msgAttachments) {
            if (!att.url) continue
            parts.push({
              type: 'file' as const,
              mediaType: att.mediaType,
              url: att.url,
            })
          }
        }
```

(The `getChatAttachments` return no longer has `dataUrl`; it has `url`. No other consumer exists.)

- [ ] **Step 2:** `npx tsc --noEmit` → clean. `npm run build` → clean.
- [ ] **Step 3:** Commit: `git add src/app/page.tsx && git commit -m "feat(c-storage): client loads attachments via resolved url"` (+ trailer)

---

## Task 6: Docs + full gate (Docs / QA)

- [ ] **Step 1:** `CLAUDE.md` — update the **Multimodal** section: attachments now persist to Storage when configured (`attachments/<chatId>/<messageId>/…`), with a base64 fallback when not; load resolves signed URLs; delete cleans up. Note the new `message_attachments.storage_path` + nullable `data_url`.
- [ ] **Step 2:** `CHANGELOG.md` — add a `[4.4.0]` entry (Phase C-storage Stage 2: chat attachments → Storage with dual read + graceful base64 fallback; delete cleanup; migration). Reference spec + this plan.
- [ ] **Step 3:** `docs/SESSION_HANDOFF.md` — C-storage Stage 2 done; note the new migration in the pending `drizzle-kit migrate`; C-storage complete → next is C3 (UI).
- [ ] **Step 4:** Write `docs/chatlog-2026-06-14-phase-c-storage-stage2.md`.
- [ ] **Step 5: Full gate:** `npm run lint && npm run build && npm test` — 0 errors, 0 new warnings, all green. (Live-Storage smoke for attachments needs the Supabase bucket + env — pending USER action, same as Stage 1.)
- [ ] **Step 6:** Commit (+ trailer).

---

## Self-review

**Spec coverage (Stage 2):** write path → Storage (T2) · dual read-path signed/legacy (T3) · no backfill (legacy `data_url` rows read unchanged — T3) · delete cleanup (T4) · client consumes resolved url (T5) · schema (T1) · docs (T6). ✅
**Graceful degradation:** `saveMessageAttachments` keeps base64 when `!isStorageConfigured()` so chat attach never breaks (T2). ✅
**Placeholders:** action code shown in full; test bodies reference the sibling PGlite harness for project/chat/message creation (environment-specific boilerplate, intentionally not re-inlined — implementer copies it). ✅
**Type consistency:** `getChatAttachments` returns `{messageId, mediaType, filename, url}` (T3) consumed by `loadMessages` (T5); `saveMessageAttachments` signature unchanged for callers (still takes `dataUrl`-bearing input from `page.tsx`); helpers `dataUrlToBuffer`/`sanitizeAttachmentName`/`removeAttachmentObjects` consistent across T2–T4. ✅
**Deferred (bounded):** project-delete cascade does not sweep attachment Storage objects (orphaned objects on whole-project delete) — documented gap, consistent with Stage 1's orphan-sweep deferral; signed-URL fan-out on chat load (one per Storage-backed image) acceptable at current scale.
