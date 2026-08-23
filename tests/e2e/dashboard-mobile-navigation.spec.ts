import { expect, test, type Page } from '@playwright/test'
import { prisma } from '@/lib/db'
import { setOwnerAuth } from './helpers/auth'
import { assertSafeTestDatabaseUrl } from '../helpers/test-database-safety'
import {
  cleanupDashboardFixture,
  createDashboardFixture,
} from './helpers/dashboard-tour-fixture'

assertSafeTestDatabaseUrl(process.env.DATABASE_URL)

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth <= document.body.clientWidth,
    root: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }))).toEqual({ body: true, root: true })
}

test.describe('dashboard mobile navigation', () => {
  test.beforeEach(async ({ page }) => {
    setOwnerAuth(page)
    await page.setViewportSize({ width: 375, height: 812 })
  })

  test('keeps the primary destinations visible and exposes Payments and Settings through Más', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/dashboard')

    const primaryNavigation = page.getByRole('navigation', { name: 'Navegación principal del dashboard' })
    await expect(primaryNavigation.getByRole('link')).toHaveCount(3)
    await expect(primaryNavigation.getByRole('link', { name: 'Resumen', exact: true })).toBeVisible()
    await expect(primaryNavigation.getByRole('link', { name: 'Reservas', exact: true })).toBeVisible()
    await expect(primaryNavigation.getByRole('link', { name: 'Calendario', exact: true })).toBeVisible()

    const moreButton = page.getByRole('button', { name: 'Más opciones' })
    await expect(moreButton).toBeVisible()
    await moreButton.click()

    const moreNavigation = page.getByRole('navigation', { name: 'Más secciones del dashboard' })
    await expect(moreNavigation.getByRole('link', { name: 'Pagos', exact: true })).toBeVisible()
    await moreNavigation.getByRole('link', { name: 'Pagos', exact: true }).click()
    await expect(page).toHaveURL('/dashboard/payments')

    await moreButton.click()
    await expect(moreNavigation.getByRole('link', { name: 'Pagos', exact: true })).toHaveAttribute('aria-current', 'page')
    await moreNavigation.getByRole('link', { name: 'Configuración', exact: true }).click()
    await expect(page).toHaveURL('/dashboard/settings/profile', { timeout: 30_000 })

    await moreButton.click()
    await expect(moreNavigation.getByRole('link', { name: 'Configuración', exact: true })).toHaveAttribute('aria-current', 'page')
    await page.keyboard.press('Escape')
    await expect(moreButton).toBeFocused()
    await expectNoHorizontalOverflow(page)
  })

  test('guards mobile sign-out while settings contain unsaved changes', async ({ page }) => {
    await page.goto('/dashboard/settings/profile')
    const description = page.getByLabel('Descripción')
    await description.fill(`Borrador de navegación ${Date.now()}`)

    await page.getByRole('button', { name: 'Más opciones' }).click()
    await page.getByRole('button', { name: 'Cerrar sesión' }).click()

    const guard = page.getByRole('dialog')
    await expect(guard).toContainText('Cambios sin guardar')
    await page.getByRole('button', { name: 'Seguir editando' }).click()
    await expect(page.getByRole('button', { name: 'Cerrar sesión' })).toBeFocused()
  })

  test('keeps Más open when a dirty secondary navigation is cancelled', async ({ page }) => {
    await page.goto('/dashboard/settings/profile')
    await page.getByLabel('Descripción').fill(`Borrador secundario ${Date.now()}`)

    await page.getByRole('button', { name: 'Más opciones' }).click()
    const moreNavigation = page.getByRole('navigation', { name: 'Más secciones del dashboard' })
    await moreNavigation.getByRole('link', { name: 'Pagos', exact: true }).click()

    await expect(page.getByRole('dialog')).toContainText('Cambios sin guardar')
    await page.getByRole('button', { name: 'Seguir editando' }).click()
    await expect(page).toHaveURL('/dashboard/settings/profile')
    await expect(moreNavigation.getByRole('link', { name: 'Pagos', exact: true })).toBeVisible()

    await moreNavigation.getByRole('link', { name: 'Pagos', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('Cambios sin guardar')
    await page.getByRole('button', { name: 'Descartar cambios' }).click()
    await expect(page).toHaveURL('/dashboard/payments')
    await expect(moreNavigation).toHaveCount(0)
  })
})

test('staff mobile navigation omits Settings and Billing', async ({ page }) => {
  const fixture = await createDashboardFixture(prisma, { role: 'staff' })

  page.setExtraHTTPHeaders({
    'x-e2e-test-user-email': fixture.email,
    'x-e2e-auth-secret': process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local',
  })
  await page.setViewportSize({ width: 375, height: 812 })

  try {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Más opciones' }).click()

    const moreNavigation = page.getByRole('navigation', { name: 'Más secciones del dashboard' })
    await expect(moreNavigation.getByRole('link', { name: 'Configuración', exact: true })).toHaveCount(0)
    await expect(moreNavigation.getByRole('link', { name: 'Facturación', exact: true })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  } finally {
    await cleanupDashboardFixture(prisma, fixture)
  }
})
