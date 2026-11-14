import { NextResponse } from 'next/server'
import { createAnthropic } from '@ai-sdk/anthropic'
import { streamText } from 'ai'
import { getArtifactById, addArtifactVersion } from '@/app/actions'
import { getAnthropicApiKey } from '@/lib/settings'
import { isStorageConfigured, uploadBuffer, signedArtifactUrl, removeObjects } from '@/lib/storage'
import { renderArtifact } from '@/lib/artifacts/render'
import { artifactStoragePath } from '@/lib/artifacts/path'
import { artifactLanguage } from '@/lib/artifacts/code'
import type { ArtifactType, SheetSpec } from '@/lib/artifacts/types'
import { artifactRegenerateRequestSchema } from '@/lib/validation'
import { apiError } from '@/lib/errors'
import { recordUsage } from '@/lib/usage'
import { resolveTier } from '@/lib/models/registry'
import { ARTIFACT_MAX_OUTPUT_TOKENS } from '@/lib/artifacts/limits'
import { artifactContentShapeError } from '@/lib/artifacts/shape'

// The newest Sonnet in the live registry (prior C8: a hardcoded id silently fell
// back to the default model once it left the catalog). resolveTier() is the
// registry's tier lookup; it never throws (an absent family falls back to the
// default Anthropic model).
const REGEN_TIER = 'sonnet'

// A full rewrite at the chat route's output cap can run for minutes.
export const maxDuration = 800

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
    const isCode = type === 'code'
    const prompt = isSheets
      ? `You are revising a spreadsheet artifact titled "${title}". Current content is a JSON array of {name, rows}:\n\n${artifact.content ?? '[]'}\n\nApply this instruction: ${body.data.instruction}\n\nReturn ONLY the full updated JSON array — no prose, no code fences.`
      : isHtml
      ? `You are revising an HTML page artifact titled "${title}". Current content is a complete standalone HTML document:\n\n${artifact.content ?? ''}\n\nApply this instruction: ${body.data.instruction}\n\nReturn ONLY the full updated HTML document (inline CSS/JS, single file) — no prose, no code fences.`
      : isCode
      ? `You are revising a ${artifact.format ?? 'code'} source file titled "${title}". Current content:\n\n${artifact.content ?? ''}\n\nApply this instruction: ${body.data.instruction}\n\nReturn ONLY the full updated source file — no prose, no code fences.`
      : `You are revising a document artifact titled "${title}". Current content is Markdown:\n\n${artifact.content ?? ''}\n\nApply this instruction: ${body.data.instruction}\n\nReturn ONLY the full updated Markdown — no commentary, no code fences.`

    const modelId = await resolveTier(REGEN_TIER)
    const anthropic = createAnthropic({ apiKey })
    // Streamed, then awaited whole: a non-streamed response at a 32k output cap
    // can outlast the HTTP client's 300 s headers timeout, which would fail the
    // request after the tokens were spent and drop its usage row.
    const stream = streamText({ model: anthropic(modelId), prompt, maxOutputTokens: ARTIFACT_MAX_OUTPUT_TOKENS })
    const [text, finishReason, totalUsage] = await Promise.all([stream.text, stream.finishReason, stream.totalUsage])

    // Usage capture (spec C6) — real Claude spend, recorded best-effort as soon
    // as tokens are spent (a parse/render failure below doesn't un-spend them).
    void recordUsage({ chatId: artifact.chatId, projectId: artifact.projectId ?? null, purpose: 'artifact-regenerate', model: modelId, usage: totalUsage }).catch(() => {})

    // Output that hit the token cap is a cut-off document. Saving it would make a
    // truncated file the current version (audit B6), so refuse and keep the old one.
    if (finishReason === 'length') {
      return NextResponse.json({ error: 'The regenerated artifact was cut off because it is too long. Nothing was saved; try a smaller change.' }, { status: 422 })
    }

    // Strip accidental code fences, then coerce to the artifact's format.
    const raw = text.trim().replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```$/, '').trim()
    let content: string | unknown[]
    if (isSheets) {
      const match = raw.match(/\[[\s\S]*\]/)
      if (!match) return NextResponse.json({ error: 'Could not parse regenerated spreadsheet.' }, { status: 422 })
      try { content = JSON.parse(match[0]) } catch { return NextResponse.json({ error: 'Could not parse regenerated spreadsheet.' }, { status: 422 }) }
      // Parsed model JSON is unvalidated: check it is really {name, rows} sheets.
      if (artifactContentShapeError('xlsx', content)) return NextResponse.json({ error: 'Could not parse regenerated spreadsheet.' }, { status: 422 })
    } else {
      if (!raw) return NextResponse.json({ error: 'Regeneration produced empty content.' }, { status: 422 })
      content = raw
    }

    const { buffer, contentType, ext } = await renderArtifact(type, title, content as string | SheetSpec[], artifactLanguage(type, artifact.format))
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

    // HTML downloads go same-origin (Supabase serves text/html signed URLs named .txt).
    const downloadUrl = type === 'html' ? `/api/artifacts/${id}/raw?download=1` : await signedArtifactUrl(path)
    return NextResponse.json({ artifactId: id, version: result.version, title, type, downloadUrl })
  } catch (error) {
    return apiError(error, 'Failed to regenerate artifact', 500)
  }
}
