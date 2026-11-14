import type { ArtifactType, SheetSpec, RenderedArtifact } from './types'
import { toXlsx } from './toXlsx'
import { toDocx } from './toDocx'
import { toPdf } from './toPdf'
import { toPptx } from './toPptx'
import { codeLanguage } from './code'
import { artifactContentShapeError } from './shape'

const CONTENT_TYPE: Record<Exclude<ArtifactType, 'code'>, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  html: 'text/html; charset=utf-8',
}

export async function renderArtifact(
  type: ArtifactType,
  title: string,
  content: string | SheetSpec[],
  language?: string
): Promise<RenderedArtifact> {
  // A mismatched shape used to be coerced to EMPTY content and saved as a blank
  // file reported as success (audit B14). Refuse it instead.
  const shapeError = artifactContentShapeError(type, content)
  if (shapeError) throw new Error(shapeError)
  let buffer: Buffer
  if (type === 'xlsx') {
    buffer = await toXlsx(content as SheetSpec[])
  } else if (type === 'docx') {
    buffer = await toDocx(content as string)
  } else if (type === 'pdf') {
    buffer = await toPdf(content as string)
  } else if (type === 'pptx') {
    buffer = await toPptx(content as string)
  } else if (type === 'html') {
    // HTML needs no conversion — the model's HTML string IS the artifact.
    buffer = Buffer.from(content as string, 'utf-8')
  } else if (type === 'code') {
    const lang = codeLanguage(language)
    if (!lang) throw new Error(`Unknown code artifact language: ${language}`)
    // Passthrough like HTML — the model's source string IS the file.
    return {
      buffer: Buffer.from(content as string, 'utf-8'),
      contentType: 'text/plain; charset=utf-8',
      ext: lang.ext,
    }
  } else {
    throw new Error(`Unknown artifact type: ${type}`)
  }
  return { buffer, contentType: CONTENT_TYPE[type], ext: type }
}
