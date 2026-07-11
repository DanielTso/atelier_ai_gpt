'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ArtifactSummary } from '@/types'

interface SheetSpec { name: string; rows: (string | number)[][] }

function SheetsPreview({ content }: { content: string }) {
  let sheets: SheetSpec[] = []
  try {
    const parsed = JSON.parse(content)
    if (Array.isArray(parsed)) sheets = parsed
  } catch { /* not valid JSON — fall through to empty */ }

  if (sheets.length === 0) return <p className="text-sm text-muted-foreground">No preview available — download the file.</p>

  return (
    <div className="space-y-4">
      {sheets.map((sheet, si) => (
        <div key={si}>
          {sheet.name && <p className="mb-1 text-xs font-semibold text-muted-foreground">{sheet.name}</p>}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {(sheet.rows ?? []).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) =>
                      ri === 0
                        ? <th key={ci} className="border border-border bg-muted/40 px-2 py-1 text-left font-semibold">{String(cell)}</th>
                        : <td key={ci} className="border border-border px-2 py-1">{String(cell)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Inline preview of an artifact from its SOURCE content (not the binary):
 *  pdf → exact signed-URL iframe; sheets → HTML table; markdown (docx/pptx) → rendered HTML. */
export function ArtifactPreview({ artifact }: { artifact: ArtifactSummary }) {
  // HTML → live preview from the stored source. sandbox="allow-scripts" runs the
  // page's own JS but, without allow-same-origin, it cannot reach app cookies/session.
  // allow-popups(-to-escape-sandbox) lets the page's links (cited sources, video
  // thumbnail cards) open in a real new tab on a user click — still no same-origin
  // access, and popup blockers gate non-gesture window.opens as usual.
  if (artifact.type === 'html') {
    return (
      <iframe
        srcDoc={artifact.content ?? ''}
        title={artifact.title}
        sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
        className="h-full min-h-[60vh] w-full rounded-lg border border-border bg-white"
      />
    )
  }

  if (artifact.type === 'pdf' && artifact.downloadUrl) {
    // Embed via our SAME-ORIGIN proxy, not the cross-origin Supabase signed URL —
    // browsers increasingly block cross-origin PDFs in an <iframe>. (The Download
    // button still uses the signed downloadUrl.)
    return (
      <iframe
        src={`/api/artifacts/${artifact.id}/raw`}
        title={artifact.title}
        className="h-full min-h-[60vh] w-full rounded-lg border border-border"
      />
    )
  }

  const content = artifact.content ?? ''
  return (
    <div className="text-sm">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground/70">
        Preview (approximate) — download for the exact file
      </p>
      {artifact.format === 'sheets' ? (
        <SheetsPreview content={content} />
      ) : content ? (
        <div className="prose prose-sm max-w-none break-words dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No preview available — download the file.</p>
      )}
    </div>
  )
}
