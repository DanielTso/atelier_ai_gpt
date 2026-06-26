import { test, expect } from '@playwright/test'

// Regression: selecting a persona BEFORE any chat exists (the default state since chats
// are created lazily on first send) must update the composer's persona chip. Previously
// the change handler early-returned when there was no active chat, so the chip stayed
// stuck on "General Assistant" no matter which named persona you picked.
test.describe('Persona selection', () => {
  test('selecting a persona in the empty state updates the composer chip', async ({ page }) => {
    await page.goto('/')

    const personaButton = page.getByTitle('Select persona')
    await expect(personaButton).toBeVisible()
    await expect(personaButton).toContainText('General Assistant')

    await personaButton.click()
    // Pick a distinct named persona from the dropdown (no name overlap with others).
    await page.getByRole('menuitem', { name: /Deep Analysis/i }).click()

    // The chip must now reflect the chosen persona, not the default.
    await expect(personaButton).toContainText('Deep Analysis')
    await expect(personaButton).not.toContainText('General Assistant')
  })
})
