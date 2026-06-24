import { NextResponse } from 'next/server'
import { getArtifactById, addArtifactVersion } from '@/app/actions'
import { isStorageConfigured, uploadBuffer, createSignedDownloadUrl, removeObjects, ARTIFACT_URL_TTL_SECONDS } from '@/lib/storage'
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
    const format = artifact.format ?? (typeof content === 'string' ? 'markdown' : 'sheets')

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

    const downloadUrl = await createSignedDownloadUrl(path, ARTIFACT_URL_TTL_SECONDS).catch(() => null)
    return NextResponse.json({ artifactId: id, version: result.version, title, type, downloadUrl })
  } catch (error) {
    return apiError(error, 'Failed to edit artifact', 500)
  }
}
