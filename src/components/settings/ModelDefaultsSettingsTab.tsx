'use client'

import { memo, useState, useEffect } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { getSetting, setSettings } from '@/app/actions'
import { usePersonas, type Persona } from '@/hooks/usePersonas'
import { cn } from '@/lib/utils'
import type { Model } from '@/types'

interface ModelDefaultsSettingsTabProps {
  models: Model[]
  onSettingsChanged?: () => void
}

export const ModelDefaultsSettingsTab = memo(function ModelDefaultsSettingsTab({
  models,
  onSettingsChanged,
}: ModelDefaultsSettingsTabProps) {
  const [defaultModel, setDefaultModel] = useState('')
  const [defaultSystemPrompt, setDefaultSystemPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const {
    personas,
    customPersonas,
    addPersona,
    deletePersona,
  } = usePersonas()

  // New persona form
  const [showNewPersona, setShowNewPersona] = useState(false)
  const [newName, setNewName] = useState('')
  const [newIcon, setNewIcon] = useState('')
  const [newPrompt, setNewPrompt] = useState('')

  useEffect(() => {
    async function load() {
      const [model, prompt] = await Promise.all([
        getSetting('default-model'),
        getSetting('default-system-prompt'),
      ])
      if (model) {
        // Only restore if the model still exists in the available list
        const isValid = models.some(m => m.model === model)
        if (isValid) setDefaultModel(model)
      }
      if (prompt) setDefaultSystemPrompt(prompt)
      setLoaded(true)
    }
    load()
  }, [models])

  const handleSave = async () => {
    setSaving(true)
    try {
      const entries: { key: string; value: string }[] = []
      if (defaultModel) entries.push({ key: 'default-model', value: defaultModel })
      entries.push({ key: 'default-system-prompt', value: defaultSystemPrompt })
      await setSettings(entries)
      onSettingsChanged?.()
    } finally {
      setSaving(false)
    }
  }

  const handleAddPersona = () => {
    if (!newName.trim() || !newPrompt.trim()) return
    addPersona({
      name: newName.trim(),
      icon: newIcon || '🤖',
      prompt: newPrompt.trim(),
    })
    setNewName('')
    setNewIcon('')
    setNewPrompt('')
    setShowNewPersona(false)
  }

  if (!loaded) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const geminiModels = models.filter(m => m.model.startsWith('gemini'))

  return (
    <div className="space-y-6">
      {/* Default Model */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Default Model</label>
        <p className="text-xs text-muted-foreground">
          Automatically selected when you start a new chat.
        </p>
        <select
          value={defaultModel}
          onChange={(e) => setDefaultModel(e.target.value)}
          className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all appearance-none"
        >
          <option value="">Use first available</option>
          {geminiModels.length > 0 && (
            <optgroup label="Google Gemini">
              {geminiModels.map(m => (
                <option key={m.model} value={m.model}>{m.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Default System Prompt */}
      <div className="space-y-2">
        <label className="text-sm font-medium">Default System Prompt</label>
        <p className="text-xs text-muted-foreground">
          Applied to new chats unless overridden by a persona or custom prompt.
        </p>
        <textarea
          value={defaultSystemPrompt}
          onChange={(e) => setDefaultSystemPrompt(e.target.value)}
          rows={4}
          placeholder="e.g., You are a helpful assistant..."
          className="w-full px-3 py-2 bg-black/20 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 transition-all resize-none"
        />
      </div>

      {/* Save defaults */}
      <div>
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-4 py-2 text-sm rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Save Defaults
        </button>
      </div>

      {/* Divider */}
      <div className="h-px bg-white/10" />

      {/* Personas */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">Personas</label>
            <p className="text-xs text-muted-foreground">
              Quick-switch system prompt presets.
            </p>
          </div>
          <button
            onClick={() => setShowNewPersona(!showNewPersona)}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
          >
            <Plus className="h-3 w-3" />
            Add
          </button>
        </div>

        {/* New persona form */}
        {showNewPersona && (
          <div className="p-3 border border-white/10 rounded-lg space-y-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={newIcon}
                onChange={(e) => setNewIcon(e.target.value)}
                placeholder="Icon"
                maxLength={2}
                className="w-12 px-2 py-1.5 bg-black/20 border border-white/10 rounded-lg text-sm text-center focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="Persona name"
                className="flex-1 px-2 py-1.5 bg-black/20 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <textarea
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              placeholder="System prompt for this persona..."
              rows={3}
              className="w-full px-2 py-1.5 bg-black/20 border border-white/10 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowNewPersona(false)}
                className="px-3 py-1.5 text-xs rounded-lg hover:bg-white/10 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleAddPersona}
                disabled={!newName.trim() || !newPrompt.trim()}
                className="px-3 py-1.5 text-xs rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors disabled:opacity-50"
              >
                Add Persona
              </button>
            </div>
          </div>
        )}

        {/* Persona list */}
        <div className="space-y-1.5">
          {personas.map((persona) => (
            <div
              key={persona.id}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg text-sm",
                persona.isDefault ? "opacity-70" : "border border-white/10"
              )}
            >
              <span className="text-base w-6 text-center shrink-0">{persona.icon}</span>
              <span className="flex-1 truncate">{persona.name}</span>
              {persona.isDefault ? (
                <span className="text-[10px] px-1.5 py-0.5 bg-white/10 rounded text-muted-foreground shrink-0">
                  built-in
                </span>
              ) : (
                <button
                  onClick={() => deletePersona(persona.id)}
                  className="p-1 rounded hover:bg-red-500/20 text-muted-foreground hover:text-red-400 transition-colors shrink-0"
                  title="Delete persona"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
