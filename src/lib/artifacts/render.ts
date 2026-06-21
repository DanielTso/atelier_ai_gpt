import type { ArtifactType, SheetSpec, RenderedArtifact } from './types'
import { toXlsx } from './toXlsx'
import { toDocx } from './toDocx'
import { toPdf } from './toPdf'
import { toPptx } from './toPptx'

const CONTENT_TYPE: Record<ArtifactType, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}

export async function renderArtifact(
  type: ArtifactType,
  title: string,
  content: string | SheetSpec[]
): Promise<RenderedArtifact> {
  let buffer: Buffer
  if (type === 'xlsx') {
    buffer = await toXlsx(Array.isArray(content) ? content : [])
  } else if (type === 'docx') {
    buffer = await toDocx(typeof content === 'string' ? content : '')
  } else if (type === 'pdf') {
    buffer = await toPdf(typeof content === 'string' ? content : '')
  } else if (type === 'pptx') {
    buffer = await toPptx(typeof content === 'string' ? content : '')
  } else {
    throw new Error(`Unknown artifact type: ${type}`)
  }
  return { buffer, contentType: CONTENT_TYPE[type], ext: type }
}
