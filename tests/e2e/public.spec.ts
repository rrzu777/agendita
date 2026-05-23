import { test, expect } from '@playwright/test'

test.describe('public pages', () => {
  test('landing page loads', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveTitle(/Agendita/)
    await expect(page.locator('h1')).toBeVisible()
  })

  test('landing page has navigation', async ({ page }) => {
    await page.goto('/')
    const bodyText = await page.locator('body').innerText()
    expect(bodyText).toContain('Agenda')
    expect(bodyText).toContain('Crear cuenta')
    expect(bodyText).toContain('Iniciar sesión')
  })

  test('book page loads', async ({ page }) => {
    const response = await page.goto('/book')
    // Page should return HTTP 200
    expect(response?.status()).toBe(200)
  })

  test('public business profile accessible', async ({ page }) => {
    const response = await page.goto('/b/mimosnails')
    // Page should return HTTP 200 (even if DB is not fully migrated, shouldn't crash)
    expect(response?.status()).toBe(200)
  })

  test('login page accessible', async ({ page }) => {
    const response = await page.goto('/login')
    expect(response?.status()).toBe(200)
  })

  test('register page accessible', async ({ page }) => {
    const response = await page.goto('/register')
    expect(response?.status()).toBe(200)
  })
})

test.describe('booking flow', () => {
  test('booking page for seed business loads without server error', async ({ page }) => {
    const response = await page.goto('/book/mimosnails')
    // Should return 200 or at least not 500
    expect(response?.status()).toBeLessThan(500)
  })
})

test.describe('dashboard auth guard', () => {
  test('dashboard redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/dashboard')
    // Should redirect to /login
    await page.waitForURL(/\/login/, { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('dashboard services redirects to login', async ({ page }) => {
    await page.goto('/dashboard/services')
    await page.waitForURL(/\/login/, { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('dashboard bookings redirects to login', async ({ page }) => {
    await page.goto('/dashboard/bookings')
    await page.waitForURL(/\/login/, { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('dashboard calendar redirects to login', async ({ page }) => {
    await page.goto('/dashboard/calendar')
    await page.waitForURL(/\/login/, { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('dashboard customers redirects to login', async ({ page }) => {
    await page.goto('/dashboard/customers')
    await page.waitForURL(/\/login/, { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })

  test('dashboard settings redirects to login', async ({ page }) => {
    await page.goto('/dashboard/settings')
    await page.waitForURL(/\/login/, { timeout: 10000 })
    expect(page.url()).toContain('/login')
  })
})
