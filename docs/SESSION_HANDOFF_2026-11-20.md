# Session Handoff — 2026-11-20

_Authoritative current-state bootstrap. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-11-18.md` for project state; that file's "After the laptop reset" checklist, "Gotchas", Phase A–C table and "Owner to-dos" still apply unchanged._

## TL;DR — where the project is

- **Audit remediation (`docs/plans/2026-11-12-audit-remediation.md`): Phases A, B, C and R are done; D, E, the Final gate and the release are not.**
- **Phase R (this session)** fixed the seven findings of a `/code-review` of Phases A–C. Four were gaps in B1's server-side turn persistence. Five tasks (R1–R5) plus one fix wave, each independently reviewed.
- **Phase R gate on `c975623`:** typecheck 0, lint 0 errors / 23 warnings, cold build OK, **174 files / 1567 tests** (two consecutive clean runs; see "Flaky test" below).
- **Released as v4.56.0 (2026-11-20, owner request)** — Phases A–C and R, pushed to `master` (auto-deploys). Migrations `0022`–`0024` were applied to production first (`drizzle.__drizzle_migrations` = 25 rows; `0022` found 0 duplicate chunks; `0024` dropped an empty `chat_topics` with no dependents). The Fable whole-branch review did **not** run before this release.
- **v4.56.1 (2026-11-26):** docs-only follow-up — `CLAUDE.md` trimmed and the env template moved to `.env.example` (from a `/doctor` pass). No code change.
- **Next action:** finish the release's live checks below, then Phase D (`D1`–`D3`), Phase E and the Fable whole-branch review, as a later release.

## What Phase R changed

| Task | Finding | Change | Commits |
|---|---|---|---|
| R1 | 1 | A send waits for the chat's history load; refused, draft kept, if the load fails | `709f4a5` |
| R2 | 2, 4 (client half) | The reply row is written at first savable content and checkpointed while it streams (tool-input start, tool call, step end, every 3 s) | `18f8155`, `48dad0a` |
| R3 | 4 (server half) | `vercel.json` enables request cancellation for `/api/chat` | `7e41b7c` |
| R4 | 3, 5 | Regenerate/Delete keep a generated image an artifact still embeds; stale `pending/` uploads are swept (next upload in that scope after 1 h; chat delete) | `ddf301e` |
| R5 | 6, 7 | Client caps the `/api/embed` body at 500,000 chars; two regenerate comments corrected | `5f38f6a` |
| Fix wave | phase review | Checkpoint updates are compare-and-set, so a turn whose row was taken over stops writing; title backfill skipped while a turn streams; usage and send-path docs corrected | `0bd2cf2`, `82c47da`, `c975623` |

## v4.56.0 release record (2026-11-20)

Done:

- **Release steps 1–2:** read-only pre-checks (0 duplicate chunks of 1,730; `chat_topics` empty, no dependents; every `usage_events` purpose passes the new CHECK), then migrations `0022`–`0024` applied with `drizzle-kit migrate` and verified (25 rows, unique index present, table dropped, CHECK widened, chunk count unchanged).
- **Push and deploy:** `master` = `589e82b`, tag `v4.56.0`, GitHub release published. Production deployment `atelier-8f9yesng7` is Ready and aliased to `atelier-ai-app.vercel.app`. CI passed.
- **`vercel.json` accepted:** the deploy build reported no unmatched `functions` pattern (Vercel fails the build on one).
- **Stop cancels on production (finding 4, verified live):** a chat-less Haiku request for a 2,000-word essay, with the connection dropped after 4 s, wrote no `usage_events` row after 90 s. A short control request that ran to completion wrote its row (2,848 in / 10 out). The function is terminated on disconnect, as R3 intended. The control left one tiny `usage_events` row with no chat.
- **Headers and gate:** `connect-src 'self'` plus the Supabase origin, `frame-ancestors 'self'`, no `X-Powered-By`, HSTS, nosniff, Referrer-Policy, Permissions-Policy. `/` redirects to `/login`; an unauthenticated `POST /api/chat` returns 401.
- **Release step 4:** the embeddings backfill embedded the 5 missing messages; 0 remain.

Still open (owner):

1. **In-app smoke** (needs a logged-in browser): switch chats mid-reply, press Stop, close the tab mid-reply, Review Focus 1–4. Each partial reply should be saved to the chat it was sent from, and a follow-up should land after it.
2. **Closing the tab now cuts the reply** (the partial is saved). This is the behaviour the route always documented; switching chats inside the app still never cuts a reply. If the owner wants a closed tab to let the reply finish, replace cancellation with an explicit stop endpoint.
3. **Pending-upload sweep against real Storage:** the sweep lists `attachments/<id|compose>/pending` without a trailing slash. Unit-tested with mocked Storage only.
4. **Release step 5:** add the Vercel WAF rate-limit rule on `POST /api/auth`.
5. **Owner decisions** carried from the 2026-11-18 handoff: repricing historical `usage_events` rows, and legacy hybrid PDFs' page stamps.
6. **Build warning:** `"engines": { "node": ">=22" }` makes Vercel build on Node 26.x instead of the project's 24.x setting. This predates the release; pin `"node": "24.x"` if 26.x causes trouble.

## Known gaps left open (recorded in the plan under Phase R, "Recorded, not fixed")

- A reply stopped during its **first step writes no `usage_events` row** (token counts are only known at step end). With cancellation on this becomes the common Stop case. The provider invoice is right; the in-app ledger under-counts.
- A killed function leaves no usage row for that turn, and loses the text after its last checkpoint.
- Four rare turn-persistence residuals: a `save` or `update` that fails after its commit; a same-text take-over; a superseded turn stopped in a second tab linking its images to the other turn's row. Closing the last two properly needs a row-ownership column (a migration).
- An abandoned extraction upload in a chat that is never uploaded to again and never deleted stays in Storage.

## Flaky test (take into Phase D1's test-hygiene sweep)

`tests/hooks/page-message-actions.test.tsx` fails 1–3 tests in some full-suite runs (3 of 5 runs today) and passes alone and in `tests/hooks` alone. The failures are in "Project settings (D1)" (opening the dialog from a menu) and once in "Delete on a message sent this session"; they fail after 2–4 s, well under the 15 s test timeout, and only in slow runs (219–296 s; the two clean runs took 142 s and 154 s). An implementer reproduced the same failures on the pre-Phase-R baseline. The error message was not captured. Likely cause, unconfirmed: Testing Library's 1 s `findBy`/`waitFor` default under CPU contention from the PGlite files.

## Quick links

- Plan: `docs/plans/2026-11-12-audit-remediation.md` (Phase R section, Release steps) · Audit: `docs/audits/2026-11-12-full-audit/`
- Routing: `docs/MODEL_ROUTING.md` · Prior handoff: `docs/SESSION_HANDOFF_2026-11-18.md`
