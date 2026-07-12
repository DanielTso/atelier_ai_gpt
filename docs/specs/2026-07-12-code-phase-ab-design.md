# Code Phase A/B — syntax highlighting, code artifacts, Contract Abstract (design)

Date: 2026-07-12. Status: **designed under delegated authority** — user approved the
scope (all three in one spec) and the code-artifact type model, then delegated the
remaining technical decisions ("I will let you work out the technical details" /
"keep going"). **Review this spec on return**; the one domain-heavy piece (the
Contract Abstract field list) is a single editable constant.

## Scope (user-approved: all three, one spec)

- **A. Shiki syntax highlighting** in the chat `CodeBlock` (currently monochrome).
- **B. Code-file artifacts** — `.py`/`.sh`/`.ts` etc. as first-class artifacts with
  highlighted preview, download with the right filename, and versions (free via
  `artifact_versions`).
- **C. Contract Abstract persona** — locked field schema, extraction-only, xlsx output.

User context: heavy Linux/bash/Python user learning AI engineering (Atelier serves
scripting workflows), construction PM (contract abstracts are a real deliverable).
SaaS trajectory: keep the language registry and field schema as single-source
constants other surfaces can reuse.

## Locked decisions

| Decision | Choice | Rejected |
|---|---|---|
| Artifact modeling | **One `'code'` ArtifactType + `language` field** (user-picked) | Per-extension types (permanent churn tax); untyped text passthrough (type stops meaning anything) |
| Highlighter | **shiki, fine-grained client bundle, lazy singleton** (`src/lib/highlighter.ts`), JS regex engine (no WASM), grammars loaded on demand | Prism (weaker grammars/theming); server-side highlighting (kills streaming; artifacts already preview client-side) |
| Themes | **`vitesse-light` / `vitesse-dark`** via shiki dual-theme CSS variables (fits the warm palette; `html.dark` toggles) | Custom warm theme (later polish if wanted) |
| Streaming perf | **Debounced highlight inside `CodeBlock`** (~150ms after content stabilizes), plain `<pre>` until then and for unknown languages — progressive enhancement, zero flash-of-broken | Highlighting every token render (thrashes the memoized markdown pipeline) |
| Code file bytes | **Passthrough like HTML** — the model's code string IS the file; `text/plain; charset=utf-8` (Supabase only mangles text/html) | Rendering/transform layers (nothing to render) |
| Contract Abstract | **New built-in persona** (`contract-abstract`, Fable/max like the existing Contract & Spec Analyst) whose prompt embeds the locked schema and mandates a `format:'sheets'` xlsx via `generate_artifact` | New artifact type or bespoke endpoint (the artifact engine already does everything needed) |

## Design — A. Chat syntax highlighting

**`src/lib/highlighter.ts` (new, client).** Lazy singleton around shiki's
`createHighlighterCore` + `createJavaScriptRegexEngine`:

- `codeToHtmlSafe(code: string, lang: string): Promise<string | null>` — `null` for
  unsupported/failed languages (caller keeps the plain block). Grammars dynamic-import
  on first use per language; themes registered once.
- v1 grammars: `python, bash, typescript, tsx, javascript, jsx, json, yaml, sql,
  markdown, html, css, diff, powershell` (aliases: `sh|shell|zsh→bash`, `py→python`,
  `ts→typescript`, `js→javascript`, `ps1→powershell`). One `LANG_ALIASES` map, one
  place to extend.
- Dual theme output (`themes: { light: 'vitesse-light', dark: 'vitesse-dark' }`);
  `globals.css` gains the standard shiki dark-mode variable flip scoped under
  `html.dark`.

**`CodeBlock.tsx`.** Extracts `language-*` from the child `<code>` className; a
debounced effect calls `codeToHtmlSafe` and swaps in the highlighted HTML
(`dangerouslySetInnerHTML` — shiki output is trusted, generated locally from text).
Until resolved (or when `null`): today's plain `<pre>`, unchanged. Copy button reads
`textContent` — works identically on both renderings. No changes to `MessagesList`'s
memoization.

## Design — B. Code artifacts

**`src/lib/artifacts/code.ts` (new).** The language registry — single source of truth:

```
CODE_LANGUAGES: { id: 'python'|'bash'|'typescript'|'javascript'|'sql'|'json'|'yaml'|'markdown'|'powershell', label, ext ('py'|'sh'|'ts'|…), shikiLang }
```

