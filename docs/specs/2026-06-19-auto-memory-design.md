# Auto-memory (suggest, you approve) — Design

**Status:** Approved design (2026-06-19). Branch: `feat/auto-memory` (off `master`, post v4.9.0). Second of two deferred items (re-versioning shipped as v4.9.0). Targets release **v4.10.0**.

## Goal

After exchanges in a **project** chat, a throttled, best-effort housekeeping pass extracts **candidate durable job facts** (names, roles, locations, key dates, decisions) and surfaces them as **pending suggestions** in the project rail's Memory section. The user **Accepts / Edits / Dismisses** each one — nothing enters Memory without a click. Accepted facts append to the existing `projects.memory` field, which is already injected into every project chat (via `buildProjectPreamble`) and shown in the rail.

The win for a construction superintendent: durable job facts (PE of record, key milestone dates, decisions) accumulate into project Memory without manual note-taking, while a human gate keeps the memory clean and trustworthy.

## Decisions (locked)

- **Mode: "suggest, you approve."** No fully-automatic writes to Memory. The Accept click is the safety gate.
- **Housekeeping model = Gemini `gemini-3.5-flash`** (internal utility model — never burns Claude tokens), mirroring `/api/classify`, `/api/summarize`, `/api/generate-title`.
- **Throttle cadence: every 6 messages** in a project chat (confirmed with user).
- **Pending cap: ~10** suggestions per project (confirmed with user). When full, the suggest pass stops proposing new ones until some are triaged (no auto-eviction — see Flow).
- **One source of truth for memory** = `projects.memory` (existing column). Accepted suggestions append to it; suggestions are a staging area, not a parallel store.
- **Project chats only.** Quick/standalone chats (no `projectId`) never trigger the pass.

## Non-goals

- No fully-automatic writing to Memory (the whole point is the approval gate).
- No cross-project / global memory.
- No structured/categorized memory store (it stays a freeform text field).
- No auto-pruning of accepted Memory, and no semantic dedup of Memory contents (dedup here is only "don't re-suggest something already present" — see Flow).
- No suggestions from Quick Chats or non-project context.
- No editing of already-accepted Memory beyond the existing rail textarea.

## Current state (what we build on)

- **Post-response housekeeping already lives in `onFinish`** (`src/app/page.tsx` ~L178–285): saves the assistant message, best-effort embed, summarize at threshold, auto-title, re-fetch artifacts. `currentProjectId = activeProjectIdRef.current` and `currentChatId` are already in scope there. **This is where the suggest trigger hooks in.**
- **`/api/classify`** (`src/app/api/classify/route.ts`) is the canonical pattern to mirror: Gemini Flash via `createGoogleGenerativeAI`, `generateText` → regex-extract JSON → parse → fallback, `getGeminiApiKey()` guard returning 200 with no key, all DB writes through server actions, errors via `apiError(…, 200)` so housekeeping never surfaces as a user error.
- **Memory** = `projects.memory` (text, migration `0006`). `updateProjectContext(id, { memory?, instructions? })` (`src/app/actions.ts`) does a partial update; `getProjectContext(id)` reads it. `buildProjectPreamble(memory, instructions)` (`src/lib/projectPreamble.ts`) prepends it to the chat system prompt.
- **`ProjectContextRail`** (`src/components/chat/ProjectContextRail.tsx`) renders the Memory textarea (debounced save) + Instructions + Files. The "Suggested memories" strip goes in the Memory `<section>`. The rail is remounted per project via `key={project.id}`.
- **Validation** lives in `src/lib/validation.ts` (Zod schemas, one per route). **Errors** via `apiError` (`src/lib/errors.ts`).

## Data model — migration `0008` (additive, safe; live-apply gated)

```sql
CREATE TABLE "memory_suggestions" (
  "id" integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  "project_id" integer NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "chat_id" integer REFERENCES "chats"("id") ON DELETE SET NULL,
  "text" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,   -- 'pending' | 'accepted' | 'dismissed'
  "created_at" timestamptz DEFAULT now()
);
CREATE INDEX "idx_memory_suggestions_project_status"
  ON "memory_suggestions"("project_id", "status");
```

