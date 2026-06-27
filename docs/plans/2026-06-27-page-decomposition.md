# page.tsx decomposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Behavior-preserving refactor — the safety net is typecheck (rename integrity) + the existing suite + a NEW unit test for the persistence hook.

## Context

**Why:** `src/app/page.tsx` is 1,313 lines and holds all app state. Carryover cleanup: extract two cohesive concerns into hooks (matching the 9 existing hooks in `src/hooks/`) to shrink the component and make the logic testable.

**What:** Two behavior-preserving extractions:
- **Task 1 — `useDialogs`**: the 10 dialog open/close flags + the 6 dialog-coupled "target" values, behind a small per-dialog controller API.
- **Task 2 — `useChatPersistence`**: the `useChat` `onFinish` pipeline (~lines 188–304) into a hook that takes its dependencies as injected refs/callbacks and returns the `onFinish` handler — PLUS a unit test (the async ordering is the risk typecheck can't catch).

**Outcome:** smaller, clearer `page.tsx`; the persistence pipeline gains test coverage. No behavior change. Targets a Phase-2 release (batched with the xlsx/CSP-doc commits already on `chore/phase2-cleanups`).

## Global Constraints

- **Behavior-preserving.** No functional change. Same call order, same args, same refs (`.current`), same dedup/throttle/monotonic-gate logic. `currentSystemPrompt` is composer state used in 6 places (chat-load effect, createChatForProject, handleSaveSystemPrompt, JSX) — it does NOT move into `useDialogs`; only `systemPromptDialogOpen` does.
- **Follow the existing hook pattern** (`src/hooks/useChatTitle.ts`, `useSummarization.ts`): inject refs/callbacks via an opts object, return stable `useCallback`(s), list deps explicitly.
- Branch: `chore/phase2-cleanups` (already off `master`). Conventional Commits + `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` trailer.
- **Verification gate per task:** `npm run typecheck` (0 — this is the primary net for the rename refactor), `npm run lint` (0 errors), the focused/relevant tests, and `npm run build`. Full `npm test` + build before the batch is declared done. Local chat smoke is gate-blocked → the Task 2 unit test is the substitute net; the user smoke-tests the live chat on deploy.

---

### Task 1: Extract `useDialogs`

**Files:** Create `src/hooks/useDialogs.ts`; Modify `src/app/page.tsx`.

**Hook API** (returns one `dialogs` object):
- **Target-less** `{ isOpen, setOpen }` for: `commandPalette` (also expose `toggle` for the Ctrl+K `setOpen(o => !o)` site), `settings`, `createProject`, `systemPrompt`.
- **With target** `{ isOpen, target, open(target), close(), setOpen }` for: `deleteChat` (target `number`), `deleteProject` (`number`), `renameChat` (`{id:number; title:string}`), `renameProject` (`{id:number; name:string}`), `projectDefaults` (`{id:number; name:string}`), `projectDocuments` (`{id:number; name:string}`). `open(t)` sets target + opens; `close()` clears target + closes; `setOpen(false)` also clears target (so the Dialog's `onOpenChange` close path clears it).

Internally: keep the same `useState` calls (one `boolean` + one target per dialog), wrapped in `useCallback`/`useMemo` so the returned controllers are stable.

**Call-site transformation** (per the map — every site, verified by typecheck):
- Remove the 13 dialog `useState` declarations (page.tsx lines ~119–140) except `currentSystemPrompt` (stays). Replace with `const dialogs = useDialogs()`.
- Openers: `setXTargetId(id); setXOpen(true)` → `dialogs.X.open(id)` (deleteChat L822–823, deleteProject L780–781, renameChat L846–847, renameProject L812–813, projectDefaults L951–952, projectDocuments L959–960).
- Target-less opens: `setSettingsDialogOpen(true)` → `dialogs.settings.setOpen(true)` (L1006); `setCreateProjectDialogOpen(true)` → `dialogs.createProject.setOpen(true)` (L581); `setSystemPromptDialogOpen(true)` → `dialogs.systemPrompt.setOpen(true)` (L1130); `setCommandPaletteOpen(o => !o)` → `dialogs.commandPalette.toggle()` (L573).
- Guards/cleanup in confirm handlers: read `dialogs.X.target` instead of `xTarget`; replace `setXTargetId(null)` cleanup with `dialogs.X.close()` (deleteChat L827/834, deleteProject L785/790, renameChat L852/857, renameProject L818, etc.).
- JSX (L1210–1310): `open={xOpen}` → `open={dialogs.X.isOpen}`, `onOpenChange={setXOpen}` → `onOpenChange={dialogs.X.setOpen}`, target reads (`projectDefaultsTarget?.id`, dialog description ids, `renameTarget?.title`) → `dialogs.X.target?...`.

- [ ] **Step 1** — Write `src/hooks/useDialogs.ts` with the API above (stable controllers).
- [ ] **Step 2** — Rewire `page.tsx` at every site listed in the map. Keep behavior identical (esp. that closing a target dialog clears its target — preserves the existing `setXTarget(null)` cleanup).
- [ ] **Step 3** — `npm run typecheck` (0 — catches any missed/renamed reference) and `npm run lint` (0 errors).
- [ ] **Step 4** — `npm run build` + `npx vitest run` (the e2e/command-palette + dialog behaviors are the runtime net in CI). Confirm green.
- [ ] **Step 5** — Commit: `refactor: extract useDialogs from page.tsx` (+ trailer).

**Reviewer focus:** every dialog still opens/closes; target dialogs still clear their target on close; the Ctrl+K toggle still toggles; no behavior change; `currentSystemPrompt` untouched.

---

### Task 2: Extract `useChatPersistence` (+ unit test)

**Files:** Create `src/hooks/useChatPersistence.ts` and `tests/hooks/useChatPersistence.test.ts`; Modify `src/app/page.tsx`.

**Hook signature** — inject every dependency the `onFinish` closure uses (from the map), return the `onFinish` handler:
```
useChatPersistence(opts: {
  activeChatIdRef, activeProjectIdRef, lastSavedAssistantIdRef, lastSuggestedAtRef,  // RefObjects
  setMessages, setArtifacts,                                                          // state setters
  triggerSummarization, maybeGenerateTitle,                                           // injected callbacks
}): (args: { message: UIMessage }) => Promise<void>
```
Server actions (`saveMessage`, `saveGeneratedImage`, `saveMessageAttachments`, `incrementUsageMessageCount`, `getMessageCount`, `getChatMessages`), utils (`extractText`, `extractGeneratedImageOutputs`), and constants (`SUMMARIZATION_THRESHOLD`, `MEMORY_SUGGEST_EVERY`) are imported directly inside the hook (not injected) — they're module-level, not page state. Move the `MEMORY_SUGGEST_EVERY` constant (page L175) into the hook (or a shared const).

**Preserve exactly** (the map's order-sensitive details): dedup via `lastSavedAssistantIdRef` FIRST; the media-only-turn save condition; the `getMessageCount` single fetch reused for summarize + memory-suggest; the monotonic memory gate (`messageCount - lastSuggested >= MEMORY_SUGGEST_EVERY`, set-before-fetch); title + artifact-refetch last; all best-effort `.catch(() => {})`.

**Wiring:** in `page.tsx`, `const onFinish = useChatPersistence({...})` and pass `onFinish` to `useChat`. (The handler is still recreated per render — fine; it closes over refs.)

- [ ] **Step 1: Write the failing test** `tests/hooks/useChatPersistence.test.ts` (jsdom). Mock `@/app/actions` + `global.fetch`. Render the hook via `renderHook` with mocked refs/callbacks, invoke the returned handler with a fake assistant message, and assert: (a) `saveMessage(chatId,'assistant',text)` called; (b) double-invoke with same `message.id` does NOT save twice (dedup); (c) when `getMessageCount` > threshold, `triggerSummarization` fires; (d) in a project chat past the gate, `/api/memory/suggest` is fetched; (e) `/api/artifacts?chatId=` re-fetch updates `setArtifacts`; (f) a media-only turn (no text, has image output) still saves.
- [ ] **Step 2** — Run it; confirm it fails (no hook).
- [ ] **Step 3** — Create `src/hooks/useChatPersistence.ts` by moving the onFinish body verbatim, parameterized by opts. 
- [ ] **Step 4** — Run the test → pass. Then rewire `page.tsx` to use it.
- [ ] **Step 5** — `npm run typecheck` (0), `npm run lint` (0 errors), `npm run build`, full `npx vitest run` → all green.
- [ ] **Step 6** — Commit: `refactor: extract useChatPersistence from page.tsx` (+ trailer).

**Reviewer focus:** the moved logic is byte-equivalent in behavior; no dependency dropped (stale-closure check against the map's dependency list); the unit test asserts real ordering/calls, not tautologies; dedup + monotonic gate intact.

---

## Self-Review
Spec coverage: dialogs (Task 1) + onFinish (Task 2) are the two named targets. Placeholder scan: transformation rules reference the map's exact line numbers; the implementer works against the live file. Type consistency: hook opts names match the map's variable names (`activeChatIdRef`, `lastSuggestedAtRef`, etc.).

## Release (user-gated)
After both tasks + the existing `3de1e14`/`743323b` commits: merge `chore/phase2-cleanups` → `master` (`--no-ff`), bump to **v4.33.0**, CHANGELOG, tag, push, gh release, watch CI. Then the user smoke-tests the live chat (send a message, generate an image/artifact, open each dialog) since local smoke is gate-blocked.
