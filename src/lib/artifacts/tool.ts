import { tool } from 'ai'
import { z } from 'zod'
import { renderArtifact } from './render'
import { artifactStoragePath } from './path'
import { uploadBuffer, createSignedDownloadUrl, removeObjects } from '@/lib/storage'
import { createArtifact } from '@/app/actions'
import type { ArtifactType } from './types'

const sheetSpec = z.object({ name: z.string(), rows: z.array(z.array(z.union([z.string(), z.number()]))) })

export function createGenerateArtifactTool(ctx: { chatId: number; projectId: number | null }) {
  return tool({
    description:
      'Generate a DOWNLOADABLE file (Excel .xlsx, Word .docx, PDF, or PowerPoint .pptx). ' +
      'ONLY call this when the user EXPLICITLY asks for a downloadable/exported file — e.g. "make a spreadsheet", "export this to Word", "create a PDF", "give me a .xlsx", "put it in a slide deck", "I want a document I can download". ' +
      'Do NOT call this for ordinary requests. If the user asks you to write, draft, compose, or give them an email, message, summary, report, plan, list, table, or any content to READ IN THE CONVERSATION, just write it directly in your chat reply using Markdown — do NOT generate a file. When unsure, answer in chat; only produce a file on an explicit file/download/export request. ' +
      'For xlsx, pass format "sheets" with content as an array of {name, rows}; make the FIRST row a header row of column titles and keep columns consistent. ' +
      'For docx/pdf/pptx, pass format "markdown" with rich Markdown: "##"/"###" headings, "**bold**"/"*italic*", "-"/"1." lists, and GitHub-flavored "| col | col |" tables. For pptx, each top-level "# Heading" starts a new slide.',
    inputSchema: z.object({
      type: z.enum(['xlsx', 'docx', 'pdf', 'pptx']),
      title: z.string().min(1).max(200),
      format: z.enum(['markdown', 'sheets']),
      content: z.union([z.string(), z.array(sheetSpec)]),
    }),
    execute: async ({ type, title, format, content }) => {
      try {
        const { buffer, contentType, ext } = await renderArtifact(type as ArtifactType, title, content)
        // Persist the source so the artifact can be previewed/edited/regenerated.
        const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
        // Upload FIRST to a uuid-keyed path, then persist the row with the real
        // path — so a failure never leaves an orphan row with a broken storage path.
        const path = artifactStoragePath(ctx.projectId, title, ext)
        await uploadBuffer(path, buffer, contentType)
        let row: Awaited<ReturnType<typeof createArtifact>>[number] | undefined
        try {
          ;[row] = await createArtifact({ chatId: ctx.chatId, projectId: ctx.projectId, type, title, storagePath: path, format, content: contentStr })
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
