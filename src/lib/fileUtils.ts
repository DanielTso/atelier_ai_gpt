export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function getFileTypeBadge(mimeType: string, filename: string): { label: string; className: string } {
  // Light-first pairs (readable on the warm-paper surface) with the prior dark-mode
  // tint kept via dark: variants — the old classes were dark-only and washed out on light.
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'pdf' || mimeType === 'application/pdf') return { label: 'PDF', className: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300' }
  if (ext === 'docx') return { label: 'DOCX', className: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300' }
  if (['js', 'ts', 'tsx', 'jsx', 'py', 'java', 'go', 'rs', 'rb', 'c', 'cpp', 'php', 'sh', 'sql'].includes(ext))
    return { label: ext.toUpperCase(), className: 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300' }
  if (['md', 'txt', 'csv'].includes(ext)) return { label: ext.toUpperCase(), className: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300' }
  return { label: ext.toUpperCase() || 'FILE', className: 'bg-stone-100 text-stone-700 dark:bg-stone-500/15 dark:text-stone-300' }
}