**Engine changes.**
- `types.ts`: `ArtifactType` += `'code'`; `RenderedArtifact.ext` widens to `string`
  (code files carry their language's extension; existing types keep returning
  themselves).
- `render.ts`: `renderArtifact` gains an optional `language` arg; `'code'` branch is a
  passthrough Buffer with `text/plain; charset=utf-8` and `ext` from the registry.
- `tool.ts` (`generate_artifact`): `type` enum += `'code'`; `format` enum += `'code'`;
  new optional `language` input (enum of registry ids) required when `type==='code'`
  (Zod refine); description extended — a code artifact is for a COMPLETE runnable
  file the user asked to have as a file ("write me a script", "save as .py", "make a
  bash script I can run"); snippets and explanations stay in chat (chat-first
  unchanged).
- `TOOL_GUIDANCE` (chat route): one sentence mirroring that rule.
- Server routes that validate artifact types (edit/regenerate, `validation.ts`
  schemas): extend their enums — implementation task greps every `xlsx|docx|pdf|pptx|
  html` enum literal.

**UI.**
- `ArtifactPreview`: `type==='code'` → shiki-highlighted read-only block (same
  `codeToHtmlSafe`, plain `<pre>` fallback), monospace, scrollable.
- `ArtifactCard` / gallery icons: `FileCode` icon; `ARTIFACT_TYPE_LABELS` += `code:
  'Code'`; the card subtitle shows the language label.
- Workspace Edit tab already edits source text — works for code as-is; Versions free.
- Downloads: storage path uses the registry `ext`, so files land as `deploy.sh`,
  `parse_submittals.py`, etc.

## Design — C. Contract Abstract persona

New built-in in `usePersonas.ts`: `{ id: 'contract-abstract', name: 'Contract
Abstract', icon: '🗂️', model: 'claude-fable-5', effort: 'max' }` (same tier as the
existing Contract & Spec Analyst — this is critical contract work).

**Prompt contract (the "locked schema"):**
- Extraction-only: fill fields ONLY from the provided contract documents (project RAG
  chunks + `read_document`); a field with no support = `Not found in provided
  documents` — never inferred, never invented. Every filled field cites its source
  (article/section/exhibit).
- Output on "abstract this contract": (1) a short chat summary of the 3–5 highest-risk
  terms, then (2) a `generate_artifact` call — `type:'xlsx'`, `format:'sheets'`, one
  sheet `Contract Abstract`, header row `Field | Value | Source Ref`, rows in EXACT
  schema order, no fields added or removed.
- `CONTRACT_ABSTRACT_FIELDS` (editable constant, one place, review-me): Project Name ·
  Contract Title/Number · Owner · Contractor · Architect/Engineer · Contract Type
  (LS/GMP/T&M/Unit Price) · Contract Sum · Retainage % · Notice to Proceed ·
  Substantial Completion · Final Completion · Liquidated Damages · Payment Terms ·
  Schedule of Values Requirements · Insurance Requirements · Bond Requirements ·
  Warranty Period · Notice Requirements (claims/delays) · Change Order Markup % ·
  Dispute Resolution · Termination Provisions · Key Exclusions

No engine changes needed — C is prompt + persona registration only, riding on B's
sibling infrastructure (xlsx already exists).

## Non-goals

Code execution (that's Code Phase C / Vercel Sandbox); line numbers/diff view in
previews; editable highlighted editor (Edit tab stays plain textarea); custom shiki
theme; per-user custom contract schemas (SaaS-era feature); highlighting inside
artifact HTML pages (the model styles those itself).

## Testing & verification

- `highlighter.ts` alias/fallback logic (shiki itself mocked in jsdom tests);
  `CodeBlock` renders plain pre → swaps highlighted HTML (mocked), copy works on both.
- `code.ts` registry integrity (ids unique, exts sane); `render.ts` code branch
  (bytes, contentType, ext); `tool.ts` Zod — code without language rejected, with
  language accepted; route enums accept `code`.
- `ArtifactPreview` code branch (mocked highlighter); labels/icons.
- Persona: registry contains `contract-abstract` with locked prompt containing every
  schema field (guards against accidental field drift).
- Full gate; live smoke after user-gated push: ask for a bash script file → code
  artifact downloads as `.sh` with highlighted preview; chat code blocks colored;
  Contract Abstract persona on a real contract → xlsx with the locked rows.

## Definition of done

All three slices implemented + unit-tested; gate green; CHANGELOG (4.50.0) +
CLAUDE.md updated; committed locally; push + live smoke user-gated; user reviews the
field schema constant and this spec on return.
