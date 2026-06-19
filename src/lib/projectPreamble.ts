/** Build a system-prompt preamble from a project's Memory + Instructions. Empty when both blank. */
export function buildProjectPreamble(memory: string | null, instructions: string | null): string {
  const parts: string[] = []
  if (memory && memory.trim()) parts.push(`Project memory:\n${memory.trim()}`)
  if (instructions && instructions.trim()) parts.push(`Project instructions:\n${instructions.trim()}`)
  return parts.join('\n\n')
}
