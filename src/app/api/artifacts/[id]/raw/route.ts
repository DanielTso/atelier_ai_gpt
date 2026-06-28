import { NextResponse } from 'next/server'
import { getArtifactById } from '@/app/actions'
import { isStorageConfigured, downloadToBuffer } from '@/lib/storage'

// Inline-renderable artifact types and their content types. Anything else is served
// as a generic download (octet-stream).
const INLINE_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
}

// GET /api/artifacts/:id/raw — stream the artifact's stored file from Supabase
// Storage SAME-ORIGIN. The in-app PDF preview embeds this route (not the cross-origin
// Supabase signed URL) because browsers increasingly refuse to render cross-origin PDFs
// inside an <iframe> ("content is blocked"). Serving it from our own origin sidesteps
// that entirely. Auth-gated by middleware (same-origin iframe sends the session cookie);
// next.config gives this path X-Frame-Options: SAMEORIGIN instead of the global DENY.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
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
    const contentType = INLINE_TYPES[artifact.type as string] ?? 'application/octet-stream'
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Disposition': 'inline',
        'Cache-Control': 'private, max-age=300',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load file' }, { status: 502 })
  }
}
