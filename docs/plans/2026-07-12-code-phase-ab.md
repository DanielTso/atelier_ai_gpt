# Code Phase A/B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shiki syntax highlighting in chat, a first-class `'code'` artifact type (.py/.sh/.ts files with highlighted preview, correct download names, versions), and a Contract Abstract persona with a locked field schema.

**Architecture:** One lazy client-side shiki singleton (`src/lib/highlighter.ts`) serves both chat `CodeBlock` and `ArtifactPreview`. The artifact engine gains a passthrough `'code'` type whose `language` lives in the existing `format` column (`type='code'`, `format='python'`) — zero schema changes; edit/regenerate re-derive the extension from it. The persona is prompt-only, riding the existing xlsx path.

**Tech Stack:** shiki v3 (fine-grained core + JS regex engine, no WASM), existing AI SDK v6 tool, ExcelJS path unchanged.

**Spec:** `docs/specs/2026-07-12-code-phase-ab-design.md` (user reviews on return — field schema is one editable constant).

## Global Constraints

- Style: single-quote/no-semicolon in `src/lib`/`src/hooks`/tests; `CodeBlock.tsx`/`MessagesList.tsx`/routes use double quotes or semicolons — match each file. NEVER Prettier.
- Full suite (PowerShell): `$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism`; typecheck must stay 0.
- Local commits only (Conventional Commits); NO push (user-gated).
- Themes exactly `vitesse-light` / `vitesse-dark`; v1 grammar list exactly as in Task 1.
- Code artifacts: `format` column = language id; content is ALWAYS a string for code.

---

### Task 1: shiki highlighter singleton

**Files:**
- Create: `src/lib/highlighter.ts`
- Modify: `src/app/globals.css` (append), `package.json` (dep)
- Test: `tests/unit/lib/highlighter.test.ts`

**Interfaces:**
- Produces: `resolveShikiLang(lang: string | null | undefined): string | null` (pure — alias map + supported check); `codeToHtmlSafe(code: string, lang: string | null | undefined): Promise<string | null>` (null = caller keeps plain rendering); `SHIKI_LANGS` (the v1 grammar ids). Tasks 2 and 5 consume `codeToHtmlSafe`; Task 3's registry references these ids in its `shikiLang` field.

- [ ] **Step 1: Install shiki**

Run: `npm install shiki`
Expected: adds `shiki` to dependencies (v3.x).

- [ ] **Step 2: Write the failing test** — `tests/unit/lib/highlighter.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveShikiLang, SHIKI_LANGS } from '@/lib/highlighter'

describe('resolveShikiLang', () => {
  it('passes through supported languages', () => {
    expect(resolveShikiLang('python')).toBe('python')
    expect(resolveShikiLang('typescript')).toBe('typescript')
  })
  it('maps common aliases', () => {
    expect(resolveShikiLang('sh')).toBe('bash')
    expect(resolveShikiLang('shell')).toBe('bash')
    expect(resolveShikiLang('zsh')).toBe('bash')
    expect(resolveShikiLang('py')).toBe('python')
    expect(resolveShikiLang('ts')).toBe('typescript')
    expect(resolveShikiLang('js')).toBe('javascript')
    expect(resolveShikiLang('ps1')).toBe('powershell')
    expect(resolveShikiLang('yml')).toBe('yaml')
  })
  it('is case-insensitive and returns null for unknown/empty', () => {
    expect(resolveShikiLang('Python')).toBe('python')
    expect(resolveShikiLang('brainfuck')).toBeNull()
    expect(resolveShikiLang('')).toBeNull()
    expect(resolveShikiLang(null)).toBeNull()
    expect(resolveShikiLang(undefined)).toBeNull()
  })
  it('exposes the v1 grammar list', () => {
    for (const l of ['python', 'bash', 'typescript', 'tsx', 'javascript', 'jsx', 'json', 'yaml', 'sql', 'markdown', 'html', 'css', 'diff', 'powershell']) {
      expect(SHIKI_LANGS).toContain(l)
    }
  })
})
```

- [ ] **Step 3: Run to verify FAIL** — `npx vitest run tests/unit/lib/highlighter.test.ts` → module not found.

- [ ] **Step 4: Implement `src/lib/highlighter.ts`**

