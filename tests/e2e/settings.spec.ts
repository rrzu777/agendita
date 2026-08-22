import { expect, test, type Page } from '@playwright/test'
import { prisma } from '@/lib/db'
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

test.describe.configure({ mode: 'serial' })

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth <= document.body.clientWidth,
    root: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }))).toEqual({ body: true, root: true })
}

async function expectFormControlGeometry(
  page: Page,
  label: string,
  viewportWidth: number,
  { fullWidth = false }: { fullWidth?: boolean } = {},
) {
  const control = page.getByLabel(label, { exact: true })
  const box = await control.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.height).toBeGreaterThanOrEqual(viewportWidth < 768 ? 44 : 40)

  if (fullWidth) {
    const fieldBox = await control.locator('xpath=ancestor::*[@data-slot="form-field"][1]').boundingBox()
    expect(fieldBox).not.toBeNull()
    expect(box!.width / fieldBox!.width).toBeGreaterThanOrEqual(0.9)
  }
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

  test('warns before discarding and restores a draft through real Back/Forward navigation', async ({ page }) => {
    let nativeDialogs = 0
    page.on('dialog', async (dialog) => {
      nativeDialogs += 1
      await dialog.dismiss()
    })
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
    expect(nativeDialogs).toBe(0)

    await reservationsLink.click()
    await page.getByRole('button', { name: 'Descartar cambios' }).click()
    await expect(page).toHaveURL(/\/dashboard\/settings\/reservations$/)
  })

  test('keeps server C and reports conflict for draft B after real Back/Forward navigation', async ({ page }) => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: 'mimosnails' },
      select: { id: true, bio: true },
    })
    const original = business.bio ?? ''
    const draftB = `Borrador B ${Date.now()}`
    const serverC = `Servidor C ${Date.now()}`
    let nativeDialogs = 0
    page.on('dialog', async (dialog) => {
      nativeDialogs += 1
      await dialog.dismiss()
    })

    try {
      await page.goto('/dashboard')
      await page.getByRole('link', { name: 'Configuración', exact: true }).click()
      await expect(page).toHaveURL(/\/dashboard\/settings\/profile$/)
      const description = page.getByLabel('Descripción')
      await expect(description).toHaveValue(original)
      await description.fill(draftB)
      await expect.poll(() => page.evaluate(() => Object.values(sessionStorage).join('\n'))).toContain(draftB)

      await page.goBack()
      await expect(page).toHaveURL('/dashboard')
      await prisma.business.update({ where: { id: business.id }, data: { bio: serverC } })

      await page.goForward()
      await expect(page).toHaveURL(/\/dashboard\/settings\/profile$/)
      await expect(page.getByText('Hay un borrador local de una versión anterior')).toBeVisible()
      await expect(description).toHaveValue(serverC)
      await expect.poll(() => page.evaluate(() => Object.values(sessionStorage).join('\n'))).toContain(draftB)
      expect(nativeDialogs).toBe(0)
    } finally {
      await prisma.business.update({ where: { id: business.id }, data: { bio: business.bio } })
      await page.evaluate((key) => sessionStorage.removeItem(key), `${business.id}:profile`).catch(() => {})
    }
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

