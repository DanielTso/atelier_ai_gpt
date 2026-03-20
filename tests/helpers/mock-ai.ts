import { vi } from 'vitest'

export function createMockStreamText() {
  return vi.fn().mockReturnValue({
    toUIMessageStreamResponse: () =>
      new Response('streamed', { status: 200 }),
  })
}

export function createMockGenerateText(text = 'Mock summary') {
  return vi.fn().mockResolvedValue({ text })
}

export function createMockGoogleProvider() {
  return vi.fn(() => vi.fn((model: string) => ({ modelId: model, provider: 'google' })))
}
