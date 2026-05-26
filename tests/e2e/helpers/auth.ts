import { Page, expect } from '@playwright/test'

const E2E_SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'
const E2E_EMAIL = process.env.PLAYWRIGHT_E2E_EMAIL || 'e2e@test.agendita.com'
const E2E_OWNER_EMAIL = process.env.PLAYWRIGHT_E2E_OWNER_EMAIL || 'owner@mimosnails.com'
const E2E_ADMIN_EMAIL = process.env.PLAYWRIGHT_E2E_ADMIN_EMAIL || 'admin@agendita.com'

/**
 * Set E2E auth bypass headers for a regular business user (staff role).
 */
export function setBusinessAuth(page: Page) {
  page.setExtraHTTPHeaders({
    'x-e2e-test-user-email': E2E_EMAIL,
    'x-e2e-auth-secret': E2E_SECRET,
  })
}

/**
 * Set E2E auth bypass headers for the business owner.
 */
export function setOwnerAuth(page: Page) {
  page.setExtraHTTPHeaders({
    'x-e2e-test-user-email': E2E_OWNER_EMAIL,
    'x-e2e-auth-secret': E2E_SECRET,
  })
}

/**
 * Set E2E auth bypass headers for a platform admin.
 * Only works when PLATFORM_ADMIN_EMAILS includes the admin email.
 */
export function setAdminAuth(page: Page) {
  page.setExtraHTTPHeaders({
    'x-e2e-test-user-email': E2E_ADMIN_EMAIL,
    'x-e2e-auth-secret': E2E_SECRET,
  })
}

/**
 * Login as the pre-seeded business user (e2e@test.agendita.com)
 * via the E2E auth bypass mechanism.
 */
export async function loginAsBusiness(page: Page) {
  setBusinessAuth(page)
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await expect(page.url()).toContain('/dashboard')
}

/**
 * Login as the business owner (owner@mimosnails.com) via auth bypass.
 */
export async function loginAsOwner(page: Page) {
  setOwnerAuth(page)
  await page.goto('/dashboard')
  await page.waitForLoadState('networkidle')
  await expect(page.url()).toContain('/dashboard')
}

/**
 * Login as a platform admin via auth bypass.
 * Redirects to /admin panel.
 */
export async function loginAsAdmin(page: Page) {
  setAdminAuth(page)
  await page.goto('/admin')
  await page.waitForLoadState('networkidle')
  // Admin guard redirects to /login if not authorized
  await expect(page.url()).not.toContain('/login')
}

/**
 * Visit /login, fill credentials, submit, wait for redirect.
 * Returns true if login succeeded, false if an error was shown.
 *
 * NOTE: Uses real Supabase auth and requires the user to exist
 * in both Supabase and Prisma with a known password.
 */
export async function loginWithCredentials(
  page: Page,
  email: string,
  password: string,
): Promise<{ success: boolean; error?: string }> {
  await page.goto('/login')
  await page.waitForLoadState('networkidle')

  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Contraseña').fill(password)
  await page.getByRole('button', { name: 'Iniciar sesión' }).click()

  try {
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 })
    return { success: true }
  } catch {
    const errorLocator = page.locator('[class*="destructive"]')
    const errorText = await errorLocator.textContent().catch(() => null)
    return { success: false, error: errorText ?? 'Login failed or redirect did not happen' }
  }
}

/**
 * Visit /register and fill the registration form.
 * Call with acceptTerms=true to auto-accept terms checkbox.
 */
export async function registerBusiness(
  page: Page,
  opts: {
    name: string
    email: string
    password: string
    category?: string
    acceptTerms?: boolean
    useServiceTemplate?: boolean
  },
) {
  await page.goto('/register')
  await page.waitForLoadState('networkidle')

  await page.getByLabel('Nombre').fill(opts.name)
  await page.getByLabel('Email').fill(opts.email)
  await page.getByLabel('Contraseña').fill(opts.password)

  if (opts.category && opts.category !== 'other') {
    await page.locator('select[name="category"]').selectOption(opts.category)
  }

  if (opts.useServiceTemplate) {
    await page.locator('input[type="checkbox"][name="useServiceTemplate"]').check()
  }

  if (opts.acceptTerms) {
    await page.locator('input[type="checkbox"]#accept-terms').check()
  }

  await page.getByRole('button', { name: /crear cuenta/i }).click()
}
