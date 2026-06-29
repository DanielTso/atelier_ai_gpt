# Session Handoff — 2026-06-29

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes earlier dated handoffs (kept for history)._

## TL;DR — where the project is
- **Atelier Studio**: Next.js 16 App Router chat app, a Claude.ai-style clone for construction work. **Claude = brain** (chat, web search, tools); **Gemini = senses** (image gen + embeddings + internal housekeeping); **Tavily = web ingestion**. Supabase Postgres + pgvector via Drizzle. Deployed on Vercel. Single-password access gate (live).
- **Everything shipped to `master`, GitHub-released, CI green.** Current version **v4.40.0**. Working tree clean.
- **No half-done code.** Migrations `0000`–`0012` applied (`0012` = `generated_images`, applied to prod this session). **~500 unit tests pass.**
- **v4.40.0 was smoke-tested end-to-end on prod** (2026-06-29): PDF artifact preview serves via the proxy (200 · `application/pdf` · `SAMEORIGIN`); the **Images** hero is live; a real "build me a landing page" turn fired `generate_artifact` → created an HTML artifact (then cleaned up).
- Gate every tag: `npm run typecheck` (0) · `npm run lint` (**0 errors, 25 baseline warnings**) · `npm run build` · `npm test`. E2E runs in CI only — not locally (local `.env.local` has the gate ON + `DATABASE_URL` = production Supabase, so live/manual smoke is the **user's** job on deploy, OR a careful authenticated curl against prod).

## What shipped this session (newest first)
- **v4.40.0 — Warm aesthetic pass + PDF preview fix.** Images "Create images" hero (warm ambient glow, gradient Fraunces heading, tinted starter **template tiles** that seed the prompt, entrance motion + idle float, vertical-center when empty), bolder home greeting + glow, characterful empty states, project chat-list entrance motion + composer focus ring. **PDF fix:** artifact PDFs now stream through a **same-origin proxy** `GET /api/artifacts/:id/raw` (the cross-origin Supabase iframe was "content is blocked"); global framing headers relaxed `DENY`/`frame-ancestors 'none'` → **`SAMEORIGIN`/`frame-ancestors 'self'`** so the app can frame its own proxy (cross-origin clickjacking still blocked).
- **v4.39.0 — Project & Images layout refresh + readability fixes.** Project landing **composer-on-top** (type+send creates a chat in that project with its defaults), **lighter header** (← All projects, ⋮ Rename/Delete, 📌 pin), client-side **project pinning** (localStorage `pinned-project-ids`), centered chat column + **detached rail card**; Images **Gemini-style centered hero** + contained layouts. **Fixes:** light-mode **code blocks** readable (prose `--tw-prose-pre-code/-bg` overridden to foreground-on-muted); full **web-page/HTML requests now produce an HTML artifact** (strengthened `TOOL_GUIDANCE` in `/api/chat`) instead of an inline code dump.
- **v4.38.1 — Images: lightbox pop-out + working download.** Shared portal-based `src/components/ui/Lightbox.tsx` (used by Images + chat) so an ancestor stacking/overflow context can't hide it; `src/lib/download.ts` `downloadFile()` blob-fetches so the download saves on-page (the HTML `download` attr is ignored cross-origin).
- **v4.38.0 — Faster gallery loads + Home button.** Batched Supabase signed URLs — `createSignedDownloadUrls` / `signedArtifactUrls` in `storage.ts` (one request signs many, HTML split for download-disposition); used by `getAllArtifacts`, `getGeneratedImages` (now `.limit(60)`), `getChatAttachments`, the documents route. Parallelized the chat-open fetch waterfall. **Clickable sidebar logo → Home** (`SidebarHeader`/`CollapsedSidebar` → `createStandaloneChat`).
- **v4.37.0 — Brand-token migration.** ~110 functional `white/X`·`black/X` overlays → semantic tokens across 24 components (intentional dark scrims kept). `CLAUDE.md`'s "forbidden patterns" hard ban softened to a preference (opacity utilities OK for scrims/one-offs).
- **v4.36.0 — Images studio (Nano Banana 2 gallery + generate).** Dedicated **Images** sidebar view: prompt box (aspect ratio, optional project) → `POST /api/images/generate` (no chat turn) + a gallery (All / Standalone / per-project). New `generated_images` table (**migration `0012`, applied to prod**), `getGeneratedImages`/`deleteGeneratedImage`, shared `src/lib/image/generate.ts` (the chat `generate_image` tool reuses it).

## Live infrastructure
- **Supabase** project ref `evhgyudnjyryayazupgh`. Migrations `0000`–`0012` applied; drizzle ledger in sync. RLS on all tables. Bucket `atelier-files` (private, 200MB).
- **Vercel**: repo linked to project **`atelier-ai`** (prod alias **atelier-ai-app.vercel.app**). Auto-deploys on push to `master`. CLI installed + authed (`danieltso`). **`TAVILY_API_KEY` + the AI keys are set in Vercel env.** Env-var changes need a redeploy — **production deploy/redeploy is user-confirmed each time**.
- **Access gate LIVE** (`APP_ACCESS_PASSWORD` + `AUTH_SECRET`, cookie `atelier_auth`, `POST /api/auth {password}`). Guide: `docs/AUTH.md`.

## Useful gotchas learned this session
- **Vercel PREVIEW deployments sit behind Vercel Authentication** → `curl -I` of a preview returns *Vercel's* auth-page headers (e.g. `X-Frame-Options: DENY`, no app CSP), **not the app's**. Header-verify on **prod only** (atelier-ai-app.vercel.app is curlable). Visual/preview verification is the **user's** browser check.
- **The repo has NO Prettier config** (`@tailwindcss/typography` is a Tailwind plugin, unrelated). **Never run `prettier --write`** — it reformats whole files to double-quote+semicolon, diverging from the hand-written single-quote/no-semicolon style. Make minimal, class-only edits.
- **Tailwind v4.1 gradient utility is `bg-linear-to-br`** (renamed from `bg-gradient-to-*`).
- **Next.js header `source` can't negative-lookahead-exclude a path** (that's the *middleware matcher*, a different engine). To vary a security header per route, relax the global value (what we did for `SAMEORIGIN`) or set it in the route handler — don't rely on a `source` exclusion.
- **Aesthetic bar:** the user wants creative, distinctive UI in the warm + Fraunces brand (bold, not generic-AI-looking). Lean into the palette/serif/motion. (Saved to memory: `feedback_aesthetic_creative_design`.)

