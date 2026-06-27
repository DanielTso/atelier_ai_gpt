// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/app/actions', () => ({
  getApiKeyStatus: vi.fn(),
  setSettings: vi.fn(),
}))

import { getApiKeyStatus, setSettings } from '@/app/actions'
import { ApiKeysSettingsTab } from '@/components/settings/ApiKeysSettingsTab'

const getStatus = getApiKeyStatus as ReturnType<typeof vi.fn>
const mockSetSettings = setSettings as ReturnType<typeof vi.fn>

describe('ApiKeysSettingsTab — Tavily', () => {
  beforeEach(() => {
    getStatus.mockReset(); mockSetSettings.mockReset()
    getStatus.mockResolvedValue({ gemini: false, anthropic: false, tavily: false })
    mockSetSettings.mockResolvedValue(undefined)
  })

  it('renders a Tavily key field and saves it', async () => {
    render(<ApiKeysSettingsTab />)
    const input = await screen.findByPlaceholderText(/tvly-/i)
    fireEvent.change(input, { target: { value: 'tvly-secret' } })
    fireEvent.click(screen.getByRole('button', { name: /save keys/i }))
    await waitFor(() => expect(mockSetSettings).toHaveBeenCalledWith(
      expect.arrayContaining([{ key: 'tavily-api-key', value: 'tvly-secret' }]),
    ))
  })

  it('shows Configured when status.tavily is true', async () => {
    getStatus.mockResolvedValue({ gemini: false, anthropic: false, tavily: true })
    render(<ApiKeysSettingsTab />)
    expect(await screen.findByText(/Web ingestion/i)).toBeTruthy()
    // a Configured chip is present for the Tavily section
    expect(screen.getAllByText(/Configured/i).length).toBeGreaterThanOrEqual(1)
  })
})
