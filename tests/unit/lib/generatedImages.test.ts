import { describe, it, expect } from 'vitest'
import { extractGeneratedImageOutputs } from '@/lib/generatedImages'

describe('extractGeneratedImageOutputs', () => {
  const valid = { storagePath: 'images/x/1.png', url: 'https://signed/1.png', mediaType: 'image/png', filename: 'cat.png' }

  it('pulls outputs from a tool-generate_image part', () => {
    const out = extractGeneratedImageOutputs([{ type: 'tool-generate_image', output: valid }])
    expect(out).toEqual([valid])
  })

  it('pulls outputs from a dynamic-tool generate_image part', () => {
    const out = extractGeneratedImageOutputs([{ type: 'dynamic-tool', toolName: 'generate_image', output: valid }])
    expect(out).toHaveLength(1)
    expect(out[0]?.storagePath).toBe(valid.storagePath)
  })

  it('ignores unrelated parts and other tools', () => {
    expect(extractGeneratedImageOutputs([
      { type: 'text', text: 'hi' },
      { type: 'tool-generate_artifact', output: { artifactId: 1 } },
      { type: 'dynamic-tool', toolName: 'something_else', output: valid },
    ])).toEqual([])
  })

  it('skips malformed outputs missing required string fields', () => {
    expect(extractGeneratedImageOutputs([
      { type: 'tool-generate_image', output: { storagePath: 'p', url: 'u' } }, // no mediaType
      { type: 'tool-generate_image', output: null },
      { type: 'tool-generate_image' },
    ])).toEqual([])
  })

  it('treats filename as optional', () => {
    const out = extractGeneratedImageOutputs([{ type: 'tool-generate_image', output: { storagePath: 'p', url: 'u', mediaType: 'image/png' } }])
    expect(out).toEqual([{ storagePath: 'p', url: 'u', mediaType: 'image/png', filename: undefined }])
  })
})
