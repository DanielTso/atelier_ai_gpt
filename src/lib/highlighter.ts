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

// Static import map so the bundler can see every grammar chunk it may need
// (a fully dynamic `import(\`@shikijs/langs/${lang}\`)` is invisible to
// Turbopack's analysis and breaks in production builds).
const GRAMMAR_LOADERS: Record<string, () => Promise<{ default: unknown }>> = {
  python: () => import('@shikijs/langs/python'),
  bash: () => import('@shikijs/langs/bash'),
  typescript: () => import('@shikijs/langs/typescript'),
  tsx: () => import('@shikijs/langs/tsx'),
  javascript: () => import('@shikijs/langs/javascript'),
  jsx: () => import('@shikijs/langs/jsx'),
  json: () => import('@shikijs/langs/json'),
  yaml: () => import('@shikijs/langs/yaml'),
  sql: () => import('@shikijs/langs/sql'),
  markdown: () => import('@shikijs/langs/markdown'),
  html: () => import('@shikijs/langs/html'),
  css: () => import('@shikijs/langs/css'),
  diff: () => import('@shikijs/langs/diff'),
  powershell: () => import('@shikijs/langs/powershell'),
}

async function ensureLang(h: HighlighterCore, lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true
  const loader = GRAMMAR_LOADERS[lang]
  if (!loader) return false
  try {
    const mod = await loader()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await h.loadLanguage(mod.default as any)
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