- `chat_id` is **nullable + `ON DELETE SET NULL`** so deleting a chat doesn't wipe its already-surfaced suggestions (they belong to the project).
- Index is on `(project_id, status)` — every read filters by both ("pending for this project").
- Schema added to `src/db/schema.ts` as `memorySuggestions`. Authored with `drizzle-kit generate`.
- **RLS:** enable RLS on `memory_suggestions` for consistency with the other tables (the app connects as `postgres` owner and bypasses RLS, but enable it anyway — noted as a follow-up in the handoff).

## Flow

### Trigger (client, `onFinish`)
After an assistant message is saved in a **project** chat:
1. Only proceed if `currentProjectId` is set (skip Quick Chats).
2. Reuse the `messageCount` already fetched for summarization (`getMessageCount(currentChatId)`); fire the pass when `messageCount % 6 === 0` (cadence). Best-effort `fetch('/api/memory/suggest', …).catch(() => {})` — zero latency impact, never blocks the UI.
3. On a successful response with `created > 0`, refresh the rail's pending list (the rail owns its own fetch; the simplest wiring is a lightweight signal/refetch — see Types & UI).

### `POST /api/memory/suggest` (mirrors `/api/classify`)
Request: `{ projectId: number, chatId?: number, messages: {role, content?|parts}[] }` (recent messages, same shape classify accepts).
1. Validate with `memorySuggestRequestSchema`. No Gemini key → return `{ created: 0 }` 200 (silent degrade).
2. **Cap check:** `countPendingSuggestions(projectId)`. If `>= 10`, return `{ created: 0, capped: true }` without calling the model (cheap, avoids wasted Flash calls).
3. Load current Memory (`getProjectContext(projectId).memory`) + the existing pending suggestion texts.
4. Build the conversation text (first/last N messages, like classify's `.slice(0, 10)`).
5. Prompt Gemini Flash to return **only durable job facts NOT already present** in Memory or pending suggestions (dedup is in the prompt + a cheap post-filter): names/roles, locations, key dates, decisions/commitments. Return `ONLY a JSON array of short strings`. `maxOutputTokens` small (~300).
6. Parse (regex `\[[\s\S]*\]` → `JSON.parse`, fallback `[]` on failure). Post-filter: drop empties, trim, case-insensitive dedup against Memory + existing pending, and clamp the batch so total pending ≤ 10.
7. `createMemorySuggestions(projectId, chatId, texts)` (skip insert if empty). Return `{ created: <n> }`.
8. Wrap in `try/catch` → `apiError(error, 'Memory suggestion failed', 200)` so it's never a user-visible failure.

### Accept / Dismiss (rail)
- **Accept** → `acceptSuggestion(id)`: append the text to `projects.memory` (newline-separated; create or extend), mark the row `accepted`. Returns the updated memory string so the rail textarea + parent state update in place. (Because Memory feeds `buildProjectPreamble`, the fact is live in the next chat turn.)
- **Edit** → inline edit the suggestion text before accepting (client-only until Accept; Accept appends the edited text). MVP can implement Edit as "populate an editable input, then Accept" — no separate persistence.
- **Dismiss** → `dismissSuggestion(id)`: mark `dismissed` (kept for audit, filtered out of pending). Dismissed facts are NOT re-suggested because the suggest prompt/post-filter dedups against… Memory + **pending** only. **Decision:** to avoid re-proposing dismissed facts, the post-filter also checks recent `dismissed` texts for that project (`getRecentlyDismissed(projectId)`), so a dismissed fact stays dismissed.

## Server actions (`src/app/actions.ts`)
- `createMemorySuggestions(projectId: number, chatId: number | null, texts: string[])` — bulk insert pending rows (no-op on empty array).
- `getPendingSuggestions(projectId: number)` — pending rows newest-first.
- `countPendingSuggestions(projectId: number)` — count for the cap check.
- `getRecentlyDismissed(projectId: number)` — recent dismissed texts (for re-suggest suppression).
- `acceptSuggestion(id: number)` — append text to `projects.memory`, mark `accepted`, return `{ memory: string }`.
- `dismissSuggestion(id: number)` — mark `dismissed`.

## Validation (`src/lib/validation.ts`)
- `memorySuggestRequestSchema`: `{ projectId: number (int, positive), chatId: number.optional(), messages: array of { role: string, content: string.optional(), parts: array.optional() } }` — reuse the same loose message shape `classifyRequestSchema` accepts.

## Types & UI
- **`MemorySuggestion`** type in `src/types.ts`: `{ id: number; text: string; createdAt: Date | string }` (rail only needs pending ones).
- **`ProjectContextRail`** Memory `<section>` gains a **"Suggested memories (N)"** strip under the textarea: each pending row = the fact text + **Accept** (check) / **Edit** (pencil → inline input) / **Dismiss** (x). Empty list → strip hidden. On Accept, update the local `memory` state + textarea (so the user sees it land) and call `onSaveContext` is NOT needed (the action already persisted Memory) — but keep local state in sync.
  - Rail fetches pending on mount (`useEffect`, like it fetches documents) and re-fetches after each Accept/Dismiss. **Refinement applied during implementation:** the rail is only rendered inside `ProjectLandingPage` (the project landing view), which is *not* shown while a chat is open. The suggest pass fires during chatting (rail hidden), so the rail's mount-time fetch picks up new suggestions on its next render — **no `suggestionsTick` prop / live-refresh wiring is needed** (the spec's earlier prop-tick idea is dropped).
