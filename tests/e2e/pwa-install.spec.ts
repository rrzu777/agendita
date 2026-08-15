import { expect, test } from '@playwright/test'

test.describe('PWA install journey', () => {
  test('uses the captured Chromium install prompt only after an explicit click', async ({ page }) => {
    await page.goto('/instalar')
    await expect(page.getByRole('heading', { name: 'Instala Agendita' })).toBeVisible()

    const defaultPrevented = await page.evaluate(() => {
      const event = new Event('beforeinstallprompt', { cancelable: true })
      Object.assign(event, {
        prompt: async () => {
          const state = window as typeof window & { __installPromptCalls?: number }
          state.__installPromptCalls = (state.__installPromptCalls ?? 0) + 1
        },
        userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }),
      })
      window.dispatchEvent(event)
      return event.defaultPrevented
    })

    expect(defaultPrevented).toBe(true)
    expect(await page.evaluate(() => (window as typeof window & { __installPromptCalls?: number }).__installPromptCalls ?? 0)).toBe(0)

    await page.getByRole('button', { name: 'Instalar ahora' }).click()

    await expect.poll(() => page.evaluate(() => (window as typeof window & { __installPromptCalls?: number }).__installPromptCalls ?? 0)).toBe(1)
  })

  test('offers the iOS home-screen instructions when no native prompt exists', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'userAgent', {
        configurable: true,
        value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
      })
      Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 5 })
    })

    await page.goto('/instalar')
    const installButton = page.getByRole('button', { name: 'Instalar ahora' })
    await installButton.click()

    await expect(installButton).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('status')).toContainText('Agregar a pantalla de inicio')
  })

  test('redirects a tenant host to the canonical installer', async ({ request }) => {
    const response = await request.get('/instalar', {
      headers: { 'x-forwarded-host': 'tenant.agendita.test' },
      maxRedirects: 0,
    })

    expect(response.status()).toBe(307)
    expect(response.headers().location).toBe('http://localhost:3000/instalar')
  })
})
