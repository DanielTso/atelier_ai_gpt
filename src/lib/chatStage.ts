// Derives the response-loading stage shown while the assistant works, from the
// useChat status + the streaming message's actual parts. Event-driven only —
// stages advance when real parts arrive (reasoning, tool calls, text), never on
// timers. Pure so it unit-tests without React.

export type AssistantStage =
  | 'idle'
  | 'submitted'
  | 'thinking'
  | 'searching'
  | 'generating-image'
  | 'building-artifact'
  | 'writing'

type StagePart = {
  type?: string
  toolName?: string
  state?: string
  text?: string
}

type StageMessage = { role?: string; parts?: readonly unknown[] }

export function deriveAssistantStage(status: string, lastMessage: StageMessage | undefined): AssistantStage {
  if (status !== 'submitted' && status !== 'streaming') return 'idle'
  if (!lastMessage || lastMessage.role !== 'assistant') return 'submitted'

  const parts = (lastMessage.parts ?? []) as StagePart[]
  if (parts.length === 0) return 'submitted'
  const hasAnswerText = parts.some(p => p.type === 'text' && (p.text ?? '').trim().length > 0)

  // Scan from the end — the most recent active part wins.
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    const type = p.type ?? ''
    // Both static (`tool-<name>`) and dynamic tool parts; unknown tools fall
    // through to a generic 'thinking' rather than throwing the machine off.
    const toolName =
      type === 'dynamic-tool' ? (p.toolName ?? '')
      : type.startsWith('tool-') ? type.slice('tool-'.length)
      : ''
    if (toolName) {
      if (p.state === 'output-available' || p.state === 'output-error') continue
      if (toolName === 'generate_image') return 'generating-image'
      if (toolName === 'generate_artifact') return 'building-artifact'
      if (toolName === 'web_search') return 'searching'
      return 'thinking'
    }
    if (type === 'text' && (p.text ?? '').trim()) return 'writing'
    if (type === 'reasoning' && !hasAnswerText) return 'thinking'
  }
  return hasAnswerText ? 'writing' : 'thinking'
}
