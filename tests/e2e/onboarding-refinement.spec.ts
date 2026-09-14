import { expect, test } from '@playwright/test'
import { prisma } from '@/lib/db'
import { assertSafeTestDatabaseUrl } from '../helpers/test-database-safety'
import { setOwnerAuth } from './helpers/auth'

assertSafeTestDatabaseUrl(process.env.DATABASE_URL)

test.describe('optional initial setup', () => {
  test.describe.configure({ mode: 'serial' })
  let original: { id: string; onboardingStep: number | null; onboardingCompletedAt: Date | null }

  test.beforeAll(async () => {
    original = await prisma.business.findUniqueOrThrow({
      where: { slug: 'mimosnails' },
      select: { id: true, onboardingStep: true, onboardingCompletedAt: true },
    })
  })

  test.beforeEach(async ({ page }) => {
    setOwnerAuth(page)
    await prisma.business.update({
      where: { id: original.id },
      data: { onboardingStep: 0, onboardingCompletedAt: null },
    })
  })

  test.afterEach(async () => {
    await prisma.business.update({
      where: { id: original.id },
      data: {
        onboardingStep: original.onboardingStep,
        onboardingCompletedAt: original.onboardingCompletedAt,
      },
    })
  })

  for (const width of [390, 834, 1440]) {
    test(`operates without finishing setup and navigates peer tabs at ${width}px`, async ({ page }) => {
      test.setTimeout(90_000)
      await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 })
      await page.goto('/dashboard')
      await expect(page).toHaveURL('/dashboard')
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      const checklist = page.locator('[data-tour-id="dashboard-checklist"]')
      for (const name of ['Copiar perfil', 'Copiar reserva', 'WhatsApp']) {
        const control = name === 'WhatsApp'
          ? checklist.getByRole('link', { name, exact: true })
          : checklist.getByRole('button', { name, exact: true })
        const box = await control.boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(44)
        expect(box?.width).toBeGreaterThanOrEqual(44)
      }
      await page.getByRole('link', { name: 'Continuar configuración inicial' }).click()
      await expect(page).toHaveURL('/dashboard/onboarding')
      await expect(page).toHaveTitle('Configura tu negocio — Agendita')
      const tabs = page.getByRole('tab')
      await expect(tabs).toHaveCount(5)
      const businessTab = page.getByRole('tab', { name: /^Tu negocio/ })
      await businessTab.focus()
      await page.keyboard.press('ArrowRight')
      await expect(page.getByRole('tab', { name: /^Servicios/ })).toBeFocused()
      await expect(page.getByRole('tab', { name: /^Servicios/ })).toHaveAttribute('aria-selected', 'true')
      await page.getByRole('tab', { name: /^Horarios/ }).click()
      await expect(page.getByRole('tabpanel')).toContainText('Define cuándo aceptas reservas')
      await expect.poll(async () => (await prisma.business.findUniqueOrThrow({ where: { id: original.id } })).onboardingStep).toBe(2)
      await page.reload()
      await expect(page.getByRole('tab', { name: /^Horarios/ })).toHaveAttribute('aria-selected', 'true')
      expect((await prisma.business.findUniqueOrThrow({ where: { id: original.id } })).onboardingCompletedAt).toBeNull()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
      for (const tab of await tabs.all()) {
        const box = await tab.boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(44)
      }
      await page.screenshot({ path: `output/playwright/onboarding-tabs-${width}.png`, fullPage: true })
    })
  }

  test('completes only on explicit action and does not return to setup', async ({ page }) => {
    await prisma.business.update({ where: { id: original.id }, data: { onboardingStep: 4 } })
    await page.goto('/dashboard/onboarding')
    await expect(page.getByRole('tab', { name: /^Listo para recibir reservas/ })).toHaveAttribute('aria-selected', 'true')
    await page.getByRole('button', { name: 'Finalizar configuración', exact: true }).click()
    await expect(page).toHaveURL('/dashboard')
    await expect(page.getByRole('link', { name: 'Continuar configuración inicial' })).toHaveCount(0)
    const saved = await prisma.business.findUniqueOrThrow({ where: { id: original.id } })
    expect(saved.onboardingCompletedAt).not.toBeNull()
    expect(saved.onboardingStep).toBeNull()
    await page.goto('/dashboard/onboarding')
    await expect(page).toHaveURL('/dashboard')
  })

  test('preserves the setup after a failed request and allows explicit retry', async ({ page }) => {
    await prisma.business.update({ where: { id: original.id }, data: { onboardingStep: 4 } })
    await page.goto('/dashboard/onboarding')
    await page.waitForLoadState('networkidle')
    let blocked = false
    await page.route('**/dashboard/onboarding', async route => {
      if (!blocked && route.request().method() === 'POST') {
        blocked = true
        await route.abort('failed')
      } else {
        await route.continue()
      }
    })
    const finish = page.getByRole('button', { name: 'Finalizar configuración', exact: true })
    await finish.click()
    await expect(page.getByRole('alert').filter({ hasText: 'Error al finalizar' })).toBeVisible()
    await expect(page).toHaveURL('/dashboard/onboarding')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: original.id } })).onboardingCompletedAt).toBeNull()
    await expect(finish).toBeEnabled()
    await finish.click()
    await expect(page).toHaveURL('/dashboard')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: original.id } })).onboardingCompletedAt).not.toBeNull()
  })
})
