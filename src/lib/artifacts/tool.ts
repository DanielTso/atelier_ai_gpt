import { tool } from 'ai'
import { z } from 'zod'
import { renderArtifact } from './render'
import { artifactStoragePath } from './path'
import { CODE_LANGUAGE_IDS } from './code'
import { uploadBuffer, createSignedDownloadUrl, removeObjects, ARTIFACT_URL_TTL_SECONDS } from '@/lib/storage'
import { createArtifact } from '@/app/actions'
import type { ArtifactType } from './types'

const sheetSpec = z.object({ name: z.string(), rows: z.array(z.array(z.union([z.string(), z.number()]))) })

export function createGenerateArtifactTool(ctx: { chatId: number; projectId: number | null }) {
  return tool({
    description:
      'Generate a file artifact: a DOWNLOADABLE document (Excel .xlsx, Word .docx, PDF, PowerPoint .pptx) or an HTML page/app shown with a LIVE PREVIEW in the side panel (type "html"). ' +
      'Call this when the user EXPLICITLY asks for a downloadable/exported file ("make a spreadsheet", "export to Word", "create a PDF", "give me a .xlsx") OR for a web page / landing page / interactive HTML mockup to view ("build me a landing page", "make an HTML page", "create a webpage"). ' +
      'Do NOT call this for ordinary requests. If the user asks you to write, draft, compose, or give them an email, message, summary, report, plan, list, or table to READ IN THE CONVERSATION, just write it directly in your chat reply using Markdown — do NOT generate a file. When unsure, answer in chat. ' +
      'For xlsx, pass format "sheets" with content as an array of {name, rows}; make the FIRST row a header row of column titles and keep columns consistent. ' +
      'For docx/pdf/pptx, pass format "markdown" with rich Markdown: "##"/"###" headings, "**bold**"/"*italic*", "-"/"1." lists, and GitHub-flavored "| col | col |" tables. For pptx, each top-level "# Heading" starts a new slide. ' +
      'For html, pass format "html" with content = a COMPLETE standalone HTML document (a single file with inline <style> and inline <script>; no external build step, frameworks, or local file references). ' +
      'For a code FILE (type "code", format "code"): pass language + content = the complete source. Generate a code artifact ONLY when the user asks for a runnable/downloadable script or file ("write me a script I can run", "save as .py", "make a bash file"); code snippets, examples, and explanations stay in the chat reply as fenced code blocks.',
    inputSchema: z.object({
      type: z.enum(['xlsx', 'docx', 'pdf', 'pptx', 'html', 'code']),
      title: z.string().min(1).max(200),
      format: z.enum(['markdown', 'sheets', 'html', 'code']),
      language: z.enum(CODE_LANGUAGE_IDS).optional()
        .describe('Required for type "code": the source language (drives file extension + preview highlighting)'),
      content: z.union([z.string(), z.array(sheetSpec)]),
    }).refine(v => v.type !== 'code' || v.language != null, {
      message: 'language is required for code artifacts',
      path: ['language'],
    }),
    execute: async ({ type, title, format, content, language }) => {
      try {
        const { buffer, contentType, ext } = await renderArtifact(type as ArtifactType, title, content, language)
        // Persist the source so the artifact can be previewed/edited/regenerated.
        const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
        // Upload FIRST to a uuid-keyed path, then persist the row with the real
        // path — so a failure never leaves an orphan row with a broken storage path.
        const path = artifactStoragePath(ctx.projectId, title, ext)
        await uploadBuffer(path, buffer, contentType)
        let row: Awaited<ReturnType<typeof createArtifact>>[number] | undefined
        try {
          // Code artifacts persist their LANGUAGE in the format column (type='code',
          // format='python') so edit/regenerate can re-derive the file extension.
          ;[row] = await createArtifact({ chatId: ctx.chatId, projectId: ctx.projectId, type, title, storagePath: path, format: type === 'code' ? language! : format, content: contentStr })
          // An empty insert result would otherwise throw on row.id AFTER upload,
          // leaving an orphan object — treat it as a failure and clean up.
          if (!row) throw new Error('artifact insert returned no row')
        } catch (e) {
          await removeObjects([path]).catch(() => {}) // don't leave an orphan object if the insert fails
          throw e
        }
        // HTML goes through the same-origin raw route (Supabase serves text/html
        // signed-URL downloads named .txt); other types keep the signed URL.
        const downloadUrl = type === 'html'
          ? `/api/artifacts/${row.id}/raw?download=1`
          : await createSignedDownloadUrl(path, ARTIFACT_URL_TTL_SECONDS)
        return { artifactId: row.id, title, type, downloadUrl }
      } catch (e) {
        console.warn('[generate_artifact] failed:', e instanceof Error ? e.message : e)
        return { error: 'Failed to generate the artifact.' }
      }
    },
  })
}
