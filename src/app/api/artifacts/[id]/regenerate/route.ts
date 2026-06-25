import { NextResponse } from 'next/server'
import { createAnthropic } from '@ai-sdk/anthropic'
import { generateText } from 'ai'
import { getArtifactById, addArtifactVersion } from '@/app/actions'
import { getAnthropicApiKey } from '@/lib/settings'
import { isStorageConfigured, uploadBuffer, signedArtifactUrl, removeObjects } from '@/lib/storage'
import { renderArtifact } from '@/lib/artifacts/render'
import { artifactStoragePath } from '@/lib/artifacts/path'
import type { ArtifactType, SheetSpec } from '@/lib/artifacts/types'
import { artifactRegenerateRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'

const REGEN_MODEL = 'claude-sonnet-4-6'

// POST /api/artifacts/:id/regenerate — ask Claude to revise the artifact's source
// per an instruction, re-render, and append a new version.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!isStorageConfigured()) {
      return NextResponse.json({ error: 'File storage is not configured.' }, { status: 503 })
    }
    const id = Number((await params).id)
    if (!id || isNaN(id)) return NextResponse.json({ error: 'Invalid id' }, { status: 400 })

    const body = artifactRegenerateRequestSchema.safeParse(await req.json())
    if (!body.success) return apiError(body.error, 'Invalid request body', 400)

    const apiKey = await getAnthropicApiKey()
    if (!apiKey) return NextResponse.json({ error: 'No Anthropic API key configured.' }, { status: 503 })

    const artifact = await getArtifactById(id)
    if (!artifact) return NextResponse.json({ error: 'Artifact not found' }, { status: 404 })

    const type = artifact.type as ArtifactType
    const title = artifact.title
    const isSheets = artifact.format === 'sheets'
    const isHtml = artifact.format === 'html'
    const prompt = isSheets
      ? `You are revising a spreadsheet artifact titled "${title}". Current content is a JSON array of {name, rows}:\n\n${artifact.content ?? '[]'}\n\nApply this instruction: ${body.data.instruction}\n\nReturn ONLY the full updated JSON array — no prose, no code fences.`
      : isHtml
      ? `You are revising an HTML page artifact titled "${title}". Current content is a complete standalone HTML document:\n\n${artifact.content ?? ''}\n\nApply this instruction: ${body.data.instruction}\n\nReturn ONLY the full updated HTML document (inline CSS/JS, single file) — no prose, no code fences.`
      : `You are revising a document artifact titled "${title}". Current content is Markdown:\n\n${artifact.content ?? ''}\n\nApply this instruction: ${body.data.instruction}\n\nReturn ONLY the full updated Markdown — no commentary, no code fences.`

    const anthropic = createAnthropic({ apiKey })
    const { text } = await generateText({ model: anthropic(REGEN_MODEL), prompt, maxOutputTokens: 8000 })

    // Strip accidental code fences, then coerce to the artifact's format.
    const raw = text.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim()
    let content: string | unknown[]
    if (isSheets) {
      const match = raw.match(/\[[\s\S]*\]/)
      if (!match) return NextResponse.json({ error: 'Could not parse regenerated spreadsheet.' }, { status: 422 })
      try { content = JSON.parse(match[0]) } catch { return NextResponse.json({ error: 'Could not parse regenerated spreadsheet.' }, { status: 422 }) }
    } else {
      if (!raw) return NextResponse.json({ error: 'Regeneration produced empty content.' }, { status: 422 })
      content = raw
    }

    const { buffer, contentType, ext } = await renderArtifact(type, title, content as string | SheetSpec[])
    const path = artifactStoragePath(artifact.projectId, title, ext)
    await uploadBuffer(path, buffer, contentType)

    const contentStr = typeof content === 'string' ? content : JSON.stringify(content)
    let result: { version: number }
    try {
      result = await addArtifactVersion(id, { type, title, format: artifact.format ?? (isSheets ? 'sheets' : 'markdown'), content: contentStr, storagePath: path })
    } catch (e) {
      await removeObjects([path]).catch(() => {})
      throw e
    }

    const downloadUrl = await signedArtifactUrl(path)
    return NextResponse.json({ artifactId: id, version: result.version, title, type, downloadUrl })
  } catch (error) {
    return apiError(error, 'Failed to regenerate artifact', 500)
  }
}
