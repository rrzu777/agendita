import { expect, test, type Page } from '@playwright/test'
import { setBusinessAuth, setOwnerAuth } from './helpers/auth'

const SETTINGS_ROUTES = [
  { slug: 'profile', label: 'Perfil público' },
  { slug: 'reservations', label: 'Reservas' },
  { slug: 'policies', label: 'Políticas y avisos' },
  { slug: 'payments', label: 'Pagos' },
] as const

const VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 900 },
  { width: 1024, height: 900 },
  { width: 1440, height: 900 },
] as const

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth <= document.body.clientWidth,
    root: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }))).toEqual({ body: true, root: true })
}

test.describe('settings navigation', () => {
  test.beforeEach(async ({ page }) => {
    setOwnerAuth(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`navigates through every section at ${viewport.width}px`, async ({ page }) => {
      test.setTimeout(60_000)
      await page.setViewportSize(viewport)
      await page.goto('/dashboard/settings')
      await expect(page).toHaveURL(/\/dashboard\/settings\/profile$/)
      await page.waitForLoadState('networkidle')

      for (const section of SETTINGS_ROUTES) {
        const link = page
          .getByRole('navigation', { name: 'Secciones de configuración' })
          .getByRole('link', { name: section.label, exact: true })
        await link.click()
        await expect(page).toHaveURL(new RegExp(`/dashboard/settings/${section.slug}$`))
        await expect(link).toHaveAttribute('aria-current', 'page')
      }

      await page
        .getByRole('navigation', { name: 'Secciones de configuración' })
        .getByRole('link', { name: 'Reservas', exact: true })
        .click()
      await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
    })
  }

  test('warns before discarding and restores a Back navigation draft', async ({ page }) => {
    await page.goto('/dashboard')
    await page.getByRole('link', { name: 'Configuración', exact: true }).click()
    await expect(page).toHaveURL(/\/dashboard\/settings\/profile$/)
    await page.waitForLoadState('networkidle')
    const description = page.getByLabel('Descripción')
    await expect(description).not.toHaveValue('')
    const draft = `Borrador ${Date.now()}`
    await description.fill(draft)

    const reservationsLink = page
      .getByRole('navigation', { name: 'Secciones de configuración' })
      .getByRole('link', { name: 'Reservas', exact: true })
    await reservationsLink.click()
    const guard = page.getByRole('dialog')
    await expect(guard).toContainText('Cambios sin guardar')
    await page.getByRole('button', { name: 'Seguir editando' }).click()
    await expect(reservationsLink).toBeFocused()
    await expect.poll(() => page.evaluate(() => Object.values(sessionStorage).join('\n'))).toContain(draft)

    await page.goBack()
    await expect(page).toHaveURL('/dashboard')
    await expect.poll(() => page.evaluate(() => Object.values(sessionStorage).join('\n'))).toContain(draft)
    await page.goForward()
    await expect(page).toHaveURL(/\/dashboard\/settings\/profile$/)
    await page.waitForLoadState('networkidle')
    await expect.poll(() => page.evaluate(() => Object.values(sessionStorage).join('\n'))).toContain(draft)
    await expect(page.getByText('Recuperamos un borrador local')).toBeVisible()
    await expect(description).toHaveValue(draft)

    await reservationsLink.click()
    await page.getByRole('button', { name: 'Descartar cambios' }).click()
    await expect(page).toHaveURL(/\/dashboard\/settings\/reservations$/)
  })

  test('updates the preview, saves profile changes and restores the seeded value', async ({ page }) => {
    await page.goto('/dashboard/settings/profile')
    await page.waitForLoadState('networkidle')
    const description = page.getByLabel('Descripción')
    await expect(description).not.toHaveValue('')
    const original = await description.inputValue()
    const changed = `Perfil E2E ${Date.now()}`

    try {
      await description.fill(changed)
      await expect(page.getByLabel('Vista previa del perfil público')).toContainText(changed)
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      await expect(page.getByText('Cambios guardados')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Guardar cambios' })).toBeDisabled()
      await page.reload()
      await expect(description).toHaveValue(changed)
    } finally {
      await page.goto('/dashboard/settings/profile')
      await page.waitForLoadState('networkidle')
      await description.fill(original)
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      await expect(page.getByText('Cambios guardados')).toBeVisible()
    }
  })
})

test('staff cannot enter any settings route', async ({ page }) => {
  setBusinessAuth(page)

  for (const route of ['/dashboard/settings', ...SETTINGS_ROUTES.map(({ slug }) => `/dashboard/settings/${slug}`)]) {
    await page.goto(route)
    await expect(page).toHaveURL('/dashboard')
  }
})

test.describe('settings responsive structure', () => {
  test.beforeEach(async ({ page }) => {
    setOwnerAuth(page)
  })

  for (const viewport of VIEWPORTS) {
    test(`has no overflow and preserves responsive rails at ${viewport.width}px`, async ({ page }) => {
      await page.setViewportSize(viewport)

      for (const section of SETTINGS_ROUTES) {
        await page.goto(`/dashboard/settings/${section.slug}`)
        await expect(
          page
            .getByRole('navigation', { name: 'Secciones de configuración' })
            .getByRole('link', { name: section.label, exact: true }),
        ).toHaveAttribute('aria-current', 'page')
        if (section.slug === 'payments') {
          await expect(page.getByText('Mercado Pago', { exact: true }).first()).toBeVisible()
        }
        await expectNoHorizontalOverflow(page)
        await page.screenshot({
          path: `test-results/settings-visual/${viewport.width}-${section.slug}.png`,
          fullPage: true,
        })
      }

      await page.goto('/dashboard/settings/profile')
      const localNavigation = page.getByRole('navigation', { name: 'Secciones de configuración' })
      const settingsRail = localNavigation.locator('..')
      const preview = page.getByLabel('Vista previa del perfil público')
      const railPosition = await settingsRail.evaluate((element) => getComputedStyle(element).position)
      const previewPosition = await preview.evaluate((element) => getComputedStyle(element).position)

      expect(railPosition).toBe(viewport.width >= 1024 ? 'sticky' : 'static')
      expect(previewPosition).toBe(viewport.width >= 1280 ? 'sticky' : 'static')

      const form = page.locator('form').filter({ has: page.getByLabel('Nombre del negocio') })
      const [formBox, previewBox] = await Promise.all([form.boundingBox(), preview.boundingBox()])
      expect(formBox).not.toBeNull()
      expect(previewBox).not.toBeNull()
      if (viewport.width < 1280) {
        expect(previewBox!.y).toBeGreaterThan(formBox!.y)
        expect(Math.abs(previewBox!.x - formBox!.x)).toBeLessThan(2)
      } else {
        expect(previewBox!.x).toBeGreaterThan(formBox!.x + formBox!.width)
      }

      await localNavigation.getByRole('link', { name: 'Perfil público', exact: true }).focus()
      await page.keyboard.press('Tab')
      await expect(localNavigation.getByRole('link', { name: 'Reservas', exact: true })).toBeFocused()
      await localNavigation.getByRole('link', { name: 'Pagos', exact: true }).focus()
      await page.keyboard.press('Tab')
      await expect(page.getByLabel('Nombre del negocio')).toBeFocused()

      if (viewport.width === 375) {
        await page.getByRole('button', { name: 'Guardar cambios' }).scrollIntoViewIfNeeded()
        const saveBar = page.getByRole('button', { name: 'Guardar cambios' }).locator('..').locator('..')
        const mobileNavigation = page.locator('div.fixed.inset-x-0.bottom-0').getByRole('navigation')
        const [saveBox, mobileBox] = await Promise.all([saveBar.boundingBox(), mobileNavigation.boundingBox()])
        expect(saveBox).not.toBeNull()
        expect(mobileBox).not.toBeNull()
        expect(saveBox!.y + saveBox!.height).toBeLessThanOrEqual(mobileBox!.y + 1)
      }
    })
  }
})
