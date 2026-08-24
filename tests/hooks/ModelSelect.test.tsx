// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ModelSelect } from '@/components/ui/ModelSelect'
import type { Model } from '@/types'

// Radix Select needs these pointer APIs which jsdom does not implement.
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn()
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(cleanup)

const OPUS: Model = {
  name: 'Claude Opus 4.8',
  model: 'claude-opus-4-8',
  digest: 'opus',
  provider: 'anthropic',
  family: 'opus',
  capabilities: { supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsThinking: true, supportsImageInput: true, supportsStructuredOutputs: true },
  pricing: { inputPerMTok: 5, outputPerMTok: 25, estimated: false },
}

// An estimated (family-tier) price — a hypothetical brand-new snapshot not yet
// hand-priced in EXACT_PRICING.
const NOVA: Model = {
  name: 'Claude Nova 3',
  model: 'claude-nova-3',
  digest: 'nova',
  provider: 'anthropic',
  family: 'other',
  capabilities: { supportsEffort: true, effortLevels: ['low', 'medium', 'high', 'max'], supportsThinking: true, supportsImageInput: true, supportsStructuredOutputs: true },
  pricing: { inputPerMTok: 5, outputPerMTok: 25, estimated: true },
}

// The "not token-priced" sentinel — Nano Banana 2 is priced per image, not per
// token. Must never render as "$0.00" / "~$0 est.".
const NANO_BANANA: Model = {
  name: 'Nano Banana 2',
  model: 'gemini-3.1-flash-image',
  digest: 'nano',
  provider: 'google',
  family: 'nano-banana',
  capabilities: { supportsEffort: false, effortLevels: [], supportsThinking: false, supportsImageInput: true, supportsStructuredOutputs: false },
  pricing: { inputPerMTok: 0, outputPerMTok: 0, estimated: true },
}

function openSelect() {
  const trigger = screen.getByRole('combobox', { name: 'Select model' })
  fireEvent.click(trigger)
}

describe('ModelSelect', () => {
  it('groups models by provider (Claude vs Image), not by name substring', () => {
    render(<ModelSelect models={[OPUS, NANO_BANANA]} value={OPUS.model} onChange={vi.fn()} />)
    openSelect()
    expect(screen.getByText('Claude')).toBeTruthy()
    expect(screen.getByText('Image')).toBeTruthy()
    // The selected model's name renders twice (trigger + its own option row);
    // the non-selected one renders once (option row only).
    expect(screen.getAllByText('Claude Opus 4.8').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Nano Banana 2')).toBeTruthy()
  })

  it('renders the exact price for a non-estimated model, no est. chip', () => {
    render(<ModelSelect models={[OPUS]} value={OPUS.model} onChange={vi.fn()} />)
    openSelect()
    expect(screen.getByText('$5 / $25')).toBeTruthy()
    expect(screen.queryByText('est.')).toBeNull()
  })

  it('marks an estimated price with a leading ~ and an est. chip', () => {
    render(<ModelSelect models={[NOVA]} value={NOVA.model} onChange={vi.fn()} />)
    openSelect()
    expect(screen.getByText('~$5 / $25')).toBeTruthy()
    expect(screen.getByText('est.')).toBeTruthy()
  })

  it('renders no dollar price for the 0/0 not-token-priced sentinel', () => {
    render(<ModelSelect models={[NANO_BANANA]} value={NANO_BANANA.model} onChange={vi.fn()} />)
    openSelect()
    expect(screen.queryByText(/\$0/)).toBeNull()
    expect(screen.queryByText('~$0 / $0')).toBeNull()
    expect(screen.getByText('per image')).toBeTruthy()
  })
})
