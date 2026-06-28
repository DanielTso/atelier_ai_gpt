'use client'

import { memo, useState, useEffect } from 'react'
import { Loader2, Check } from 'lucide-react'
import { getApiKeyStatus, setSettings } from '@/app/actions'

interface ApiKeysSettingsTabProps {
  onSettingsChanged?: () => void
}

export const ApiKeysSettingsTab = memo(function ApiKeysSettingsTab({
  onSettingsChanged,
}: ApiKeysSettingsTabProps) {
  const [status, setStatus] = useState<{ gemini: boolean; anthropic: boolean; tavily: boolean } | null>(null)
  const [anthropicInput, setAnthropicInput] = useState('')
  const [geminiInput, setGeminiInput] = useState('')
  const [tavilyInput, setTavilyInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    getApiKeyStatus().then(setStatus)
  }, [])

  const handleSave = async () => {
    const entries: { key: string; value: string }[] = []
    if (anthropicInput.trim()) entries.push({ key: 'anthropic-api-key', value: anthropicInput.trim() })
    if (geminiInput.trim()) entries.push({ key: 'gemini-api-key', value: geminiInput.trim() })
    if (tavilyInput.trim()) entries.push({ key: 'tavily-api-key', value: tavilyInput.trim() })
    if (entries.length === 0) return
    setSaving(true)
    try {
      await setSettings(entries)
      setAnthropicInput('')
      setGeminiInput('')
      setTavilyInput('')
      setStatus(await getApiKeyStatus())
      onSettingsChanged?.()
    } finally {
      setSaving(false)
    }
  }

  if (!status) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Anthropic API Key</label>
          {status.anthropic && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="h-3 w-3" /> Configured
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Powers Claude chat models. Stored securely; never read back into this field.</p>
        <input
          type="password"
          value={anthropicInput}
          onChange={(e) => setAnthropicInput(e.target.value)}
          placeholder={status.anthropic ? 'Enter a new key to replace' : 'sk-ant-...'}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Google Gemini API Key</label>
          {status.gemini && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="h-3 w-3" /> Configured
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Powers image generation (Nano Banana 2) and embeddings.</p>
        <input
          type="password"
          value={geminiInput}
          onChange={(e) => setGeminiInput(e.target.value)}
          placeholder={status.gemini ? 'Enter a new key to replace' : 'AIza...'}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Tavily API Key</label>
          {status.tavily && (
            <span className="flex items-center gap-1 text-xs text-success">
              <Check className="h-3 w-3" /> Configured
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Web ingestion — pull a URL or site into a project&apos;s documents. Stored securely; never read back into this field.</p>
        <input
          type="password"
          value={tavilyInput}
          onChange={(e) => setTavilyInput(e.target.value)}
          placeholder={status.tavily ? 'Enter a new key to replace' : 'tvly-...'}
          className="w-full px-3 py-2 bg-background border border-border rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <button
        onClick={handleSave}
        disabled={saving || (!anthropicInput.trim() && !geminiInput.trim() && !tavilyInput.trim())}
        className="px-4 py-2 text-sm rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        Save Keys
      </button>
    </div>
  )
})
