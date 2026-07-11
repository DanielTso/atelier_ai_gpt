import { NextRequest, NextResponse } from 'next/server'
import { isStorageConfigured, downloadToBuffer } from '@/lib/storage'

// Generated-image paths only — a strict allow-list, not a general storage proxy.
// attachments/<chatId>/generated/<uuid>.<ext> (chat generate_image tool)
// images/<projectId|standalone>/<uuid>.<ext>  (standalone Images studio)
const ALLOWED_PATH = /^(attachments\/\d+\/generated|images\/(\d+|standalone))\/[A-Za-z0-9-]+\.(png|jpe?g|webp|gif)$/

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
}

// GET /api/files/raw?path=… — stream a generated image SAME-ORIGIN with a stable
// URL. HTML artifacts embed this (their srcDoc iframes inherit the app CSP, whose
// img-src allows 'self'), so pages keep their imagery forever instead of going
// blank when the 24h signed URL dies. Auth-gated by middleware; the path is
// allow-listed to generated-image locations only (single-user app — any
// authenticated session may read any generated image).
export async function GET(req: NextRequest) {
  if (!isStorageConfigured()) {
    return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 })
  }
  const path = req.nextUrl.searchParams.get('path') ?? ''
  if (!ALLOWED_PATH.test(path)) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  try {
    const buf = await downloadToBuffer(path)
    const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream',
        'Content-Disposition': 'inline',
        // Generated files are immutable (uuid names) — cache hard, privately.
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch {
    return NextResponse.json({ error: 'Failed to load file' }, { status: 502 })
  }
}
