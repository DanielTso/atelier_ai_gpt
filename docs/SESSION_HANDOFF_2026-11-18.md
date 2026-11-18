# Session Handoff — 2026-11-18

_Authoritative current-state bootstrap. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-11-12.md`; its "Live state" and the 2026-09-11 handoff's rulings stay the reference for older items._

## TL;DR — where the project is

- **Audit remediation (`docs/plans/2026-11-12-audit-remediation.md`): Phases A, B and C are done; D, E, the final review and the release are not.** Every task was implemented by a subagent, reviewed by an independent subagent, fixed, and re-reviewed. Each phase gate passed. Phase C gate: typecheck 0, lint 0 errors / 23 warnings, cold build OK, **172 files / 1518 tests**.
- **The work is on branch `remediation/2026-11-12-audit` on GitHub — not on `master`.** It was pushed as a backup before a laptop reset. `master` auto-deploys to production, and the release needs migrations `0022`–`0024` applied first, then the Fable whole-branch review. **GitHub `master` is still `v4.55.1`; production is unchanged.**
- **Next action:** Phase D (`D1` dead-code sweep, `D2` make the docs true + Mermaid architecture diagram + `.env.example`, `D3` archive shipped docs), then Phase E (`E1`–`E3`), then the Final gate.

## After the laptop reset — resume checklist

1. Clone to `C:\dev\atelier_ai_gpt` (off OneDrive), then `git checkout remediation/2026-11-12-audit`. The local tag `pre-remediation` (= `c31188e`) is pushed too; it is the pre-remediation restore point.
2. Restore the gitignored files a clone does not carry (from your backup): **`.env.local`** (PRODUCTION Supabase + real keys; UTF-8 BOM on line 1 — keep it), `.vercel/`, `.claude/`, `.agents/`, `skills-lock.json`, `scripts/smoke-{artifact,documents-api,storage}.mjs`, `GradingPlanIFC.pdf`, `atelier_brand_board.html`, `docs/plans/Coding_Sessions_Agent_Stack_Reference.docx.pdf`.
3. Claude Code memory is keyed by path: restore `~/.claude/projects/c--dev-atelier-ai-gpt/memory/` (and the global `~/.claude/CLAUDE.md`), or the next session starts without it.
4. `npm ci`. The lockfile must pass **both** `npm ci --dry-run` and `npx -y npm@10 ci --dry-run`. If a dependency change drops vitest's nested esbuild entries, use `scripts/restore-vitest-esbuild-lock.mjs` (usage in its header).
5. Vercel CLI: `npm i -g vercel` then `vercel login` (device code). Never `vercel env pull` / `vercel dev` — they clobber `.env.local`.
6. Run the gate: typecheck → lint → `rm -rf .next && npm run build` → `npm test`. Expect **172 files / 1518 tests**.

## Gotchas learned this session

- **Vitest must run from an uppercase `C:` cwd** (PowerShell `Set-Location 'C:\dev\atelier_ai_gpt'`); a lowercase `c:/` cwd fails every file.
- **Use `--maxWorkers=4`** locally. Full parallelism makes PGlite `createTestDb()` hooks time out (30 s) at random — CPU load, not a code bug.
- **B1 reply persistence relies on `streamText`'s `experimental_transform`** (ai@6.0.230) plus `after(promise)`. Re-verify on any AI SDK upgrade; the final review must flag it.
- **Regenerate replaces the reply in place** (`src/lib/chatTurnDb.ts`, server-only, not a `'use server'` action) at persist time — a failed or early-stopped regenerate keeps the old reply. See "Chat turns" in `docs/architecture/data-flow.md`.
- **`backfillMissingEmbeddings` is a script, not a server action:** `npx -y tsx --env-file=.env.local scripts/backfill-embeddings.ts --dry-run` first. It writes to production — a release step.
- **Model routing in practice:** Opus implements and reviews anything multi-file, concurrent, auth, schema or cost-ledger; Sonnet re-reviews short fix rounds and does mechanical removals; tiny fix rounds were verified inline by the controller. Deviations are ledgered in the plan (`Ruling:` lines on C3 and C8).

## What Phases A–C changed (one line each; details in the plan and commits)

| Task | Change |
|---|---|
| A1 | `next` 16.4.6; axios, follow-redirects, xmldom, zod patched |
| A2 | CSP `connect-src` limited to self + Supabase; `X-Powered-By` off; `Permissions-Policy` |
| A3 | Login limiter reserves before awaiting; safe `next` redirects; `/login` exempt for GET/HEAD only; 503 without `AUTH_SECRET` in production |
| A4 | Document names sanitized (`promptSafeLabel`) before entering prompts |
| B1 | `/api/chat` saves each turn to the chat it was sent from; per-chat sessions; switching never stops a reply |
| B2 | Interrupted tool calls no longer break a chat; old tool outputs stubbed; 60-message cap without a summary |
| B3 | Moving a chat moves its artifacts, embeddings and usage |
| B4 | Deep links validated after all lists load; archived chats open |
| B5 | Archived chats restorable from the sidebar; dead sidebar actions removed |
| B6 | Large attachments go through Storage; image payload budget; size-specific errors |
| C1 | Retrieval degrades per leg with 4 s timeouts; fused hits survive MMR; identifier (SW-101) hits not crowded out |
| C2 | Embed failures surface (502); fail-fast embed pool; backfill script |
| C3 | Artifact DOCX/PDF/PPTX/XLSX fidelity; formula guard incl. TAB/CR; truncated regenerations rejected; regenerate streams |
| C4 | Failed replace keeps the prior status; compare-and-set claim; atomic ingest; migration `0022` (dedup + unique chunk index) |
| C5 | Every page anchored (correct citation pages on hybrid PDFs); skipped/capped pages recorded |
| C6 | Last-good model catalog on refresh failure; resolvers never throw; verified prices (Sonnet 5 $2/$10, per-model cache-read rates, Haiku 5.5 long-context); every LLM call recorded; migration `0023` |
| C7 | Double-send guard; page-level persistent error banner; feedback on every action |
| C8 | Project settings menus, message Delete/Regenerate, default system prompt restored |
| C9 | `/api/classify`, `chat_topics` (migration `0024`) and Gemini search grounding removed |

## Release (owner-approved steps, in order — see the plan's "Release steps")

1. Read-only pre-checks against production: duplicate `(document_id, chunk_index)` count; `pg_depend` check that nothing hand-made depends on `chat_topics`.
2. Apply migrations `0022`–`0024` (`DIRECT_URL=… npx drizzle-kit migrate`), verify the row count in `drizzle.__drizzle_migrations`. Then update CLAUDE.md's "Applied to Supabase" line.
3. Merge the branch to `master` and push (deploys), then live smoke: Review Focus 1–4, B1 (switch chats mid-reply, Stop, close the tab mid-reply), Stop → one `usage_events` row, CSP header.
4. `scripts/backfill-embeddings.ts --dry-run`, then the real run.
5. Vercel WAF rate-limit rule on `POST /api/auth`.

**Owner decisions waiting at release** (plan → "Deferred"): reprice historical `usage_events` rows (Sonnet 5 since 2026-09-01 ~1.5× high; cache reads on Opus/Sonnet 5.5 and Fable 5.x 2–4× high — Anthropic invoices were always right); legacy hybrid PDFs' wrong page stamps (re-upload vs null the stamps).

## Owner to-dos outside the code

- Revoke the removed Turso and DashScope credentials at the providers; remove `DASHSCOPE_API_KEY` from `.env.local`.
- Rotate the leaked Gemini keys (create the new key first, then replace it in all four places).
- Re-authorize Context7 (`/mcp`) and the claude.ai Supabase connector.
- Store `.env.local` in a password manager.

## Quick links

- Plan: `docs/plans/2026-11-12-audit-remediation.md` · Audit: `docs/audits/2026-11-12-full-audit/`
- Routing: `docs/MODEL_ROUTING.md` · Prior handoff: `docs/SESSION_HANDOFF_2026-11-12.md`
