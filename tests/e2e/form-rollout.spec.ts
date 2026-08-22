import { expect, test } from '@playwright/test'
import type { Locator } from '@playwright/test'
import { setOwnerAuth } from './helpers/auth'

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812, formHeight: 44 },
  { name: 'tablet', width: 768, height: 900, formHeight: 40 },
  { name: 'desktop', width: 1440, height: 1000, formHeight: 40 },
] as const

async function expectHeight(locator: Locator, minimum: number) {
  await expect(locator).toBeVisible()
  await expect.poll(async () => (await locator.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(minimum)
}

async function expectNoHorizontalOverflow(page: Parameters<typeof setOwnerAuth>[0]) {
  const widths = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client + 1)
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: operational booking and payment forms keep semantic geometry`, async ({ page }) => {
    setOwnerAuth(page)
    await page.setViewportSize(viewport)

    await page.goto('/dashboard/bookings/new')
    await expectHeight(page.getByLabel('Servicio'), viewport.formHeight)
    await expectHeight(page.getByLabel('Nombre'), viewport.formHeight)
    await expectHeight(page.getByLabel('Fecha'), viewport.formHeight)
    await expectHeight(page.getByRole('button', { name: 'Hora' }), viewport.formHeight)
    await expectNoHorizontalOverflow(page)

    await page.goto('/dashboard/payments')
    await page.getByRole('button', { name: 'Registrar pago', exact: true }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expectHeight(dialog.getByRole('combobox', { name: /^Reserva/ }), 48)
    await expectHeight(dialog.getByLabel(/Monto \(/), 48)
    await expectHeight(dialog.getByLabel('Método de pago'), 48)
    await expectNoHorizontalOverflow(page)
  })

  test(`${viewport.name}: customer search and edit forms stay aligned`, async ({ page }) => {
    setOwnerAuth(page)
    await page.setViewportSize(viewport)

    await page.goto('/dashboard/customers')
    await expectHeight(page.getByRole('searchbox'), viewport.formHeight)
    await expectHeight(page.getByRole('button', { name: 'Buscar', exact: true }), viewport.formHeight)
    await expectNoHorizontalOverflow(page)

    await page.locator('a[href^="/dashboard/customers/"]:visible').first().click()
    await page.getByRole('button', { name: 'Editar datos' }).click()
    await expectHeight(page.getByLabel('Nombre'), viewport.formHeight)
    await expectHeight(page.getByLabel('Telefono'), viewport.formHeight)
    await expectNoHorizontalOverflow(page)
  })

  test(`${viewport.name}: marketing dialogs keep form geometry without overflow`, async ({ page }) => {
    setOwnerAuth(page)
    await page.setViewportSize(viewport)

    await page.goto('/dashboard/promociones')
    await page.getByRole('button', { name: 'Nueva promoción' }).click()
    const promotionDialog = page.getByRole('dialog')
    await expectHeight(promotionDialog.getByLabel(/^Nombre/), viewport.formHeight)
    await expectHeight(promotionDialog.getByLabel('Descripción'), 96)
    await expectHeight(promotionDialog.getByRole('button', { name: '% descuento' }), viewport.formHeight)
    await expectHeight(promotionDialog.getByRole('button', { name: 'Crear promoción' }), 48)
    await expectNoHorizontalOverflow(page)

    await page.keyboard.press('Escape')
    await page.goto('/dashboard/campanas')
    await page.getByRole('button', { name: 'Nueva campaña' }).click()
    const campaignDialog = page.getByRole('dialog')
    await expectHeight(campaignDialog.locator('#campaign-name'), viewport.formHeight)
    await expectHeight(campaignDialog.getByRole('button', { pressed: true }).first(), viewport.formHeight)
    await expectHeight(campaignDialog.locator('#campaign-message'), 96)
    await expectHeight(campaignDialog.getByRole('button', { name: 'Crear campaña' }), 48)
    await expectNoHorizontalOverflow(page)
  })
}
