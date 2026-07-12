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
