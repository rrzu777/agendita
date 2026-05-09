import { test, expect } from '@playwright/test'

test('landing page loads', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/Agendita/)
  await expect(page.locator('h1')).toContainText('Agenda online')
})
