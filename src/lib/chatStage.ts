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
  | 'reading-documents'
  | 'writing'

type StagePart = {
  type?: string
  toolName?: string
  state?: string
  text?: string
  data?: { stage?: string }
}

type StageMessage = { role?: string; parts?: readonly unknown[] }

/** Tool name for both static (`tool-<name>`) and dynamic tool parts, '' otherwise.
    Single parser shared by the stage machine and the inline tool cards. */
export function toolPartName(p: unknown): string {
  const part = p as StagePart
  const type = part.type ?? ''
  if (type === 'dynamic-tool') return part.toolName ?? ''
  if (type.startsWith('tool-')) return type.slice('tool-'.length)
  return ''
}

/** Tools that render their own inline progress/result card in the message bubble. */
export function isRenderableTool(name: string): name is 'generate_image' | 'generate_artifact' {
  return name === 'generate_image' || name === 'generate_artifact'
}

/** True once the assistant's bubble shows something of its own (text, reasoning,
    an image file part, or an inline tool card) — the status line yields to it. */
export function assistantHasVisibleContent(message: StageMessage | undefined): boolean {
  if (!message || message.role !== 'assistant') return false
  return ((message.parts ?? []) as StagePart[]).some(p => {
    if (p.type === 'text' || p.type === 'reasoning') return Boolean((p.text ?? '').trim())
    if (p.type === 'file') return true
    return isRenderableTool(toolPartName(p))
  })
}

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
    // Unknown tools fall through to a generic 'thinking' rather than throwing
    // the machine off.
    const toolName = toolPartName(p)
    if (toolName) {
      if (p.state === 'output-available' || p.state === 'output-error') continue
      if (toolName === 'generate_image') return 'generating-image'
      if (toolName === 'generate_artifact') return 'building-artifact'
      if (toolName === 'web_search') return 'searching'
      if (toolName === 'read_document') return 'reading-documents'
      return 'thinking'
    }
    if (type === 'data-stage' && (p.data?.stage === 'reading-documents') && !hasAnswerText) return 'reading-documents'
    if (type === 'text' && (p.text ?? '').trim()) return 'writing'
    if (type === 'reasoning' && !hasAnswerText) return 'thinking'
  }
  return hasAnswerText ? 'writing' : 'thinking'
}
