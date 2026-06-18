export type ArtifactType = 'xlsx' | 'docx' | 'pdf'

export interface SheetSpec {
  name: string
  rows: (string | number)[][]
}

export interface RenderedArtifact {
  buffer: Buffer
  contentType: string
  ext: ArtifactType
}