## Working cadence (the user expects this)
- Act as **Sr Fullstack Engineer**; decide, don't stall on small safe steps. New feature → brainstorm → spec (`docs/specs/`) → plan (`docs/plans/`) → subagent-driven execution (implementer + reviewer per task, fix loops, final review) → gate → ship. Small tweaks: branch, edit, gate, release.
- Solo dev → branch off `master`, then on the user's go: merge `--no-ff` → `npm version` bump → annotated tag `vX.Y.Z` → push `master` + tag → `gh release create` → watch CI → Vercel auto-deploys. Commit trailer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- **Verify visual/UI changes on a Vercel PREVIEW first** (push the branch → Vercel builds a preview → the user eyeballs it) before merging to prod. Used heavily this session.
- **User-gated & outward-facing**: production pushes/releases/redeploys + live DB migrations are **confirmed each time**. **Docs-only commits do NOT get a version tag.** Do NOT run `vercel env pull` / `vercel dev`.
- SDD scratch/ledger: `.superpowers/sdd/progress.md` (git-ignored) — recovery map after compaction.

## Open items (nothing in progress)
- **⚠️ USER — rotate `ANTHROPIC_API_KEY`.** It was printed once into a command's output when `.env.local` was shell-sourced (the file has a **UTF-8 BOM** on line 1, so `. ./.env.local` echoed that line incl. the key). Roll it in the Anthropic console, update `.env.local` (re-save **without BOM**) + Vercel. (Don't shell-source `.env.local`; read specific vars with `grep`.)
- **Document PDF previews** (`DocumentPreviewDialog`) still embed the cross-origin Supabase signed URL in an `<iframe>` — same pattern the artifact PDF had, so they may hit the same "content is blocked". Apply the same same-origin proxy if it recurs.
- **Perf follow-ups (deferred):** the per-chat artifact list (`GET /api/artifacts?chatId=` / `getChatArtifacts`) isn't batched yet; a **cross-switch gallery cache** would make re-entering Artifacts/Images instant.
- **Backburner:** Clerk per-user auth + project sharing (spec `docs/specs/2026-06-28-per-user-auth-design.md`, branch `feat/clerk-auth`); **Atelier Tasks** integration (separate future project — it's a Vite+Neon+Clerk SPA; integration = porting tasks-tied-to-projects into Studio).

## Quick links
- `CLAUDE.md` (source of truth for how the code works) · `CHANGELOG.md` (per-release detail) · `docs/AUTH.md`.
- GitHub releases: `v4.36.0` … `v4.40.0` at github.com/DanielTso/atelier_ai_gpt/releases.
