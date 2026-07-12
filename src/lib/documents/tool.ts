import { tool } from 'ai'
import { z } from 'zod'
import { downloadToBuffer } from '@/lib/storage'
import { getDocumentById } from '@/app/actions'
import { sliceWindow } from './windowing'

const windowChars = () => Number(process.env.READ_DOC_WINDOW_CHARS) || 100_000

export function createReadDocumentTool(ctx: { projectId: number }) {
  return tool({
    description:
      'Read the FULL extracted text of a project document, one window at a time. ' +
      'Use this for set-wide or exhaustive questions that retrieval chunks cannot answer — "list every…", ' +
      '"summarize the whole document", counting items across a plan set — or when the provided chunks are ' +
      'clearly insufficient. For a targeted question already covered by the retrieved document context, just answer. ' +
      'The document manifest in your instructions lists the available documents and ids. ' +
      'Each call returns ONE window (capped) plus continuation info: call again with fromPage (when page anchors exist) ' +
      'or offset=nextOffset to keep reading. Stop reading as soon as you have what you need.',
    inputSchema: z.object({
      documentId: z.number().int().positive(),
      fromPage: z.number().int().positive().optional()
        .describe('Start at this page anchor (documents with page structure only)'),
      offset: z.number().int().min(0).optional()
        .describe('Start at this character offset — pass the previous call\'s nextOffset to continue'),
    }),
    execute: async ({ documentId, fromPage, offset }) => {
      try {
        const doc = await getDocumentById(documentId)
        if (!doc || doc.projectId !== ctx.projectId) {
          return { error: 'Document not found in this project. Use an id from the document manifest.' }
        }
        const path = `documents/${doc.projectId}/${doc.id}/${doc.revision > 1 ? `rev${doc.revision}/` : ''}extracted.txt`
        let full: string
        try {
          full = (await downloadToBuffer(path)).toString('utf-8')
        } catch {
          return { error: `Full text is unavailable for "${doc.filename}" (ingested before whole-document support). Ask the user to re-upload it to enable whole-document reading.` }
        }
        const w = sliceWindow(full, { fromPage, offset, maxChars: windowChars() })
        if (!w.pageFound) {
          return { error: `No page ${fromPage} in "${doc.filename}" — it has ${w.totalAnchors} page anchors. Use offset-based reading or a page within range.` }
        }
        const failedPages = (doc.failedPages as number[] | null) ?? []
        return {
          documentId: doc.id,
          filename: doc.filename,
          totalChars: full.length,
          text: w.text,
          startOffset: w.startOffset,
          endOffset: w.endOffset,
          nextOffset: w.nextOffset,
          firstPage: w.firstPage,
          lastPage: w.lastPage,
          totalAnchors: w.totalAnchors,
          unavailablePages: failedPages,
          note: w.nextOffset == null
            ? 'End of document.'
            : `Partial window — continue with offset=${w.nextOffset} if more is needed.`,
        }
      } catch (e) {
        console.warn('[read_document] failed:', e instanceof Error ? e.message : e)
        return { error: 'Failed to read the document.' }
      }
    },
  })
}
