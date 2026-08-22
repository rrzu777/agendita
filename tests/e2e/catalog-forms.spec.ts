import { expect, test } from '@playwright/test'
import { setOwnerAuth } from './helpers/auth'

const VIEWPORTS = [
  { name: 'mobile', width: 375, height: 812, controlHeight: 44 },
  { name: 'tablet', width: 768, height: 900, controlHeight: 40 },
  { name: 'desktop', width: 1440, height: 1000, controlHeight: 40 },
] as const

async function expectNoHorizontalOverflow(page: Parameters<typeof setOwnerAuth>[0]) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))

  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)
}

for (const viewport of VIEWPORTS) {
  test(`${viewport.name}: service and team dialogs use the shared form geometry`, async ({ page }) => {
    setOwnerAuth(page)
    await page.setViewportSize(viewport)

    await page.goto('/dashboard/services')
    await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()

    const serviceDialog = page.getByRole('dialog')
    await expect(serviceDialog).toBeVisible()
    await expect(serviceDialog.getByRole('group', { name: '¿Dónde se atiende?' })).toBeVisible()
    for (const label of ['Nombre', 'Descripción', 'Precio', 'Abono', 'Horas', 'Minutos', 'Código hexadecimal']) {
      const control = serviceDialog.getByLabel(label)
      await expect(control).toBeVisible()
      await expect.poll(async () => (await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(viewport.controlHeight)
    }
    await expectNoHorizontalOverflow(page)
    await page.keyboard.press('Escape')

    await page.goto('/dashboard/equipo')
    await page.getByRole('button', { name: /^Agregar / }).first().click()

    const teamDialog = page.getByRole('dialog')
    await expect(teamDialog).toBeVisible()
    await expect(teamDialog.getByRole('group', { name: '¿Qué servicios hace?' })).toBeVisible()
    await expect(teamDialog.getByRole('group', { name: '¿Dónde atiende?' })).toBeVisible()
    for (const label of ['Nombre', 'Presentación']) {
      const control = teamDialog.getByLabel(label)
      await expect(control).toBeVisible()
      await expect.poll(async () => (await control.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(viewport.controlHeight)
    }
    await expectNoHorizontalOverflow(page)
  })
}