test.describe('settings mutable section journeys', () => {
  test.beforeEach(async ({ page }) => {
    setOwnerAuth(page)
  })

  test('saves, reloads and restores reservation settings', async ({ page }) => {
    await page.goto('/dashboard/settings/reservations')
    await page.waitForLoadState('networkidle')
    const holdHours = page.getByLabel('Reserva sin pago online (horas)')
    const original = await holdHours.inputValue()
    const changed = original === '25' ? '26' : '25'

    try {
      await holdHours.fill(changed)
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      await expect(page.getByText('Cambios guardados')).toBeVisible()
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(holdHours).toHaveValue(changed)
    } finally {
      await page.goto('/dashboard/settings/reservations')
      await page.waitForLoadState('networkidle')
      await holdHours.fill(original)
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      await expect(page.getByText('Cambios guardados')).toBeVisible()
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(holdHours).toHaveValue(original)
    }
  })

  test('saves, reloads and restores policy settings', async ({ page }) => {
    await page.goto('/dashboard/settings/policies')
    await page.waitForLoadState('networkidle')
    const bookingPolicy = page.getByLabel('Política de reserva')
    const original = await bookingPolicy.inputValue()
    const changed = `Política E2E ${Date.now()}`

    try {
      await bookingPolicy.fill(changed)
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      await expect(page.getByText('Cambios guardados')).toBeVisible()
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(bookingPolicy).toHaveValue(changed)
    } finally {
      await page.goto('/dashboard/settings/policies')
      await page.waitForLoadState('networkidle')
      await bookingPolicy.fill(original)
      await page.getByRole('button', { name: 'Guardar cambios' }).click()
      await expect(page.getByText('Cambios guardados')).toBeVisible()
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(bookingPolicy).toHaveValue(original)
    }
  })

  test('saves, reloads and restores bank transfer settings', async ({ page }) => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: 'mimosnails' },
      select: { id: true },
    })
    const existing = await prisma.bankTransferAccount.findUnique({ where: { businessId: business.id } })
    expect(existing).toBeNull()
    const originalInstructions = 'Incluye tu nombre en el comentario'
    await prisma.bankTransferAccount.create({
      data: {
        businessId: business.id,
        accountHolder: 'Mimos Nails E2E',
        rut: '12.345.678-5',
        bankName: 'Banco E2E',
        accountType: 'Cuenta corriente',
        accountNumber: '123456789',
        email: 'owner@mimosnails.com',
        instructions: originalInstructions,
        holdHours: 24,
        verifyHours: 48,
        isEnabled: true,
      },
    })

    try {
      await page.goto('/dashboard/settings/payments')
      await page.waitForLoadState('networkidle')
      const instructions = page.getByLabel(/Instrucciones para/)
      const bankName = page.getByLabel('Banco')
      const changed = `Transferencia E2E ${Date.now()}`
      await instructions.fill(changed)
      await bankName.fill('  Banco E2E normalizado  ')
      await page.getByRole('button', { name: 'Guardar datos bancarios' }).click()
      await expect(page.getByText('Datos guardados.')).toBeVisible()
      await expect(bankName).toHaveValue('Banco E2E normalizado')
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(instructions).toHaveValue(changed)
      await expect(bankName).toHaveValue('Banco E2E normalizado')

      await instructions.fill(originalInstructions)
      await bankName.fill('Banco E2E')
      await page.getByRole('button', { name: 'Guardar datos bancarios' }).click()
      await expect(page.getByText('Datos guardados.')).toBeVisible()
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(instructions).toHaveValue(originalInstructions)
    } finally {
      await prisma.bankTransferAccount.deleteMany({ where: { businessId: business.id } })
    }
  })

  test('connects and disconnects Mercado Pago through the E2E mock only', async ({ page }) => {
    const business = await prisma.business.findUniqueOrThrow({
      where: { slug: 'mimosnails' },
      select: { id: true },
    })
    const environment = 'sandbox' as const
    const existing = await prisma.paymentAccount.findUnique({
      where: {
        businessId_provider_environment: {
          businessId: business.id,
          provider: 'mercado_pago',
          environment,
        },
      },
    })
    expect(existing).toBeNull()

    try {
      await page.goto('/dashboard/settings/payments')
      await expect(page.getByText('Mercado Pago no configurado')).toBeVisible()
      await page.getByRole('button', { name: 'Conectar Mercado Pago' }).click()
      await expect(page).toHaveURL(/\/dashboard\/settings\/payments\?success=connected$/)
      await expect(page.getByText('Cuenta MP conectada')).toBeVisible()
      // La conexión navega mediante un form server-side, pero la desconexión usa
      // un handler cliente. Esperar la hidratación evita que el click temprano
      // sea inerte en runners lentos.
      await page.waitForLoadState('networkidle')

      await page.getByRole('button', { name: 'Desconectar Mercado Pago' }).click()
      await expect(page.getByText('Cuenta desconectada')).toBeVisible()
      await page.reload()
      await expect(page.getByText('Cuenta desconectada')).toBeVisible()
    } finally {
      await prisma.paymentAccount.deleteMany({
        where: { businessId: business.id, provider: 'mercado_pago', environment },
      })
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

        if (section.slug === 'profile') {
          await expectFormControlGeometry(page, 'Nombre del negocio', viewport.width)
        }
        if (section.slug === 'reservations') {
          await expectFormControlGeometry(page, 'Zona horaria', viewport.width, { fullWidth: true })
        }
        if (section.slug === 'payments') {
          await expectFormControlGeometry(page, 'Titular', viewport.width)
        }

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

      if (viewport.width >= 1024) {
        const saveButton = page.getByRole('button', { name: 'Guardar cambios' })
        const saveSurface = saveButton.locator('..')
        const saveDock = saveSurface.locator('..')
        const city = page.getByLabel('Ciudad')
        await city.scrollIntoViewIfNeeded()
        await expect(saveDock).toHaveCSS('position', 'static')

        await city.fill(`${await city.inputValue()} QA`)
        await expect(saveButton).toBeInViewport()
        await expect(saveDock).toHaveCSS('position', 'sticky')
        const metrics = await saveSurface.evaluate((element) => {
          const box = element.getBoundingClientRect()
          return {
            bottomGap: window.innerHeight - box.bottom,
            borderRadius: Number.parseFloat(getComputedStyle(element).borderTopLeftRadius),
          }
        })

        expect(metrics.bottomGap).toBeGreaterThanOrEqual(20)
        expect(metrics.borderRadius).toBeGreaterThanOrEqual(12)
      }
    })
  }
})
