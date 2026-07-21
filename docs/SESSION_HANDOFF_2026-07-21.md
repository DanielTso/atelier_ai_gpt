# Session Handoff — 2026-07-21

_Authoritative current-state bootstrap for a new session. Read this first, then the project `CLAUDE.md` for how the code works. Supersedes `docs/SESSION_HANDOFF_2026-07-13.md`._

## TL;DR — where the project is

- **Grounded & Cited Answers is BUILT and review-clean, LOCAL on `master` — NOT pushed, migration `0017` NOT applied.** 14 local commits (spec/plan + 10 tasks + a build fix + a fix wave + docs). Subagent-driven build (Fable/Opus/Sonnet tiers), per-task reviews, one Major + two Mediums caught and fixed at review. 805 tests / 129 files; every commit gated (typecheck 0 · lint 0 err · **COLD** build · full single-threaded suite).
- Feature summary: Claude cites document-derived claims with `[cite:…]` markers → clickable chips → document preview at the cited PDF page or chunk passage; **Grounded pill** (+ persona defaults on the three contract/spec personas) restricts answers to project documents; **per-project source scoping** checkboxes in the Files rail. Full detail: CHANGELOG §4.53.0, spec `docs/specs/2026-07-17-grounded-cited-answers-design.md` (note the §C6 per-chat→per-project amendment of 2026-07-21).
- Shipped state (prod): still v4.51.0 code + the untagged Batch D dep slice (§4.52.0-Unreleased). CI green, prod healthy.

## 🚦 RELEASE CHECKLIST (user-gated, in order)

1. **Review**: the final whole-branch review verdict (below / ledger) + spec §C6 amendment.
2. **Apply migration `0017`** to Supabase FIRST: `DIRECT_URL=… npx drizzle-kit migrate` (2 nullable int columns on `document_chunks`; standing migrate-before-deploy rule — deployed Drizzle emits explicit column lists, an unmigrated DB breaks chunk queries app-wide).
3. **Say "push"** (auto-deploys). Then live smoke: grounded question on the Drover project → chips open pages; a text-contract question → chunk chip → extracted-text jump; check Vercel logs for `[cite-compliance]` lines (marker counts) and `[retrieval]` errors.
4. **Tag decision**: 4.52.0 (dep slice) + 4.53.0 can go out as one combined release or two tags — your call at push time.
5. Re-upload project docs when convenient — pre-0017 chunks have no page ranges (chunk-anchor citations still work; re-upload upgrades chips to page-level).

## What was built this session (2026-07-17 → 07-21, all local)

| Commits | What |
|---|---|
| `f3a4027`/`5c771d5` | Spec + 10-task plan (docs committed 07-17) |
| `652731a` | T1 migration 0017 (page_start/page_end) |
| `db1ed4e` | T2 chunk char offsets + page-anchor map (`src/lib/pageMap.ts`) |
| `b994b5c` | T3 ingest/replace stamp chunk page ranges |
| `06e2a9c` | T4 `[Source: …]` headers + document exclusion filters (both retrieval legs) |
| `30d36b2` | T5 citation contract + grounded guidance + scoped manifest/tool + `[cite-compliance]` log |
| `0022ba3` | T6 `src/lib/citations.ts` (CITE_RE grammar, splitter, stream-safe trimmer) |
| `c801da7` | **fix(build): Tailwind scanner ate `[cite:` literals → broken COLD builds** (`@source not` exclusions; see Gotchas) |
| `f6478d2` | T7 remark plugin + CitationChip + MessagesList wiring |
| `88564c7` | T8 DocumentPreviewDialog deep-links (`#page=N` / chunk scroll+highlight) |
| `bd67467` | T9 grounded pill + persona flags + scoping + page.tsx wire-through |
| `563d5ae` | T9 fix wave (review findings): **project-level scoping re-spec**, grounded reset on chat open, session-gated floor caption, shared `useLocalStorage` dynamic-key fix |
| (this commit) | T10 docs: CHANGELOG §4.53.0, CLAUDE.md, PERSONAS.md, this handoff |

**Review catches worth knowing:** T9's Fable review found the per-chat scoping had shipped as a session-global bucket resting on a `useLocalStorage` quirk (Major) → re-spec'd to per-project keys (spec amended); grounded could leak into standalone chats with the pill hidden (Medium) → reset-on-open + always-visible-when-ON; the floor caption false-positived on historical messages (Medium) → session turn-id set. The fix wave's `useLocalStorage` change fixed a real latent defect (key-change carry-over + phantom mount writes) — all 9 consumers audited safe; **initial values are no longer persisted until first real write**.

## Gotchas (new this session + carried)

- **⚠️ Tailwind v4 content scanner vs citation literals** (cost a debugging session): literal `[cite:` + digits in any SCANNED source file becomes an arbitrary-property CSS candidate; a nested test fixture emitted unparseable CSS that broke **cold builds only** (warm `.next` masked it — including Vercel's cache-assisted builds). `globals.css` carries `@source not` exclusions (tests/, docs/, e2e/, `src/app/api`, `citations.ts`, `documents/tool.ts`). New scanned files must describe markers, never exemplify them. **Gate builds are COLD now** (`rm -rf .next` first).
- **Subagent sessions + long vitest runs**: foreground 2-min timeout auto-backgrounds the suite and the subagent's session can end mid-gate (hit 3×: T2, T8, T9-API-error). Dispatches now say "run synchronously with a long timeout and WAIT"; if a subagent returns mid-gate, resume it or finish the gate as controller (T8 precedent).
- **Nits deferred to follow-ups** (final-review triage record in the ledger): pageRangeFor `<`/`<=` boundary tests unpinned; retrieval `–null` render (unreachable); guidance semicolon inconsistency; groundedRef sampled at completion-not-send (one-turn caption race); landing-compose keeps an ON pill (visible, pre-existing); T8 dialog tab-reset shipped in the fix wave.
- **Carried**: no Prettier; `git commit -F` via bash tool; migrate-before-deploy; Vercel preview behind auth; prod-affecting actions need the user to name them; npm 10/11 lockfile cross-validation before pushing lock changes (`npx npm@10 ci --dry-run` + `npm ci --dry-run`); full-suite runs ~11-13 min, 1-test flakes reproduce green on re-run.

## ⏳ Next session — open items and roadmap

1. **Release Grounded & Cited Answers** (checklist above) — then watch `[cite-compliance]` in Vercel logs for a week before considering the Gemini-Flash repair pass (spec'd, unbuilt, data-gated).
2. **Roadmap** (user-approved order): Code Phase C (Vercel Sandbox — needs user's security/cost decisions) → Batch D remainder (AI SDK v7 own spec; eslint 10; TS 7; react-hooks 7.1 rule adoption — 51 findings incl. refs-during-render worth a real review) → iteration-loop brainstorm (WITH user).
3. **Spec'd follow-ups** (Grounded & Cited Answers §Follow-ups): per-chat + mid-chat scoping surface, @-mention scoping, grounded/scope as DB columns, citation repair pass, NotebookLM-inspired backlog (ingest digests, report presets, audio brief).
4. **User re-tests still carried**: Tailwind 4.3 visual smoke (shipped 07-17, unverified); PDF preview/regeneration post-CSP-fix; Contract Abstract xlsx flow + 22-field review.

## Quick links

- Spec/plan: `docs/{specs,plans}/2026-07-17-grounded-cited-answers*`. CHANGELOG §4.53.0 + §4.52.0 (both Unreleased). Personas guide: `docs/PERSONAS.md`.
- SDD ledger (per-task record incl. review findings): `.superpowers/sdd/progress.md`.
