import { tool } from 'ai'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { renderArtifact } from './render'
import { uploadBuffer, createSignedDownloadUrl, removeObjects } from '@/lib/storage'
import { createArtifact } from '@/app/actions'
import type { ArtifactType } from './types'

const sheetSpec = z.object({ name: z.string(), rows: z.array(z.array(z.union([z.string(), z.number()]))) })

function slug(s: string): string {
  return (s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'artifact').slice(0, 60)
}

export function createGenerateArtifactTool(ctx: { chatId: number; projectId: number | null }) {
  return tool({
    description: 'Generate a downloadable file artifact (Excel .xlsx, Word .docx, or PDF) for the user. ' +
      'Use for reports, schedules, takeoffs, and write-ups the user can download. For xlsx, pass format "sheets" ' +
      'with content as an array of {name, rows}. For docx/pdf, pass format "markdown" with content as a Markdown string.',
    inputSchema: z.object({
      type: z.enum(['xlsx', 'docx', 'pdf']),
      title: z.string().min(1).max(200),
      format: z.enum(['markdown', 'sheets']),
      content: z.union([z.string(), z.array(sheetSpec)]),
    }),
    execute: async ({ type, title, content }) => {
      try {
        const { buffer, contentType, ext } = await renderArtifact(type as ArtifactType, title, content)
        // Upload FIRST to a uuid-keyed path, then persist the row with the real
        // path — so a failure never leaves an orphan row with a broken storage path.
        const path = `artifacts/${ctx.projectId ?? 'standalone'}/${randomUUID()}/${slug(title)}.${ext}`
        await uploadBuffer(path, buffer, contentType)
        let row: Awaited<ReturnType<typeof createArtifact>>[number] | undefined
        try {
          ;[row] = await createArtifact({ chatId: ctx.chatId, projectId: ctx.projectId, type, title, storagePath: path })
          // An empty insert result would otherwise throw on row.id AFTER upload,
          // leaving an orphan object — treat it as a failure and clean up.
          if (!row) throw new Error('artifact insert returned no row')
        } catch (e) {
          await removeObjects([path]).catch(() => {}) // don't leave an orphan object if the insert fails
          throw e
        }
        const downloadUrl = await createSignedDownloadUrl(path)
        return { artifactId: row.id, title, type, downloadUrl }
      } catch (e) {
        console.warn('[generate_artifact] failed:', e instanceof Error ? e.message : e)
        return { error: 'Failed to generate the artifact.' }
      }
    },
  })
}
