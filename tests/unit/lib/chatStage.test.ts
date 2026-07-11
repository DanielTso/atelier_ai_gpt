import { describe, it, expect } from 'vitest'
import { deriveAssistantStage } from '@/lib/chatStage'

const assistant = (parts: unknown[]) => ({ role: 'assistant', parts })

describe('deriveAssistantStage', () => {
  it('idle when not loading', () => {
    expect(deriveAssistantStage('ready', assistant([{ type: 'text', text: 'hi' }]))).toBe('idle')
    expect(deriveAssistantStage('error', undefined)).toBe('idle')
  })

  it('submitted before the assistant message exists', () => {
    expect(deriveAssistantStage('submitted', undefined)).toBe('submitted')
    expect(deriveAssistantStage('streaming', { role: 'user', parts: [{ type: 'text', text: 'q' }] })).toBe('submitted')
  })

  it('submitted while the assistant message has no parts yet', () => {
    expect(deriveAssistantStage('streaming', assistant([]))).toBe('submitted')
  })

  it('thinking while reasoning streams with no answer text', () => {
    expect(deriveAssistantStage('streaming', assistant([{ type: 'reasoning', text: 'hmm', state: 'streaming' }]))).toBe('thinking')
  })

  it('writing once non-empty answer text exists', () => {
    expect(deriveAssistantStage('streaming', assistant([
      { type: 'reasoning', text: 'hmm', state: 'done' },
      { type: 'text', text: 'The answer' },
    ]))).toBe('writing')
  })

  it('generating-image while the image tool is active', () => {
    expect(deriveAssistantStage('streaming', assistant([
      { type: 'tool-generate_image', state: 'input-available' },
    ]))).toBe('generating-image')
  })

  it('building-artifact for a dynamic tool part', () => {
    expect(deriveAssistantStage('streaming', assistant([
      { type: 'dynamic-tool', toolName: 'generate_artifact', state: 'input-streaming' },
    ]))).toBe('building-artifact')
  })

  it('searching while the server web_search tool runs', () => {
    expect(deriveAssistantStage('streaming', assistant([
      { type: 'tool-web_search', state: 'input-available' },
    ]))).toBe('searching')
  })

  it('a completed tool no longer wins — falls back to writing when text follows', () => {
    expect(deriveAssistantStage('streaming', assistant([
      { type: 'tool-generate_image', state: 'output-available', output: { url: 'u' } },
      { type: 'text', text: 'Here is your image' },
    ]))).toBe('writing')
  })

  it('a completed tool with no text yet reads as thinking', () => {
    expect(deriveAssistantStage('streaming', assistant([
      { type: 'tool-generate_image', state: 'output-available', output: { url: 'u' } },
    ]))).toBe('thinking')
  })

  it('an unknown running tool degrades to thinking, never throws', () => {
    expect(deriveAssistantStage('streaming', assistant([
      { type: 'tool-mystery_tool', state: 'input-available' },
    ]))).toBe('thinking')
  })

  it('step-start noise parts alone read as thinking', () => {
    expect(deriveAssistantStage('streaming', assistant([{ type: 'step-start' }]))).toBe('thinking')
  })
})
