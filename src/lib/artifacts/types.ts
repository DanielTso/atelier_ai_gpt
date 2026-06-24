export type ArtifactType = 'xlsx' | 'docx' | 'pdf' | 'pptx' | 'html'

export interface SheetSpec {
  name: string
  rows: (string | number)[][]
}

export interface RenderedArtifact {
  buffer: Buffer
  contentType: string
  ext: ArtifactType
}