```ts
// Lazy client-side shiki singleton shared by the chat CodeBlock and the code
// ArtifactPreview. Fine-grained core + the JS regex engine (no WASM download);
// grammars dynamic-import on first use per language; dual vitesse themes emit
// CSS variables that globals.css flips under html.dark. Unsupported languages
// resolve to null so callers keep their plain <pre> rendering.
import type { HighlighterCore } from 'shiki/core'

export const SHIKI_LANGS = [
  'python', 'bash', 'typescript', 'tsx', 'javascript', 'jsx', 'json', 'yaml',
  'sql', 'markdown', 'html', 'css', 'diff', 'powershell',
] as const

const ALIASES: Record<string, string> = {
  sh: 'bash', shell: 'bash', zsh: 'bash',
  py: 'python',
  ts: 'typescript', js: 'javascript',
  yml: 'yaml',
  ps1: 'powershell', pwsh: 'powershell',
  md: 'markdown',
}

export function resolveShikiLang(lang: string | null | undefined): string | null {
  if (!lang) return null
  const l = lang.toLowerCase()
  const resolved = ALIASES[l] ?? l
  return (SHIKI_LANGS as readonly string[]).includes(resolved) ? resolved : null
}

let corePromise: Promise<HighlighterCore> | null = null
const loadedLangs = new Set<string>()

async function core(): Promise<HighlighterCore> {
  if (!corePromise) {
    corePromise = (async () => {
      const [{ createHighlighterCore }, { createJavaScriptRegexEngine }, light, dark] = await Promise.all([
        import('shiki/core'),
        import('shiki/engine/javascript'),
        import('@shikijs/themes/vitesse-light'),
        import('@shikijs/themes/vitesse-dark'),
      ])
      return createHighlighterCore({
        themes: [light.default, dark.default],
        langs: [],
        engine: createJavaScriptRegexEngine(),
      })
    })()
  }
  return corePromise
}

async function ensureLang(h: HighlighterCore, lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true
  try {
    const mod = await import(`@shikijs/langs/${lang}`)
    await h.loadLanguage(mod.default)
    loadedLangs.add(lang)
    return true
  } catch {
    return false
  }
}

/** Highlight to dual-theme HTML, or null when the language is unsupported or
 * shiki fails for any reason — callers fall back to their plain rendering. */
export async function codeToHtmlSafe(code: string, lang: string | null | undefined): Promise<string | null> {
  const resolved = resolveShikiLang(lang)
  if (!resolved) return null
  try {
    const h = await core()
    if (!(await ensureLang(h, resolved))) return null
    return h.codeToHtml(code, {
      lang: resolved,
      themes: { light: 'vitesse-light', dark: 'vitesse-dark' },
    })
  } catch {
    return null
  }
}
```

- [ ] **Step 5: Append the dark-mode variable flip to `src/app/globals.css`**

```css
/* Shiki dual-theme: light values inline; dark values flip via CSS variables
   under the class-based dark mode (next-themes sets .dark on <html>). */
html.dark .shiki,
html.dark .shiki span {
  color: var(--shiki-dark) !important;
  background-color: var(--shiki-dark-bg) !important;
}
```

