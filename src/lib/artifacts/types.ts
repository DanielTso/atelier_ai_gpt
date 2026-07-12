export type ArtifactType = 'xlsx' | 'docx' | 'pdf' | 'pptx' | 'html' | 'code'

export interface SheetSpec {
  name: string
  rows: (string | number)[][]
}

export interface RenderedArtifact {
  buffer: Buffer
  contentType: string
  /** File extension for the storage path — the type itself for document types,
   *  the language's extension (py/sh/ts/…) for code artifacts. */
  ext: string
}
