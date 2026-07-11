import { NextResponse } from 'next/server'
import { getArtifactById } from '@/app/actions'
import { isStorageConfigured, downloadToBuffer } from '@/lib/storage'

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  html: 'text/html; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

// GET /api/artifacts/:id/raw — stream the artifact's stored file from Supabase
// Storage SAME-ORIGIN. The in-app PDF preview embeds this route (not the cross-origin
// Supabase signed URL) because browsers increasingly refuse to render cross-origin PDFs
// inside an <iframe> ("content is blocked"). It is also the DOWNLOAD path for HTML
// artifacts: Supabase's storage endpoint refuses to serve text/html as HTML, so signed
// URL downloads arrived named ".txt". Serving from our origin keeps the real type and
// filename. SECURITY: only PDFs are ever served inline — model-generated HTML rendered
// inline on the app origin would execute with app cookies; it is always an attachment
// here (the live preview uses a sandboxed srcDoc iframe, not this route).
// Auth-gated by the proxy (same-origin requests send the session cookie).
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 })
  }
  const id = Number((await params).id)
  if (!id || isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

  const artifact = await getArtifactById(id)
  if (!artifact || !artifact.storagePath) {
    return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })
  }

  try {
    const buf = await downloadToBuffer(artifact.storagePath)
    const contentType = CONTENT_TYPES[artifact.type as string] ?? 'application/octet-stream'
    const wantDownload = new URL(req.url).searchParams.get('download') === '1'
    const filename = artifact.storagePath.split('/').pop() ?? `artifact.${artifact.type}`
    const inline = artifact.type === 'pdf' && !wantDownload
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': inline ? 'inline' : `attachment; filename="${filename.replace(/"/g, '')}"`,
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load file' }, { status: 502 })
  }
}