- **No change to chat injection** — accepted facts flow through the existing `projects.memory` → `buildProjectPreamble` path untouched.

## File layout (new / changed)
```
src/
├─ app/
│  ├─ api/memory/suggest/route.ts     # NEW — Gemini Flash suggest pass (mirrors classify)
│  ├─ actions.ts                       # + createMemorySuggestions, getPendingSuggestions,
│  │                                   #   countPendingSuggestions, getRecentlyDismissed,
│  │                                   #   acceptSuggestion, dismissSuggestion
│  └─ page.tsx                         # onFinish: throttled best-effort suggest trigger + tick
├─ components/chat/ProjectContextRail.tsx   # "Suggested memories (N)" strip + accept/edit/dismiss
├─ db/schema.ts                        # + memorySuggestions table
├─ lib/validation.ts                   # + memorySuggestRequestSchema
└─ types.ts                            # + MemorySuggestion
drizzle/0008_*.sql                     # NEW migration (memory_suggestions)
```

## Testing
- **Unit (actions, PGlite):** `createMemorySuggestions` inserts pending rows (skips empty); `getPendingSuggestions` returns only pending newest-first; `countPendingSuggestions` is accurate; `acceptSuggestion` appends to `projects.memory` (creating it when null, newline-joining when present) and marks `accepted`; `dismissSuggestion` marks `dismissed`; `chat_id` SET NULL on chat delete leaves the suggestion.
- **Unit (route, mocked Gemini + actions):** no Gemini key → `{ created: 0 }`; pending at cap → `{ created: 0, capped: true }` with no model call; happy path parses JSON array → `createMemorySuggestions` with deduped texts; malformed model output → `{ created: 0 }` (no throw); dedup drops facts already in Memory / pending / recently-dismissed.
- **Component (`ProjectContextRail`, jsdom):** strip renders pending count; Accept fires `acceptSuggestion` and updates the Memory textarea; Dismiss removes the row; empty list hides the strip.
- All existing tests stay green; lint 0 errors, build clean. PGlite applies `0008`.

## Verification gate
`npm run lint` (0 errors), `npm run typecheck`, `npm run build`, `npm test`. **Live `0008` apply is user-gated** (`set -a; . ./.env.local; set +a; npx drizzle-kit migrate`). Manual smoke (browser, real keys): in a project chat, exchange ~6 messages mentioning durable facts → a suggestion appears in the rail → Accept → it lands in Memory textarea and steers the next turn; Dismiss → gone and not re-proposed; with pending at 10, no new ones appear.

## Risks / mitigations
- **Latency/cost of extra Flash calls** — throttled to every 6 messages, best-effort, cap-gated (no model call when pending is full). Degrades silently with no Gemini key.
- **Noisy / low-value suggestions** — the approval gate is the backstop; the prompt asks only for durable job facts and dedups against Memory + pending + recently-dismissed.
- **Re-suggesting dismissed facts** — suppressed via `getRecentlyDismissed` post-filter (decision above).
- **Memory bloat** — accepted facts only; user controls via Accept and can edit the textarea directly. No auto-pruning (deferred).
- **Migration `0008`** additive, FK-safe; apply to live Supabase before the feature deploys.

## Definition of done
Project chats throttle a best-effort Gemini suggest pass (every 6 messages, cap ~10); candidate facts surface in the rail's Memory strip; Accept appends to `projects.memory` (live in the next turn) and Dismiss suppresses re-suggestion; nothing enters Memory without a click; gate green; `0008` applied live (gated). Released as v4.10.0.
