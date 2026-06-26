import { NextResponse } from 'next/server'
import { getArtifactById, addArtifactVersion } from '@/app/actions'
import { isStorageConfigured, uploadBuffer, signedArtifactUrl, removeObjects } from '@/lib/storage'
import { renderArtifact } from '@/lib/artifacts/render'
import { artifactStoragePath } from '@/lib/artifacts/path'
import type { ArtifactType } from '@/lib/artifacts/types'
import { artifactEditRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

// POST /api/artifacts/:id/edit — re-render the artifact from edited source and
// append a new version (no AI call).
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 })
    }
    const id = Number((await params).id)
    if (!id || isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const body = artifactEditRequestSchema.safeParse(await req.json())
    if (!body.success) return apiError(body.error, 'Invalid request body', 400)

    const artifact = await getArtifactById(id)
    if (!artifact) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })

    const type = artifact.type as ArtifactType
    const title = body.data.title ?? artifact.title
    const content = body.data.content
    // Guard the content shape against the artifact type. Without this, renderArtifact
    // silently coerces a mismatch (a string for xlsx, or an array for docx/pdf/pptx/html)
    // to EMPTY output and persists a blank version — silent data loss. Reject instead.
    const needsArray = type === 'xlsx'
    if (Array.isArray(content) !== needsArray) {
      return NextResponse.json(
        { error: `Invalid content shape for a ${type} artifact (expected ${needsArray ? 'an array of sheets' : 'a string'}).` },
        { status: 422 }
      )
    }
    const format = artifact.format ?? (type === 'html' ? 'html' : typeof content === 'string' ? 'markdown' : 'sheets')

    const { buffer, contentType, ext } = await renderArtifact(type, title, content)
    const path = artifactStoragePath(artifact.projectId, title, ext)
    await uploadBuffer(path, buffer, contentType)

    const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
    let result: { version: number }
    try {
      result = await addArtifactVersion(id, { type, title, format, content: contentStr, storagePath: path })
    } catch (e) {
      await removeObjects([path]).catch(() => {})
      throw e
    }

    const downloadUrl = await signedArtifactUrl(path)
    return NextResponse.json({ artifactId: id, version: result.version, title, type, downloadUrl })
  } catch (error) {
    return apiError(error, 'Failed to edit artifact', 500)
  }
}