- [ ] **Step 6: Run to verify PASS** (`npx vitest run tests/unit/lib/highlighter.test.ts`), `npm run typecheck` → 0. Note: the test only exercises the PURE parts (`resolveShikiLang`, `SHIKI_LANGS`) — `codeToHtmlSafe` imports shiki lazily so the test never loads it. If the `@shikijs/langs`/`@shikijs/themes` subpath imports fail typecheck (they're transitive deps of `shiki`), install them explicitly: `npm install @shikijs/langs @shikijs/themes` (same versions shiki pins).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/lib/highlighter.ts src/app/globals.css tests/unit/lib/highlighter.test.ts
git commit -m "feat(code): shiki highlighter singleton with lazy grammars + dual vitesse themes"
```

---

### Task 2: CodeBlock highlighting

**Files:**
- Modify: `src/components/chat/CodeBlock.tsx`
- Test: `tests/hooks/CodeBlock.test.tsx` (extend if it exists — check first — else create)

**Interfaces:**
- Consumes: `codeToHtmlSafe` (Task 1).
- Produces: unchanged `CodeBlock` props (`children`, `className`) — MessagesList needs NO changes.

- [ ] **Step 1: Write the failing tests** (create or extend `tests/hooks/CodeBlock.test.tsx`; if extending, merge with the existing file's style/mocks):

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const codeToHtmlSafeMock = vi.fn()
vi.mock('@/lib/highlighter', () => ({
  codeToHtmlSafe: (...a: unknown[]) => codeToHtmlSafeMock(...a),
}))

import { CodeBlock } from '@/components/chat/CodeBlock'

afterEach(() => { cleanup(); codeToHtmlSafeMock.mockReset() })

describe('CodeBlock highlighting', () => {
  it('renders plain pre immediately, then swaps in highlighted HTML', async () => {
    codeToHtmlSafeMock.mockResolvedValue('<pre class="shiki"><code><span style="color:#B07D48">hi</span></code></pre>')
    render(
      <CodeBlock className="language-python">
        <code className="language-python">print('hi')</code>
      </CodeBlock>
    )
    expect(screen.getByText("print('hi')")).toBeTruthy()
    await waitFor(() => expect(document.querySelector('.shiki')).toBeTruthy(), { timeout: 2000 })
    expect(codeToHtmlSafeMock).toHaveBeenCalledWith("print('hi')", 'python')
  })

  it('keeps the plain pre when the language is unsupported', async () => {
    codeToHtmlSafeMock.mockResolvedValue(null)
    render(
      <CodeBlock className="language-brainfuck">
        <code className="language-brainfuck">+++</code>
      </CodeBlock>
    )
    await waitFor(() => expect(codeToHtmlSafeMock).toHaveBeenCalled(), { timeout: 2000 })
    expect(document.querySelector('.shiki')).toBeNull()
    expect(screen.getByText('+++')).toBeTruthy()
  })

  it('copy button copies from the highlighted rendering too', async () => {
    codeToHtmlSafeMock.mockResolvedValue('<pre class="shiki"><code>copied-content</code></pre>')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    render(
      <CodeBlock className="language-python">
        <code className="language-python">copied-content</code>
      </CodeBlock>
    )
    await waitFor(() => expect(document.querySelector('.shiki')).toBeTruthy(), { timeout: 2000 })
    screen.getByTitle('Copy code').click()
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('copied-content'))
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run tests/hooks/CodeBlock.test.tsx` (no `.shiki` ever appears).

- [ ] **Step 3: Implement in `CodeBlock.tsx`** (double-quote style; keep the existing copy logic and props):

```tsx
"use client"

import { useEffect, useRef, useState } from "react"
import { Check, Copy } from "lucide-react"
import { codeToHtmlSafe } from "@/lib/highlighter"

interface CodeBlockProps {
  children: React.ReactNode
  className?: string
}

/** Pull the language-x class off the child <code> (react-markdown puts it there). */
function extractLang(children: React.ReactNode): string | null {
  if (
    children && typeof children === "object" && "props" in children &&
    typeof (children as { props?: { className?: unknown } }).props?.className === "string"
  ) {
    const m = ((children as { props: { className: string } }).props.className).match(/language-([\w-]+)/)
    return m ? m[1] : null
  }
  return null
}

/** Text content of the child <code> for highlighting (mirrors what copy reads). */
function extractText(children: React.ReactNode): string {
  if (
    children && typeof children === "object" && "props" in children
  ) {
    const inner = (children as { props?: { children?: unknown } }).props?.children
    if (typeof inner === "string") return inner
    if (Array.isArray(inner)) return inner.filter((x): x is string => typeof x === "string").join("")
  }
  return ""
}

export function CodeBlock({ children, className }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)
  const [html, setHtml] = useState<string | null>(null)
  const preRef = useRef<HTMLPreElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const lang = extractLang(children)
  const code = extractText(children)

  // Debounced progressive enhancement: highlight ~150ms after the content
  // stabilizes so streaming token updates don't thrash shiki; until then (and
  // for unsupported languages) the plain <pre> below is what renders.
  useEffect(() => {
    if (!lang || !code) { setHtml(null); return }
    let cancelled = false
    const t = setTimeout(() => {
      codeToHtmlSafe(code, lang).then(result => {
        if (!cancelled) setHtml(result)
      })
    }, 150)
    return () => { cancelled = true; clearTimeout(t) }
  }, [code, lang])

  const handleCopy = async () => {
    // Scope to THIS block — works for both the plain and highlighted renderings.
    const host = html ? wrapRef.current : preRef.current
    const text = host?.querySelector("code")?.textContent ?? host?.textContent ?? ""
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (err) {
      console.error("Failed to copy code:", err)
    }
  }

  return (
    <div className="relative group">
      <button
        onClick={handleCopy}
        className="absolute right-2 top-2 p-1.5 rounded-lg bg-muted hover:bg-accent opacity-0 group-hover:opacity-100 transition-all duration-200 z-10"
        title={copied ? "Copied!" : "Copy code"}
      >
        {copied ? (
          <Check className="h-4 w-4 text-green-400" />
        ) : (
          <Copy className="h-4 w-4 text-muted-foreground" />
        )}
      </button>
      {html ? (
        // Shiki output is locally generated from message text — trusted HTML.
        <div
          ref={wrapRef}
          className={`${className ?? ""} [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3 [&_pre]:my-2 [&_code]:whitespace-pre`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre ref={preRef} className={className}>
          {children}
        </pre>
      )}
    </div>
  )
}
```

(Keep the existing `InlineCode` export at the bottom of the file untouched.)

- [ ] **Step 4: Run to verify PASS**, `npm run typecheck` → 0.

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/CodeBlock.tsx tests/hooks/CodeBlock.test.tsx
git commit -m "feat(chat): shiki syntax highlighting in code blocks (debounced, progressive)"
```

---

### Task 3: `'code'` artifact type in the engine

**Files:**
- Create: `src/lib/artifacts/code.ts`
- Modify: `src/lib/artifacts/types.ts`, `src/lib/artifacts/render.ts`
- Test: `tests/unit/lib/artifacts-code.test.ts`

**Interfaces:**
- Produces: `CODE_LANGUAGES: CodeLanguage[]` with `CodeLanguage = { id: CodeLanguageId; label: string; ext: string; shikiLang: string }`; `CODE_LANGUAGE_IDS` (tuple for Zod enums); `codeLanguage(id: string | null | undefined): CodeLanguage | null`. `ArtifactType` includes `'code'`; `RenderedArtifact.ext: string`; `renderArtifact(type, title, content, language?: string)`.

- [ ] **Step 1: Write the failing test** — `tests/unit/lib/artifacts-code.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { CODE_LANGUAGES, CODE_LANGUAGE_IDS, codeLanguage } from '@/lib/artifacts/code'
import { renderArtifact } from '@/lib/artifacts/render'

describe('code language registry', () => {
  it('has unique ids and sane extensions', () => {
    const ids = CODE_LANGUAGES.map(l => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(codeLanguage('python')).toMatchObject({ ext: 'py', shikiLang: 'python' })
    expect(codeLanguage('bash')).toMatchObject({ ext: 'sh' })
    expect(codeLanguage('typescript')).toMatchObject({ ext: 'ts' })
    expect(codeLanguage('nope')).toBeNull()
    expect(codeLanguage(null)).toBeNull()
    expect(CODE_LANGUAGE_IDS).toEqual(ids)
  })
})

describe('renderArtifact code branch', () => {
  it('passes code through as utf-8 text with the language extension', async () => {
    const src = '#!/usr/bin/env bash\necho "hi"\n'
    const r = await renderArtifact('code', 'Deploy script', src, 'bash')
    expect(r.buffer.toString('utf-8')).toBe(src)
    expect(r.contentType).toBe('text/plain; charset=utf-8')
    expect(r.ext).toBe('sh')
  })
  it('rejects code without a known language', async () => {
    await expect(renderArtifact('code', 'X', 'x', undefined)).rejects.toThrow(/language/i)
    await expect(renderArtifact('code', 'X', 'x', 'cobol')).rejects.toThrow(/language/i)
  })
})
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement.** `src/lib/artifacts/code.ts`:

```ts
// Single source of truth for code-artifact languages. `format` on a code
// artifact row stores the language id (type='code', format='python') so
// edit/regenerate can re-derive the extension without a schema change.
export const CODE_LANGUAGES = [
  { id: 'python', label: 'Python', ext: 'py', shikiLang: 'python' },
  { id: 'bash', label: 'Bash', ext: 'sh', shikiLang: 'bash' },
  { id: 'typescript', label: 'TypeScript', ext: 'ts', shikiLang: 'typescript' },
  { id: 'javascript', label: 'JavaScript', ext: 'js', shikiLang: 'javascript' },
  { id: 'sql', label: 'SQL', ext: 'sql', shikiLang: 'sql' },
  { id: 'json', label: 'JSON', ext: 'json', shikiLang: 'json' },
  { id: 'yaml', label: 'YAML', ext: 'yaml', shikiLang: 'yaml' },
  { id: 'markdown', label: 'Markdown', ext: 'md', shikiLang: 'markdown' },
  { id: 'powershell', label: 'PowerShell', ext: 'ps1', shikiLang: 'powershell' },
] as const

export type CodeLanguage = (typeof CODE_LANGUAGES)[number]
export type CodeLanguageId = CodeLanguage['id']

export const CODE_LANGUAGE_IDS = CODE_LANGUAGES.map(l => l.id) as [CodeLanguageId, ...CodeLanguageId[]]

export function codeLanguage(id: string | null | undefined): CodeLanguage | null {
  if (!id) return null
  return CODE_LANGUAGES.find(l => l.id === id) ?? null
}
```

`types.ts`: `export type ArtifactType = 'xlsx' | 'docx' | 'pdf' | 'pptx' | 'html' | 'code'` and `RenderedArtifact.ext: string` (was `ArtifactType`).

`render.ts`: import `codeLanguage`; signature `renderArtifact(type, title, content, language?: string)`; add before the final else:

```ts
  } else if (type === 'code') {
    const lang = codeLanguage(language)
    if (!lang) throw new Error(`Unknown code artifact language: ${language}`)
    // Passthrough like HTML — the model's source string IS the file.
    return {
      buffer: Buffer.from(typeof content === 'string' ? content : '', 'utf-8'),
      contentType: 'text/plain; charset=utf-8',
      ext: lang.ext,
    }
  } else {
```

(`CONTENT_TYPE` record stays keyed by the non-code types; the code branch returns directly, so change `CONTENT_TYPE`'s type to `Record<Exclude<ArtifactType, 'code'>, string>`.)

- [ ] **Step 4: Run to verify PASS**, typecheck 0 (fixing any `ext` narrowing fallout the widened type causes — `tool.ts`/routes use it as a string already).

- [ ] **Step 5: Commit**

```bash
git add src/lib/artifacts/code.ts src/lib/artifacts/types.ts src/lib/artifacts/render.ts tests/unit/lib/artifacts-code.test.ts
git commit -m "feat(artifacts): first-class code artifact type with language registry"
```

---

### Task 4: tool + routes wiring

**Files:**
- Modify: `src/lib/artifacts/tool.ts`, `src/app/api/chat/route.ts` (TOOL_GUIDANCE), `src/app/api/artifacts/[id]/edit/route.ts`, `src/app/api/artifacts/[id]/regenerate/route.ts`
- Test: extend `tests/unit/lib/artifacts-code.test.ts` (tool schema); existing route tests must stay green

**Interfaces:**
- Consumes: `CODE_LANGUAGE_IDS`, `codeLanguage`, `renderArtifact(type, title, content, language?)` (Task 3).
- Produces: `generate_artifact` accepts `{ type: 'code', format: 'code', language, title, content }`; code artifact rows persist `format = <language id>`.

- [ ] **Step 1: Failing tool-schema test** (append to `tests/unit/lib/artifacts-code.test.ts`):

```ts
import { createGenerateArtifactTool } from '@/lib/artifacts/tool'

describe('generate_artifact code inputs', () => {
  const tool = createGenerateArtifactTool({ chatId: 1, projectId: null })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schema = (tool as any).inputSchema
  it('accepts code with a known language', () => {
    expect(schema.safeParse({ type: 'code', title: 'Script', format: 'code', language: 'python', content: 'print(1)' }).success).toBe(true)
  })
  it('rejects code without a language', () => {
    expect(schema.safeParse({ type: 'code', title: 'Script', format: 'code', content: 'print(1)' }).success).toBe(false)
  })
  it('still accepts existing types without language', () => {
    expect(schema.safeParse({ type: 'html', title: 'Page', format: 'html', content: '<!doctype html>' }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement `tool.ts`.**
- `inputSchema` becomes a refined object:

```ts
    inputSchema: z.object({
      type: z.enum(['xlsx', 'docx', 'pdf', 'pptx', 'html', 'code']),
      title: z.string().min(1).max(200),
      format: z.enum(['markdown', 'sheets', 'html', 'code']),
      language: z.enum(CODE_LANGUAGE_IDS).optional()
        .describe('Required for type "code": the source language (drives file extension + preview highlighting)'),
      content: z.union([z.string(), z.array(sheetSpec)]),
    }).refine(v => v.type !== 'code' || v.language != null, {
      message: 'language is required for code artifacts',
      path: ['language'],
    }),
```

- `execute`: pass `language` through — `renderArtifact(type as ArtifactType, title, content, language)`; persist `format: type === 'code' ? language! : format` in the `createArtifact` call.
- Description: append one sentence — `'For a code FILE (type "code", format "code"): pass language + content = the complete source. Generate a code artifact ONLY when the user asks for a runnable/downloadable script or file ("write me a script I can run", "save as .py", "make a bash file"); code snippets, examples, and explanations stay in the chat reply as fenced code blocks.'`

- [ ] **Step 4: TOOL_GUIDANCE** (chat route, match semicolon style): append to the existing tool-guidance string: `' Use generate_artifact with type "code" when the user asks for a runnable script or code FILE to keep/download (.py/.sh/.ts etc.) — short snippets and examples stay in chat as fenced code blocks.'`

- [ ] **Step 5: Edit route** (`edit/route.ts`): after `const type = artifact.type as ArtifactType`, derive `const language = type === 'code' ? artifact.format ?? undefined : undefined` and call `renderArtifact(type, title, content, language)`. The `needsArray` guard already forces string content for code. `format` fallback line: `const format = artifact.format ?? (type === 'html' ? 'html' : typeof content === 'string' ? 'markdown' : 'sheets')` — leave as-is (code rows always have format set at creation).

- [ ] **Step 6: Regenerate route**: add a code prompt branch — after `const isHtml`:

```ts
    const isCode = type === 'code'
```

prompt ternary gains (before the markdown fallback):

```ts
      : isCode
      ? `You are revising a ${artifact.format ?? 'code'} source file titled "${title}". Current content:\n\n${artifact.content ?? ''}\n\nApply this instruction: ${body.data.instruction}\n\nReturn ONLY the full updated source file — no prose, no code fences.`
```

and the render call becomes `renderArtifact(type, title, content as string | SheetSpec[], isCode ? artifact.format ?? undefined : undefined)`.

- [ ] **Step 7: Run** the artifacts-code test file + any existing artifact route tests + typecheck. All green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(artifacts): wire code type through tool, guidance, edit + regenerate routes"
```

---

### Task 5: code preview + card UI

**Files:**
- Modify: `src/components/chat/ArtifactPreview.tsx`, `src/components/chat/ArtifactCard.tsx`, `src/types.ts` (ARTIFACT_TYPE_LABELS)
- Test: `tests/hooks/ArtifactPreview-code.test.tsx` (new)

**Interfaces:**
- Consumes: `codeToHtmlSafe` (Task 1), `codeLanguage` (Task 3), `artifact.format` = language id for code.

- [ ] **Step 1: Failing test** — `tests/hooks/ArtifactPreview-code.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const codeToHtmlSafeMock = vi.fn()
vi.mock('@/lib/highlighter', () => ({ codeToHtmlSafe: (...a: unknown[]) => codeToHtmlSafeMock(...a) }))

import { ArtifactPreview } from '@/components/chat/ArtifactPreview'
import { ARTIFACT_TYPE_LABELS } from '@/types'

afterEach(() => { cleanup(); codeToHtmlSafeMock.mockReset() })

const codeArtifact = {
  id: 1, chatId: 1, type: 'code', title: 'deploy script', status: 'ready',
  downloadUrl: null, createdAt: null, format: 'bash', content: 'echo "hi"', version: 1,
}

describe('ArtifactPreview code branch', () => {
  it('renders highlighted code when shiki resolves', async () => {
    codeToHtmlSafeMock.mockResolvedValue('<pre class="shiki"><code>echo</code></pre>')
    render(<ArtifactPreview artifact={codeArtifact} />)
    await waitFor(() => expect(document.querySelector('.shiki')).toBeTruthy())
    expect(codeToHtmlSafeMock).toHaveBeenCalledWith('echo "hi"', 'bash')
  })
  it('falls back to a plain pre when highlighting is unavailable', async () => {
    codeToHtmlSafeMock.mockResolvedValue(null)
    render(<ArtifactPreview artifact={codeArtifact} />)
    await waitFor(() => expect(codeToHtmlSafeMock).toHaveBeenCalled())
    expect(screen.getByText('echo "hi"')).toBeTruthy()
  })
  it('labels code artifacts', () => {
    expect(ARTIFACT_TYPE_LABELS.code).toBe('Code')
  })
})
```

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement.**
- `src/types.ts`: `ARTIFACT_TYPE_LABELS` gains `code: 'Code'`.
- `ArtifactPreview.tsx`: add a small `CodePreview` component in-file and a branch above the sheets/markdown fallback:

```tsx
function CodePreview({ content, language }: { content: string; language: string | null }) {
  const [html, setHtml] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    codeToHtmlSafe(content, language).then(r => { if (!cancelled) setHtml(r) })
    return () => { cancelled = true }
  }, [content, language])
  if (html) {
    return <div className="text-sm [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:p-3" dangerouslySetInnerHTML={{ __html: html }} />
  }
  return <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-sm font-mono whitespace-pre">{content}</pre>
}
```

with imports `{ useEffect, useState } from 'react'`, `{ codeToHtmlSafe } from '@/lib/highlighter'`, and the shiki lang derived via `codeLanguage(artifact.format)?.shikiLang ?? artifact.format` (import `codeLanguage` from `@/lib/artifacts/code`). Branch placement (before the `format === 'sheets'` check):

```tsx
      {artifact.type === 'code' ? (
        <CodePreview content={content} language={codeLanguage(artifact.format)?.shikiLang ?? artifact.format} />
      ) : artifact.format === 'sheets' ? (
```

Also change the "Preview (approximate)" caption to render only for non-code types (a code preview IS exact): wrap the `<p>` in `{artifact.type !== 'code' && (...)}`.
- `ArtifactCard.tsx`: `ICON` map gains `code: FileCode` (import `FileCode` from lucide; note `Code` is already used for html — keep that).

- [ ] **Step 4: Run to verify PASS**, typecheck 0.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(artifacts): highlighted code preview + card icon/label"
```

---

### Task 6: Contract Abstract persona

**Files:**
- Modify: `src/hooks/usePersonas.ts`
- Test: `tests/hooks/usePersonas-contract-abstract.test.ts` (new)

- [ ] **Step 1: Failing test**:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { CONTRACT_ABSTRACT_FIELDS, PERSONAS_FOR_TEST } from '@/hooks/usePersonas'

describe('Contract Abstract persona', () => {
  const persona = PERSONAS_FOR_TEST.find(p => p.id === 'contract-abstract')
  it('exists with the right tier', () => {
    expect(persona).toBeDefined()
    expect(persona!.model).toBe('claude-fable-5')
    expect(persona!.effort).toBe('max')
  })
  it('locks every schema field into the prompt', () => {
    expect(CONTRACT_ABSTRACT_FIELDS.length).toBeGreaterThanOrEqual(20)
    for (const f of CONTRACT_ABSTRACT_FIELDS) expect(persona!.prompt).toContain(f)
  })
  it('mandates the xlsx artifact contract', () => {
    expect(persona!.prompt).toContain('generate_artifact')
    expect(persona!.prompt).toContain('Field | Value | Source Ref')
    expect(persona!.prompt).toContain('Not found in provided documents')
  })
})
```

- [ ] **Step 2: Run to verify FAIL** (exports missing).

- [ ] **Step 3: Implement in `usePersonas.ts`.**
- Export the editable schema constant (place above the prompts):

```ts
/** Locked Contract Abstract field schema — EDIT HERE ONLY. Order is the output order. */
export const CONTRACT_ABSTRACT_FIELDS = [
  'Project Name', 'Contract Title/Number', 'Owner', 'Contractor', 'Architect/Engineer',
  'Contract Type (LS/GMP/T&M/Unit Price)', 'Contract Sum', 'Retainage %',
  'Notice to Proceed', 'Substantial Completion', 'Final Completion',
  'Liquidated Damages', 'Payment Terms', 'Schedule of Values Requirements',
  'Insurance Requirements', 'Bond Requirements', 'Warranty Period',
  'Notice Requirements (claims/delays)', 'Change Order Markup %',
  'Dispute Resolution', 'Termination Provisions', 'Key Exclusions',
] as const
```

- The prompt (template-literal so the field list interpolates — single source):

```ts
const CONTRACT_ABSTRACT_PROMPT = `<identity>
You are a construction contract abstractor. You produce a standardized Contract Abstract — a one-page reference of a contract's commercial terms — extracted verbatim from the contract documents provided in this project.
</identity>

<schema>
The abstract has EXACTLY these fields, in this order — never add, remove, rename, or reorder them:
${CONTRACT_ABSTRACT_FIELDS.map(f => `- ${f}`).join('\n')}
</schema>

<constraints>
- Extraction only: fill each field ONLY from the provided contract documents (retrieved context and read_document). Never infer, estimate, or fill from general knowledge.
- A field with no support in the documents gets the exact value: Not found in provided documents
- Every filled field cites its source (article/section/paragraph/exhibit) in the Source Ref column.
- Quote money, dates, percentages, and durations exactly as written.
</constraints>

<output>
When asked to abstract a contract:
1. A short chat summary of the 3-5 highest-risk terms you found (LDs, notice deadlines, pay-when-paid, onerous exclusions).
2. Then call generate_artifact with type "xlsx", format "sheets": ONE sheet named "Contract Abstract", header row "Field | Value | Source Ref" (as three columns), then one row per schema field in exact schema order.
For any other question, answer in chat with citations — no file.
</output>`
```

- Persona entry (after `contract-spec-analyst` in the PERSONAS array): `{ id: 'contract-abstract', name: 'Contract Abstract', icon: '🗂️', prompt: CONTRACT_ABSTRACT_PROMPT, model: 'claude-fable-5', effort: 'max', description: 'Locked-schema contract abstract to xlsx' }`.
- Export for tests: `export const PERSONAS_FOR_TEST = PERSONAS` (below the array; the hook file is client-side but constants import fine in jsdom).

- [ ] **Step 4: Run to verify PASS**, typecheck 0.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePersonas.ts tests/hooks/usePersonas-contract-abstract.test.ts
git commit -m "feat(personas): contract abstract persona with locked field schema"
```

---

### Task 7: docs + full gate + review

- [ ] **Step 1: CHANGELOG** — new `## [4.50.0] - 2026-07-12 — Code Phase A/B` entry in the established style: shiki chat highlighting (debounced, dual vitesse themes, plain-pre fallback); `'code'` artifact type (language registry, `format` column = language id, passthrough render, highlighted preview, FileCode icon, edit/regenerate support, chat-first guidance); Contract Abstract persona (locked schema, extraction-only, xlsx contract). Note the field schema constant location for user review.
- [ ] **Step 2: CLAUDE.md** — source-layout entries for `src/lib/highlighter.ts` + `src/lib/artifacts/code.ts`; the artifacts section notes `ArtifactType` gained `'code'` (format column = language id); persona list mention.
- [ ] **Step 3: package.json version** → `4.50.0` (chore commit with docs).
- [ ] **Step 4: Full gate**: `npm run typecheck` → 0; `npm run lint` → 0 errors; `npm run build`; `$env:TZ='America/Phoenix'; npx vitest run --no-file-parallelism` → all green.
- [ ] **Step 5: Final quality pass** — run the repo's code-review skill at medium effort over the phase's diff; fix Critical/Important findings; re-run covering tests.
- [ ] **Step 6: Commit docs** (`docs: code phase a/b - changelog 4.50.0, CLAUDE.md`) and STOP — push, live smoke (bash-script ask → .sh artifact; colored chat blocks; Contract Abstract on a real contract), and spec/field-schema review are user-gated.
