# Session Handoff — 2026-11-12

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-09-11.md` (kept as the audit-remediation point-in-time record — its "Rulings", "Follow-ups deliberately deferred" and "Carried items" sections are still the reference for those items)._

## TL;DR — where the project is

- **Code is unchanged since `v4.55.0`** (shipped 2026-09-13). This session produced docs only, released as `v4.55.1` so the repo could be re-cloned off OneDrive.
- **The repo is moving from OneDrive to a local drive.** OneDrive resurrected six files deleted as dead code in `6102f14`, caused `EBUSY`/`EPERM` and a `TS6053` placeholder failure, and made commands hang. A fresh clone does not contain the six files — they were never committed back.
- **Next action: execute `docs/plans/2026-11-12-sidebar-review-fixes.md`** (3 tasks, Opus implementers, Fable final review) in the new clone. Source findings: `docs/audits/2026-11-12-sidebar-code-review.md`.

## After cloning — set-up checklist

1. Clone to a short path outside any synced folder (not under the OneDrive-redirected `Documents`).
2. Copy the gitignored files a clone does not carry from the old OneDrive folder: **`.env.local`** (points at PRODUCTION Supabase; UTF-8 BOM on line 1 — keep it), **`.vercel/`**, `.claude/`, `.agents/`, `skills-lock.json`, `scripts/smoke-{artifact,documents-api,storage}.mjs`, `GradingPlanIFC.pdf`, `atelier_brand_board.html`, `docs/plans/Coding_Sessions_Agent_Stack_Reference.docx.pdf`; `.superpowers/` only if the 2026-09-11 SDD ledger is wanted.
3. `npm ci` (do not copy `node_modules`/`.next`). The lockfile must stay valid for BOTH npm 10 (CI) and npm 11 (local) — see the 2026-09-11 handoff, finding 9.
4. Claude Code memory is keyed by project path: copy `~/.claude/projects/c--Users-dnlts-OneDrive-Documents-01-Projects-01-Coding-03-atelier-ai-gpt/memory/` into the new path's project folder, or the new session starts without it.
5. Run the gate (typecheck → lint → `rm -rf .next && npm run build` → `npm test`); expect 143 files / 999 tests, matching CI.
6. Back up `.env.local` in a password manager — OneDrive was its only backup.
7. Update the global `~/.claude/CLAUDE.md` line "Projects live under OneDrive".

## Live state verified this session

- **Gemini credits**: depleted 2026-10-16 ~17:22 (broke `/api/embed` and `/api/generate-title`); **topped up by the user**. Live probe 2026-11-12: `gemini-embedding-001` `embedContent` → HTTP 200, 768-dim vector.
- **Unmeasured: the embedding gap from the outage.** `/api/embed` returns 200 on failure by design, so messages/chunks written while credits were out may have no vectors. A read-only query (messages LEFT JOIN `message_embeddings` by day; `document_chunks.embedding IS NULL` by day; since 2026-10-01) hung from the OneDrive folder — re-run it from the clone, then decide on a backfill.
- **Cost ledger works in production** (checked 2026-10-16): 74 `usage_events` rows, zero `$0 / cost_estimated=false / claude-*` rows — the first-wins guard holds live.
- **Model registry** picked up Claude Sonnet 5.5 with no code change.

## Open items, in suggested order

1. **Sidebar review fixes** — `docs/plans/2026-11-12-sidebar-review-fixes.md` (archived chats unreachable = audit F2; dead `createChat` removal).
2. **Security patch release** (as of 2026-10-16 — re-run `npm audit` first): `next@16.3.8` clears 7 advisories incl. a reachable Image-Optimization SSRF (`/_next/image` is outside the `src/proxy.ts` auth matcher); `axios >=1.20.0` (12 advisories via `@tavily/core`, in-range under its `^1.7.7`). Validate the lockfile against npm 10 AND npm 11.
3. **PDF chat-attachment failure** ("Failed to process …Geotech Report….pdf"). Root cause: `ChatInputArea` sends non-image files to `POST /api/extract` with no client size check; Vercel's **4.5 MB request-body limit** rejects larger files before the function runs, the non-JSON platform response makes `res.json()` throw, and the catch shows the generic toast (`ChatInputArea.tsx:193-209`). Fix: (a) client size guard + `res.text()` fallback so it reports "too large"; (b) route chat attachments through the signed direct-to-Storage flow `useDocumentUpload` already uses. `MAX_FILE_SIZE` (200 MB) is unreachable on that path.
4. **Embedding-gap check + backfill** (see above).
5. **Optional: move Gemini housekeeping text to `claude-haiku-5-5`** ($0.10/$0.50 per MTok, 1M context) — title, summarize, classify, memory-suggest, query-rewrite, rerank. Cannot move: embeddings (Anthropic has no embeddings API; switching provider means re-embedding + possibly a `vector(768)` migration) and image generation. Vision extraction could move but is a real port (segment machinery tuned to Gemini's PDF cap).
6. **Audit Phase 3** (unplanned): F1 wrong-chat write (Critical), F3 duplicate re-save, X1 hybrid page anchors, X5 PDF curly quotes, X4 storage sweeps, F6 error banner, C3 alias canonicalization, C5 five unrecorded LLM sites (needs a `usage_events_purpose_chk` migration). F2 is covered by item 1.
7. **Live smoke still owed**: deliberate Stop mid-stream on a multi-step turn → exactly one `usage_events` row.

## Quick links

- Plan: `docs/plans/2026-11-12-sidebar-review-fixes.md` · Findings: `docs/audits/2026-11-12-sidebar-code-review.md`
- Prior: `docs/SESSION_HANDOFF_2026-09-11.md`, `docs/audits/2026-09-01-codebase-audit.md`, `docs/MODEL_ROUTING.md`
