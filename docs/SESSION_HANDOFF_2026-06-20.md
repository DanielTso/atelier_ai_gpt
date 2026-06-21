# Session Handoff — 2026-06-20

_Resume doc for the next session. Read `docs/SESSION_HANDOFF.md` for the long program history, `docs/SESSION_HANDOFF_2026-06-19.md` for the v4.7–4.9 detail, and the project `CLAUDE.md` for how the code works. THIS file captures auto-memory (v4.10.0)._

## TL;DR — where we are
- **Auto-memory (v4.10.0) is merged to `master` + GitHub-released.** Gate green (lint 0 errors / 27 warnings, build clean, **263 tests pass**). Migration `0008` applied to live Supabase. Production deploys on push.
- This was the last of the two deferred items (re-versioning shipped as v4.9.0; auto-memory now done). **No deferred items remain.**
- Spec: `docs/specs/2026-06-19-auto-memory-design.md`. Plan: `docs/plans/2026-06-19-auto-memory.md` (+ full execution copy at `C:\Users\dnlts\.claude\plans\quiet-cooking-owl.md`).

## What shipped on the branch (commits, oldest→newest)
1. `feat(memory): add memory_suggestions table (migration 0008)` — `memory_suggestions` table (`project_id` cascade, `chat_id` SET NULL + nullable, `text`, `status` default `pending`, index on `(project_id, status)`). Drizzle-generated `drizzle/0008_busy_miss_america.sql`.
2. `feat(memory): add memory-suggestion server actions` — `createMemorySuggestions`, `getPendingSuggestions`, `countPendingSuggestions`, `getRecentlyDismissed`, `acceptSuggestion(id, overrideText?)`, `dismissSuggestion` (+ 6 PGlite tests).
3. `feat(memory): add POST /api/memory/suggest route` — mirrors `/api/classify`; key-guard, cap-gate (~10), dedup vs memory+pending+dismissed; `memorySuggestRequestSchema` (+ 6 route tests).
4. `feat(memory): suggested-memories strip in project context rail` — `MemorySuggestion` type; "Suggested memories (N)" strip with Accept/Edit/Dismiss in `ProjectContextRail` Memory section; fetches on mount (+ 3 component tests).
5. `feat(memory): throttled auto-memory suggest trigger in onFinish` — best-effort `fetch('/api/memory/suggest')` every 6 messages in a project chat, reads recent messages via `getChatMessages`.

## How it works
- **Project chats only.** After an assistant turn, if `messageCount % 6 === 0` and a project is active, `onFinish` fires `/api/memory/suggest` best-effort (never blocks, never user-errors).
- The route runs Gemini `gemini-3.5-flash` → JSON array of short facts → dedups against current `projects.memory` + pending + recently-dismissed → inserts up to the ~10 cap. No Gemini key or full queue → no model call.
- Suggestions surface in the rail's Memory section. **Accept** appends to `projects.memory` (live in the next chat turn via `buildProjectPreamble`), **Edit** lets you tweak before accepting, **Dismiss** removes + suppresses re-suggestion. Nothing enters Memory without a click.
- **Defaults:** 6-message cadence, ~10 pending cap (both confirmed with user).

## ✅ DONE this session
- Migration `0008` applied to live Supabase. Merged `feat/auto-memory` → `master` (`--no-ff`), pushed (CI + Vercel prod), tagged `v4.10.0`, GitHub release created, branch deleted.

## ▶️ NEXT (optional follow-ups)
- **Browser smoke** (real keys): in a project chat, exchange ~6 messages stating durable facts → return to the project landing view → rail shows "Suggested memories" → Accept/Edit/Dismiss work; with 10 pending, no new ones appear.
- Consider enabling RLS on `memory_suggestions` (and `document_revisions`) for parity with the other tables.

## Deferred / known follow-ups (carried forward)
- Capacity meter is revision-unaware (re-versioning follow-up).
- No retention/pruning for retained document revisions, nor for accepted Memory.
- RLS: enable on `document_revisions` and `memory_suggestions` (app connects as `postgres` owner → bypasses RLS, but enable for consistency).
- Throwaway `scripts/smoke-*.mjs` + `c:\tmp\*.ps1` to delete eventually.

## Operational facts (unchanged from 2026-06-19)
- No `typecheck` npm script — use `npx tsc --noEmit`. Gate: `npm run lint` (0 errors), `npx tsc --noEmit`, `npm run build`, `npm test`.
- Live migrations gated; confirm production cutovers. No PRs (solo) — direct `--no-ff` merge to `master`.
- Do NOT run `vercel env pull` / `vercel dev` (clobbers `.env.local`). Web search is provider-native (no Tavily).
- User: construction Project Superintendent (Daniel Tso, Brycon, Drover/YAWN). Live `Drover` project (id 3) has 2 real PDFs — don't mutate in smokes.
