import { expect, test, type Page } from '@playwright/test'
import { prisma } from '@/lib/db'
import { setOwnerAuth } from './helpers/auth'

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
})

test('staff mobile navigation omits Settings and Billing', async ({ page }) => {
  const email = `dashboard-mobile-staff-${Date.now()}@e2e.agendita.test`
  const business = await prisma.business.findUniqueOrThrow({
    where: { slug: 'mimosnails' },
    select: { id: true },
  })
  const staff = await prisma.user.create({ data: { email, name: 'Staff navegación móvil' } })

  page.setExtraHTTPHeaders({
    'x-e2e-test-user-email': email,
    'x-e2e-auth-secret': process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local',
  })
  await page.setViewportSize({ width: 375, height: 812 })
  await prisma.businessUser.create({ data: { businessId: business.id, userId: staff.id, role: 'staff' } })

  try {
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Más opciones' }).click()

    const moreNavigation = page.getByRole('navigation', { name: 'Más secciones del dashboard' })
    await expect(moreNavigation.getByRole('link', { name: 'Configuración', exact: true })).toHaveCount(0)
    await expect(moreNavigation.getByRole('link', { name: 'Facturación', exact: true })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
  } finally {
    await prisma.user.delete({ where: { id: staff.id } })
  }
})
