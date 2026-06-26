export type GeneratedImageOutput = { storagePath: string; url: string; mediaType: string; filename?: string; fileSize?: number }

// The generate_image tool surfaces its result as a tool-result part (not a `file` part).
// Pull the successful outputs so the persistence pipeline can save them and render inline.
export function extractGeneratedImageOutputs(parts: readonly unknown[]): GeneratedImageOutput[] {
  const out: GeneratedImageOutput[] = []
  for (const p of parts) {
    const part = p as { type?: string; toolName?: string; output?: unknown }
    const isImageTool =
      part.type === 'tool-generate_image' ||
      (part.type === 'dynamic-tool' && part.toolName === 'generate_image')
    if (!isImageTool) continue
    const o = part.output as Record<string, unknown> | undefined
    if (o && typeof o.storagePath === 'string' && typeof o.url === 'string' && typeof o.mediaType === 'string') {
      out.push({
        storagePath: o.storagePath,
        url: o.url,
        mediaType: o.mediaType,
        filename: typeof o.filename === 'string' ? o.filename : undefined,
        fileSize: typeof o.fileSize === 'number' ? o.fileSize : undefined,
      })
    }
  }
  return out
}
