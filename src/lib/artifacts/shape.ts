// src/lib/artifacts/shape.ts
// The content shape each artifact type takes: xlsx is an array of {name, rows},
// every other type is a string. A mismatch used to be coerced to EMPTY content
// and saved as a blank file reported as success (audit B14). Shared by the
// generate_artifact tool schema, renderArtifact and the regenerate route.
import { z } from 'zod'
import type { ArtifactType } from './types'

export const artifactSheetsSchema = z.array(z.object({
  name: z.string(),
  rows: z.array(z.array(z.union([z.string(), z.number()]))),
}))

/** Why `content` cannot be rendered as `type`, or null when the shape fits. */
export function artifactContentShapeError(type: ArtifactType, content: unknown): string | null {
  if (type === 'xlsx') {
    if (!Array.isArray(content)) return 'xlsx artifacts need content as an array of sheets ({name, rows}), not a string.'
    if (!artifactSheetsSchema.safeParse(content).success) return 'xlsx artifacts need every sheet to be {name: string, rows: (string | number)[][]}.'
    return null
  }
  return typeof content === 'string' ? null : `${type} artifacts need content as a string, not an array of sheets.`
}
