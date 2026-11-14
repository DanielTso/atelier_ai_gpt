// src/lib/artifacts/shape.ts
// The content shape each artifact type takes: xlsx is an array of {name, rows},
// every other type is a string. A mismatch used to be coerced to EMPTY content
// and saved as a blank file reported as success (audit B14). Shared by the
// generate_artifact tool, renderArtifact and the edit/regenerate routes.
import { z } from 'zod'
import type { ArtifactType } from './types'

// What generate_artifact asks the model for: named sheets of string/number cells.
export const artifactSheetsSchema = z.array(z.object({
  name: z.string(),
  rows: z.array(z.array(z.union([z.string(), z.number()]))),
}))

// What toXlsx can actually render. Edited and regenerated sheets arrive as parsed
// JSON with empty (null) cells, booleans or no name, and toXlsx handles all of
// them (a missing name becomes "SheetN"), so the shape check only insists on
// an array of sheets whose rows are arrays of arrays.
const renderableSheetsSchema = z.array(z.object({
  name: z.string().optional(),
  rows: z.array(z.array(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
}))

/** Why `content` cannot be rendered as `type`, or null when the shape fits. */
export function artifactContentShapeError(type: ArtifactType, content: unknown): string | null {
  if (type === 'xlsx') {
    if (!Array.isArray(content)) return 'xlsx artifacts need content as an array of sheets ({name, rows}), not a string.'
    if (!renderableSheetsSchema.safeParse(content).success) return 'xlsx artifacts need every sheet to be {name, rows}, with rows as arrays of cells.'
    return null
  }
  return typeof content === 'string' ? null : `${type} artifacts need content as a string, not an array of sheets.`
}
