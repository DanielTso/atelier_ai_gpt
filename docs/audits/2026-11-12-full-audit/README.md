# Full codebase audit — 2026-11-12

Read-only audit of `master` at `b64850c` (v4.55.1 + the CLAUDE.md split), run as four parallel review lanes on **Claude Fable 5.2** (the owner's choice for code review), controller on Opus 5.5. No repo files, database rows or production settings were changed by the lanes. Each lane report is in this folder and carries file:line evidence, the probe or trace behind every finding, and a re-verification of every prior finding in its area.

| Lane | Report | New findings | Prior items re-verified |
|---|---|---|---|
| Security | [security.md](security.md) | S1–S7 (0 Critical, 0 High, 3 Medium, 4 Low) | 9 + Low list; most still open, all low reachability |
| Back end | [backend.md](backend.md) | B1–B26 (3 High, 11 Medium, 12 Low) | 33: 4 fixed, 1 partial, 27 open, 1 needs prod |
| Front end | [frontend.md](frontend.md) | U1–U20 (1 Critical, 3 High, 8 Medium, 8 Low) | F1–F20 + §2.5 Lows: only F4 mostly fixed |
| Dead code & docs | [deadcode-docs.md](deadcode-docs.md) | 27 dead code, 6 deps, 14 stale comments, 31 wrong doc claims, 7 test hygiene, 9 clutter | 38: 5 fixed |

Supersedes the open-items list in `docs/audits/2026-09-01-codebase-audit.md` (its IDs F*, C*, D*, X*, S* are re-verified inside the lane reports and keep their names).

## Controller corrections to the lane reports

- **backend.md "Doc drift: CLAUDE.md still says SQLite"** is wrong: those lines were fixed in `b64850c` before the lanes ran (`grep -i sqlite CLAUDE.md docs/architecture/*.md` → 0). Its other drift points stand.
- **security.md S3** names `next` ≥ 16.4.1 as the fix; 16.4.6 is the newest 16.4 release on npm (published versions checked 2026-11-12).
- **deadcode-docs.md pricing note** (seed/`EXACT_PRICING` still list Opus 4.8 / Sonnet 5 / Haiku 4.5 while the live catalog serves newer models) is PLAUSIBLE until the live catalog and current published prices are checked; current-model cost rows would be family-tier estimates.

## What matters most (in fix order)

1. **Data loss — reply dropped / written to the wrong chat** (U1 = prior F1, Critical): leaving a chat mid-stream loses the reply and leaks it into the next new chat. Related: F3 duplicate re-save, U3 wrong-project tagging, U2 project-chat deep link lands on the landing page.
2. **Chat session goes dead after Stop during a tool call** (B1, High) — one-line `ignoreIncompleteToolCalls` fix.
3. **Moving a chat orphans its artifacts/embeddings onto the old project** (B2, High) — deleting that project then cascade-deletes them.
4. **Attachments over Vercel's 4.5 MB body limit fail with a generic error and are lost on refresh** (U4 + handoff item 3).
5. **Security hardening** — CSP `connect-src https:` exfiltration channel for auto-opened HTML artifacts (S1), parallel-guess login throttle bypass (S2), `next` Server Actions DoS reachable via POST `/login` (S3), `?next=` open redirect (S4); dependency patch (`next` 16.4.x, `axios`, `follow-redirects`, `@xmldom/xmldom`, `zod`).
6. **Context bloat & retrieval quality** — `read_document` outputs replayed every turn (B3), failed summarize drops messages (B4), MMR discards RRF order (B5), live session re-injected as "previous conversations" (B9), no Gemini timeouts (B11), embed failures never retried (B13 — the October gap).
7. **Unreachable features** — per-project defaults dialog, message Delete/Regenerate, "Default system prompt" (write-only), `/api/classify` + `chat_topics`, Google Search grounding, archived chats (F2).
8. **Docs** — README ~20 releases stale, 31 wrong claims across CLAUDE.md / `docs/architecture` / PERSONAS / AUTH, no `.env.example`, `/api/files/raw` gate exemption undocumented.

## Proposed fix phases

Each phase lands as local commits on `master` after the repo gate (typecheck → lint → cold build → `npm test` from an uppercase `C:\` cwd). Nothing is pushed without the owner's approval.

| Phase | Scope |
|---|---|
| A — Security & deps | S1–S4, S7; `next` 16.4.x + transitive patches; lockfile validated with npm 10 and npm 11 |
| B — Data integrity (Critical/High) | U1/F1, F3, U2, U3, U4 + PDF attachments, B1, B2, B3 |
| C — Correctness (Medium) | B4–B14, U5–U12, F6, F8, F9 |
| D — Dead code, sidebar plan & docs | `docs/plans/2026-11-12-sidebar-review-fixes.md` (F2, dead `createChat`), D-items, deps hygiene, stale comments, README + doc corrections, test hygiene, repo clutter |
| E — Low | remaining Low items across all lanes |

Open owner decisions are recorded in the remediation plan once taken.
