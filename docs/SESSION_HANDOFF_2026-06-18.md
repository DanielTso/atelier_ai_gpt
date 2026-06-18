# Session Handoff — 2026-06-18

_Resume doc for the next session. Read `docs/SESSION_HANDOFF.md` for the full A→D1 program history; THIS file captures what's in-flight as of 2026-06-18. Project CLAUDE.md is the source of truth for how the code works._

## 🏷️ Released v4.6.0 (2026-06-18)
Tagged **v4.6.0** (annotated) on `phase-c-extraction` + GitHub release published; version aligned to CHANGELOG (git-tag track was at `v2.1.0`, GitHub Releases at `v1.9.0` — reconciled to CHANGELOG's 4.x). **README.md fully rewritten** to current architecture (was describing the old Gemini/Turso/SQLite stack). PLAN.md Tech Stack block corrected; CHANGELOG gained a "Deployment & release" note under 4.6.0.
- **CI:** opened PR `phase-c-extraction → master` to run the CI workflow (lint→build→vitest→migrate→playwright) on the PR **without merging** — master held until the Preview native-canvas check passes.
- **➡️ NEXT: validate the Preview deploy** (upload a PDF → thumbnail renders = `@napi-rs/canvas` works on Vercel Linux), then **merge the PR to master** for the production cutover. Preview URL from `vercel ls atelier-ai`.

## Where we are
- **Program: A ✓ · B ✓ · B2 ✓ · C (C2+C-storage+C3) ✓ · D1 ✓.** All on branch **`phase-c-extraction`**, **pushed to origin** (`github.com/DanielTso/atelier_ai_gpt`). HEAD ≈ `4b8e99d` + any env/docs commits.
- **Supabase** project `evhgyudnjyryayazupgh` (`atelier_ai_gpt`) is live; migrations `0000`→`0005` applied. **Supabase MCP is connected** (OAuth) — `mcp__plugin_supabase_supabase__*` tools work.
- **RLS: ✅ DONE today** — enabled on all **11** public tables (verified `rls_on=11/11`). App still works because it connects as the `postgres` table owner (bypasses RLS); anon key only does Storage uploads.
- **D1 artifact smoke: ✅ PASSED today** — real Claude `generate_artifact` tool call → `.xlsx` rendered, stored, downloaded (6492 bytes, valid). Pipeline works end-to-end live.

## ✅ DONE — Vercel env push (2026-06-18)
All 8 env vars are set in Vercel (`danieltsos-projects/atelier-ai`) for **both Production and Preview** — confirmed via `vercel env ls production` / `vercel env ls preview` (each of the 8 listed in both). The 8: `DATABASE_URL, DIRECT_URL, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY`.
- **⚠️ FALSE-ALARM LESSON:** `verify-env.ps1` (length comparison via `vercel env pull`) reported `ALL_MATCH=False` with `prod=0` for everything. This is a **structural false negative** — Vercel stores these as **Sensitive/Encrypted** type, and `vercel env pull` **cannot read sensitive values back** (returns empty). Do NOT trust length/value comparison for sensitive vars. **Verify by PRESENCE** (`vercel env ls <env>`), not value.
- **CLI gotchas confirmed:** working push is `vercel env add <NAME> <production|preview> --value "<VALUE>" --force --yes` (piped stdin is ignored in non-interactive mode). Adding to **preview** also prompts interactively for a git-branch scope even with `--yes` — leave **blank** (Enter) to apply to all preview branches.
- **Note:** project is NOT linked via `.vercel/project.json`, but the CLI still resolves `danieltsos-projects/atelier-ai` for `env ls`/`env add`. Stale `TURSO_*` (old pre-Phase-B DB) + `DASHSCOPE_API_KEY` rows remain in Vercel — harmless, prune later if desired.
- Helper scripts (throwaway, in `c:\tmp\`): `set-vercel-env.ps1`, `verify-env.ps1` (deprecated — see false-alarm note), `diag-vercel-env.ps1`, `finish-vercel-env.ps1`.

## ⚠️ .env.local caution
`vercel link` / `vercel env pull` **overwrote `.env.local`** down to just `VERCEL_OIDC_TOKEN` earlier; I **restored** all 10 keys (DB pooled+session, Supabase URL/secret/anon, bucket, Anthropic, Gemini, DashScope). **Do NOT run `vercel env pull` / `vercel dev`** without expecting it to clobber `.env.local` again. Values are recoverable from `c:\tmp\set-vercel-env.ps1`'s source map / the restore command in the transcript. Note `DATABASE_URL`/`DIRECT_URL` use the **pooler** host `aws-1-us-east-2.pooler.supabase.com` (`:6543` runtime / `:5432` migrations); password `@`→`%40`.

## Pending USER / next-session actions
1. **Confirm Vercel env** (above) → `ALL_MATCH=True`.
2. **Deploy:** Vercel auto-deploys on push. Branch push already builds a **preview**. For **production**, merge `phase-c-extraction` → `master` and push (CLAUDE.md: don't push master without user OK — user approved deploy). Consider `superpowers:finishing-a-development-branch`.
3. **C2 native-canvas runtime check** on the Vercel preview (the one remaining C2 unknown): upload a PDF on the preview URL → if a thumbnail renders, `@napi-rs/canvas` works on Vercel Linux; else fall back to client-side pdf.js (documented in the C spec).
4. **Dev server** from earlier (`npm run dev`, was on :3000) may still be running in a stale background task — restart fresh if needed (it holds the pre-restore env in memory).

## Next build phase: D2 — Artifact workspace UI
Spec/plan not yet written. D2 = the artifact **panel** (live preview, **versioning**, edit/regenerate) + **PPTX**, building on D1's engine (`src/lib/artifacts/`, `generate_artifact` tool, `artifacts` table, `ArtifactCard`). Start with `superpowers:brainstorming` → spec → `writing-plans` → subagent-driven execution (the cadence used all session; role-frame implementers per [[feedback-role-based-agent-stack]]).

## Throwaway artifacts to clean up eventually
`scripts/smoke-c2-render.mjs`, `scripts/smoke-storage.mjs`, `scripts/smoke-documents-api.mjs`, `scripts/smoke-artifact.mjs`, `scripts/spike-vision-extract.mjs`, and `c:\tmp\*.ps1`.
