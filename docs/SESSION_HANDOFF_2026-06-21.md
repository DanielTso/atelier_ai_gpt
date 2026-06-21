# Session Handoff — 2026-06-21

_Resume doc. Read the newest dated handoff first; the undated `docs/SESSION_HANDOFF.md` holds long history. This file covers the **hardening pass** (v4.11.0–v4.14.0)._

## TL;DR
- A four-phase **hardening pass** is complete and shipped to `master` + GitHub-released. From a four-dimension audit (security, performance, robustness, code-health).
- **v4.11.0** Security · **v4.12.0** Robustness · **v4.13.0** Performance · **v4.14.0** Code-health. Each: gate-green → `--no-ff` merge → tag → release.
- Plan: `docs/plans/2026-06-21-hardening.md`. Gate every phase: `npm run lint` (0 errors), `npm run typecheck`, `npm run build`, `npm test` (**276 tests**).

## What shipped
- **v4.11.0 Security:** lightweight access gate (`src/middleware.ts` + `/login` + `/api/auth` + `src/lib/auth.ts`, HMAC cookie, **off unless `APP_ACCESS_PASSWORD` set**); model allow-list (`MODEL_IDS`); document-process `storagePath` derived server-side; `apiError` no prod detail + 3 routes unified; security headers/CSP; signed-URL TTL 3600→300s; xlsx injection guard.
- **v4.12.0 Robustness:** atomic transactional `acceptSuggestion` (SQL append, kills the `projects.memory` race) + rail debounce cancel; document-replace embeds-first then atomic `commitDocumentReplacement`; Zod-validated classify output; monotonic auto-memory trigger; artifact orphan-blob guard; `triggerSummarization` guard; `error.tsx`/`global-error.tsx`/`not-found.tsx`; shared `uiMessageSchema`.
- **v4.13.0 Performance:** RAG branches parallelized + first-turn rewrite skip; `Promise.all` in memory-suggest + chat routes; bounded `getAllArtifacts`; memoized `MessageBody`; `memory_suggestions` index (migration `0009`); flaky exceljs test stabilized.
- **v4.14.0 Code-health:** removed dead embeddings actions + `getChatWithSummary` alias; shared `src/lib/messageParts.ts` (`extractText`/`messageText`); `toArtifactSummary`; deduped `Project`/`Chat` interfaces; `typecheck` script + CI step; repo hygiene (committed brand md, gitignored scratch).

## ▶️ Remaining USER actions (gated / can't be done from here)
1. **Activate the access gate (optional but recommended):** set `APP_ACCESS_PASSWORD` (+ optional `AUTH_SECRET`) in `.env.local` and Vercel. Until set, the app stays open exactly as before. (Alternative: Vercel dashboard Password Protection.)
2. ~~Apply migration `0009`~~ ✅ **Done** (2026-06-21) — applied to live Supabase via Supabase SQL (the `drizzle-kit migrate` CLI was safety-blocked; the index DDL was run directly + verified). Note: drizzle's `__drizzle_migrations` journal on live wasn't updated, so a future `drizzle-kit migrate` will harmlessly re-run 0009 (idempotent DROP+CREATE INDEX).
3. **Browser-verify the CSP** on the deployed site (chat, document/PDF preview iframe, AI image render) — CSP couldn't be browser-tested locally; loosen `next.config.ts` `headers()` if anything is blocked.

## Deferred (explicitly out of scope this pass)
- Full per-user auth (Clerk + ownerId scoping) — its own project.
- `page.tsx` (1190+ lines) / `actions.ts` decomposition into hooks/domain modules.
- RAG result caching (rewrite/rerank LRU); `MessagesList` virtualization; console.error context tags.

## Operational facts (unchanged)
- No PRs (solo) — `--no-ff` merge to `master`, tag `vX.Y.Z`, `gh release create`. Live migrations / prod cutovers user-gated.
- Gate: `npm run lint` / `npm run typecheck` / `npm run build` / `npm test`. Don't run `vercel env pull`/`vercel dev`.
- Supabase project ref `evhgyudnjyryayazupgh`; migrations `0000`–`0009` (0009 pending live apply); RLS 13/13.
