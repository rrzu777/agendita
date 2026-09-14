import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { prisma } from '@/lib/db'
import { assertSafeTestDatabaseUrl } from '../helpers/test-database-safety'

assertSafeTestDatabaseUrl(process.env.DATABASE_URL)

const LONG_DESCRIPTION = 'Corte personalizado con diagnóstico, lavado, terminación y recomendaciones para cuidar tu cabello en casa, sin perder los detalles del servicio.'
const SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    root: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    body: document.body.scrollWidth <= document.body.clientWidth,
  }))).toEqual({ root: true, body: true })
}

async function expectTouchTarget(control: Locator) {
  // Dialog enter motion scales its children briefly; verify settled geometry,
  // without tolerating a permanently undersized control.
  await expect.poll(async () => {
    const box = await control.boundingBox()
    return Boolean(box && box.width >= 44 && box.height >= 44)
  }).toBe(true)
}

test.describe('catalogue and reusable business colors', () => {
  test.describe.configure({ mode: 'default' })
  let businessId: string
  let slug: string
  const fixtures: { businessId: string; userId: string; slug: string; email: string }[] = []

  async function createTenant() {
    const fixtureSlug = `color-e2e-${randomUUID().slice(0, 12)}`
    const email = `${fixtureSlug}@agendita.test`
    const fixture = await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email, name: 'Dueña de prueba' } })
      const business = await tx.business.create({
        data: {
          name: 'Barbería de prueba', slug: fixtureSlug, subdomain: fixtureSlug, ownerUserId: user.id,
          city: 'Santiago', brandColor: '#4F5D54', onboardingCompletedAt: new Date(),
          users: { create: { userId: user.id, role: 'owner' } },
        },
      })
      return { userId: user.id, businessId: business.id, slug: fixtureSlug, email }
    })
    fixtures.push(fixture)
    return fixture
  }

  test.beforeEach(async ({ page }) => {
    const fixture = await createTenant()
    businessId = fixture.businessId
    slug = fixture.slug
    await page.setExtraHTTPHeaders({
      'x-e2e-test-user-email': fixture.email,
      'x-e2e-auth-secret': SECRET,
    })
  })

  test.afterEach(async () => {
    for (const fixture of fixtures.splice(0).reverse()) {
      await prisma.business.delete({ where: { id: fixture.businessId } })
      await prisma.user.delete({ where: { id: fixture.userId } })
    }
  })

  test('invalid HEX remains visible and cannot create a service with the previous color', async ({ page }) => {
    await page.goto('/dashboard/services')
    await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Nuevo servicio' })
    await dialog.getByLabel(/^Nombre/).fill('Servicio con color incompleto')
    await dialog.getByLabel(/^Precio/).fill('15000')
    await dialog.getByLabel(/^Abono/).fill('0')
    const hex = dialog.getByLabel('Código hexadecimal', { exact: true })
    await hex.fill('#12')
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialog).toBeVisible()
    await expect(hex).toHaveValue('#12')
    await expect(hex).toHaveAttribute('aria-invalid', 'true')
    await expect(hex).toBeFocused()
    expect(await prisma.service.count({ where: { businessId } })).toBe(0)
    await hex.fill('#ABCDEF')
    await hex.blur()
    await expect(hex).not.toHaveAttribute('aria-invalid', 'true')
    expect(await prisma.service.count({ where: { businessId } })).toBe(0)
  })

  for (const width of [320, 390, 834, 1440]) {
  test(`native color and HEX stay synchronized with a touch-sized picker at ${width}px`, async ({ page }) => {
    await prisma.businessColorFavorite.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        businessId,
        color: `#${(0x102030 + index * 0x10101).toString(16).toUpperCase()}`,
      })),
    })
    await page.setViewportSize({ width, height: 1000 })
    await page.goto('/dashboard/services')
    await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Nuevo servicio' })
    const nativePicker = dialog.locator('input[type="color"]')
    await expect(nativePicker).toHaveCount(1)
    await expectTouchTarget(nativePicker)
    const hex = dialog.getByLabel('Código hexadecimal', { exact: true })
    await hex.fill('#123abc')
    await expect(nativePicker).toHaveValue('#123abc')
    await nativePicker.fill('#a1b2c3')
    await expect(hex).toHaveValue('#A1B2C3')
    await nativePicker.focus()
    await page.keyboard.press('Tab')
    await expect(hex).toBeFocused()
    await expectNoOverflow(page)
    const picker = dialog.getByRole('group', { name: 'Color del servicio', exact: true })
    const favorites = picker.getByRole('button', { name: /^Seleccionar favorito/ })
    await expect(favorites).toHaveCount(12)
    for (const favorite of await favorites.all()) await expectTouchTarget(favorite)
    await picker.screenshot({ path: `output/playwright/color-picker-${width}.png` })
  })
  }

  test('favorites survive navigation, remain tenant-scoped and never autosave the form draft', async ({ page, browser }) => {
    test.setTimeout(90_000)
    await page.goto('/dashboard/services')
    await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Nuevo servicio' })
    await dialog.getByLabel(/^Nombre/).fill('Borrador sin guardar')
    await dialog.getByLabel('Código hexadecimal', { exact: true }).fill('#123abc')
    const saveFavorite = dialog.getByRole('button', { name: 'Guardar #123ABC en favoritos', exact: true })
    await expectTouchTarget(saveFavorite)
    await saveFavorite.click()
    await expect(dialog.getByRole('button', { name: 'Seleccionar favorito #123ABC', exact: true })).toBeVisible()
    await expect(dialog.getByLabel(/^Nombre/)).toHaveValue('Borrador sin guardar')
    expect(await prisma.service.count({ where: { businessId } })).toBe(0)

    await page.goto('/dashboard/settings/profile')
    const favorite = page.getByRole('button', { name: 'Seleccionar favorito #123ABC', exact: true })
    await expect(favorite).toBeVisible()
    await favorite.click()
    await expect(page.getByLabel('Código hexadecimal', { exact: true })).toHaveValue('#123ABC')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).brandColor).toBe('#4F5D54')
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await expect.poll(async () => (await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).brandColor).toBe('#123ABC')
    await page.reload()
    await expect(page.getByLabel('Código hexadecimal', { exact: true })).toHaveValue('#123ABC')
    await expect(favorite).toBeVisible()
    await expect(page.getByLabel('Nombre del negocio')).toBeEnabled()
    await page.screenshot({ path: 'output/playwright/color-picker-profile.png', fullPage: true })

    const other = await createTenant()
    const otherContext = await browser.newContext({
      extraHTTPHeaders: { 'x-e2e-test-user-email': other.email, 'x-e2e-auth-secret': SECRET },
    })
    try {
      const otherPage = await otherContext.newPage()
      await otherPage.goto('http://localhost:3000/dashboard/settings/profile')
      await expect(otherPage.getByLabel('Código hexadecimal', { exact: true })).toHaveValue('#4F5D54')
      await expect(otherPage.getByRole('button', { name: 'Seleccionar favorito #123ABC', exact: true })).toHaveCount(0)
    } finally {
      await otherContext.close()
    }

    const remove = page.getByRole('button', { name: 'Quitar favorito #123ABC', exact: true })
    await expectTouchTarget(remove)
    await remove.click()
    await expect(favorite).toHaveCount(0)
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).brandColor).toBe('#123ABC')
    await page.goto('/dashboard/services')
    await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Seleccionar favorito #123ABC', exact: true })).toHaveCount(0)
  })

  test('failed favorite save preserves the draft and succeeds on explicit retry', async ({ page }) => {
    await page.goto('/dashboard/services')
    await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Nuevo servicio' })
    await dialog.getByLabel(/^Nombre/).fill('Mi corte pendiente')
    await dialog.getByLabel('Código hexadecimal', { exact: true }).fill('#A1B2C3')
    let blocked = false
    await page.route('**/dashboard/services', async route => {
      if (!blocked && route.request().method() === 'POST') {
        blocked = true
        await route.abort('failed')
      } else await route.continue()
    })
    await dialog.getByRole('button', { name: 'Guardar #A1B2C3 en favoritos', exact: true }).click()
    const retry = dialog.getByRole('button', { name: 'Reintentar guardar favorito', exact: true })
    await expect(retry).toBeVisible()
    await expect(dialog.getByLabel(/^Nombre/)).toHaveValue('Mi corte pendiente')
    await expect(dialog.getByLabel('Código hexadecimal', { exact: true })).toHaveValue('#A1B2C3')
    await expect(dialog.getByRole('button', { name: 'Seleccionar favorito #A1B2C3', exact: true })).toHaveCount(0)
    expect(await prisma.service.count({ where: { businessId } })).toBe(0)
    await retry.click()
    await expect(dialog.getByRole('button', { name: 'Seleccionar favorito #A1B2C3', exact: true })).toBeVisible()
    await expect(dialog.getByLabel(/^Nombre/)).toHaveValue('Mi corte pendiente')
  })

  test('failed favorite removal has an accurate retry and preserves the brand draft', async ({ page }) => {
    await prisma.businessColorFavorite.create({ data: { businessId, color: '#A1B2C3' } })
    await page.goto('/dashboard/settings/profile')
    await page.getByLabel('Nombre del negocio').fill('Perfil pendiente')
    let blocked = false
    await page.route('**/dashboard/settings/profile', async route => {
      if (!blocked && route.request().method() === 'POST') {
        blocked = true
        await route.abort('failed')
      } else await route.continue()
    })
    await page.getByRole('button', { name: 'Quitar favorito #A1B2C3', exact: true }).click()
    const retry = page.getByRole('button', { name: 'Reintentar quitar favorito', exact: true })
    await expect(retry).toBeVisible()
    await expect(page.getByLabel('Nombre del negocio')).toHaveValue('Perfil pendiente')
    expect(await prisma.businessColorFavorite.count({ where: { businessId } })).toBe(1)
    await retry.click()
    await expect(page.getByRole('button', { name: 'Seleccionar favorito #A1B2C3', exact: true })).toHaveCount(0)
    await expect(page.getByLabel('Nombre del negocio')).toHaveValue('Perfil pendiente')
    const stored = await prisma.business.findUniqueOrThrow({ where: { id: businessId } })
    expect(stored.name).toBe('Barbería de prueba')
    expect(stored.brandColor).toBe('#4F5D54')
  })

  for (const operation of ['add', 'remove'] as const) {
    test(`a real staff membership cannot ${operation} favorites through stale owner controls`, async ({ page }) => {
      if (operation === 'remove') {
        await prisma.businessColorFavorite.create({ data: { businessId, color: '#A1B2C3' } })
      }
      await page.goto('/dashboard/services')
      await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Nuevo servicio' })
      await dialog.getByLabel('Código hexadecimal', { exact: true }).fill('#A1B2C3')
      const control = dialog.getByRole('button', {
        name: operation === 'add' ? 'Guardar #A1B2C3 en favoritos' : 'Quitar favorito #A1B2C3',
        exact: true,
      })
      await expect(control).toBeEnabled()
      // Keep an already-rendered owner client, but change authoritative membership
      // before the next request. This exercises the real server guard, not UI hiding.
      const membership = await prisma.businessUser.findFirstOrThrow({ where: { businessId } })
      await prisma.businessUser.update({ where: { id: membership.id }, data: { role: 'staff' } })
      await control.click()
      await expect(dialog.getByRole('alert')).toContainText('No tienes permisos para realizar esta acción')
      expect(await prisma.businessColorFavorite.count({ where: { businessId } })).toBe(operation === 'remove' ? 1 : 0)
      expect(await prisma.service.count({ where: { businessId } })).toBe(0)
    })
  }

  test('brand color can be cleared and stays automatic after saving and reloading', async ({ page }) => {
    await page.goto('/dashboard/settings/profile')
    const reset = page.getByRole('button', { name: 'Restablecer color de marca', exact: true })
    await reset.click()
    await expect(page.getByLabel('Código hexadecimal', { exact: true })).toHaveValue('')
    expect((await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).brandColor).toBe('#4F5D54')
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await expect.poll(async () => (await prisma.business.findUniqueOrThrow({ where: { id: businessId } })).brandColor).toBeNull()
    await page.reload()
    await expect(page.getByLabel('Código hexadecimal', { exact: true })).toHaveValue('')
  })

  test('invalid brand color focuses the HEX field without losing the profile draft', async ({ page }) => {
    await page.goto('/dashboard/settings/profile')
    await page.getByLabel('Nombre del negocio').fill('Nombre aún sin guardar')
    const hex = page.getByLabel('Código hexadecimal', { exact: true })
    await hex.fill('#12')
    await page.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
    await expect(hex).toHaveAttribute('aria-invalid', 'true')
    await expect(hex).toBeFocused()
    await expect(page.getByLabel('Nombre del negocio')).toHaveValue('Nombre aún sin guardar')
    const stored = await prisma.business.findUniqueOrThrow({ where: { id: businessId } })
    expect(stored.name).toBe('Barbería de prueba')
    expect(stored.brandColor).toBe('#4F5D54')
  })

  test('profile controls cannot accept edits before hydration initializes their values', async ({ browser }) => {
    const fixture = fixtures.find(item => item.businessId === businessId)!
    const context = await browser.newContext({
      javaScriptEnabled: false,
      extraHTTPHeaders: { 'x-e2e-test-user-email': fixture.email, 'x-e2e-auth-secret': SECRET },
    })
    try {
      const unhydratedPage = await context.newPage()
      await unhydratedPage.goto('http://localhost:3000/dashboard/settings/profile')
      await expect(unhydratedPage.getByLabel('Nombre del negocio')).toBeDisabled()
      await expect(unhydratedPage.getByLabel('Código hexadecimal', { exact: true })).toBeDisabled()
      // Without JS, streamed server sections may remain hidden; inspect the
      // actual submit element, not a visibility-filtered accessibility locator.
      await expect(unhydratedPage.locator('[data-tour-id="settings-save"] button[type="submit"]')).toBeDisabled()
    } finally {
      await context.close()
    }
  })

  for (const field of ['price', 'deposit'] as const) {
  test(`app-owned validation never silently truncates a fractional service ${field}`, async ({ page }) => {
    await page.goto('/dashboard/services')
    await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Nuevo servicio' })
    await dialog.getByLabel(/^Nombre/).fill('Precio por corregir')
    const price = dialog.getByLabel(/^Precio/)
    const deposit = dialog.getByLabel(/^Abono/)
    await price.fill(field === 'price' ? '15000.5' : '15000')
    await deposit.fill(field === 'deposit' ? '1000.5' : '0')
    const target = field === 'price' ? price : deposit
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(target).toHaveAttribute('aria-invalid', 'true')
    await expect(target).toBeFocused()
    await expect(target).toHaveValue(field === 'price' ? '15000.5' : '1000.5')
    await expect(dialog.getByRole('alert')).toHaveText(`Ingresa un ${field === 'price' ? 'precio' : 'abono'} en pesos, sin decimales.`)
    expect(await prisma.service.count({ where: { businessId } })).toBe(0)
  })
  }

  for (const field of ['price', 'deposit'] as const) {
    for (const raw of ['', '1e3']) {
      test(`whole money validation rejects ${raw || 'empty'} in ${field} without changing the draft`, async ({ page }) => {
        await page.goto('/dashboard/services')
        await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()
        const dialog = page.getByRole('dialog', { name: 'Nuevo servicio' })
        await dialog.getByLabel(/^Nombre/).fill('Monto pendiente')
        const price = dialog.getByLabel(/^Precio/)
        const deposit = dialog.getByLabel(/^Abono/)
        await price.fill(field === 'price' ? raw : '15000')
        await deposit.fill(field === 'deposit' ? raw : '0')
        const target = field === 'price' ? price : deposit
        await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
        await expect(target).toBeFocused()
        await expect(target).toHaveAttribute('aria-invalid', 'true')
        await expect(target).toHaveValue(raw)
        await expect(dialog.getByRole('alert')).toHaveText(`Ingresa un ${field === 'price' ? 'precio' : 'abono'} en pesos, sin decimales.`)
        expect(await prisma.service.count({ where: { businessId } })).toBe(0)
      })
    }
  }

  test('zero price and zero deposit remain valid whole amounts', async ({ page }) => {
    await page.goto('/dashboard/services')
    await page.getByRole('button', { name: 'Nuevo servicio', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Nuevo servicio' })
    await dialog.getByLabel(/^Nombre/).fill('Evaluación gratuita')
    await dialog.getByLabel(/^Precio/).fill('0')
    await dialog.getByLabel(/^Abono/).fill('0')
    await dialog.getByRole('button', { name: 'Guardar', exact: true }).click()
    await expect(dialog).toBeHidden()
    const service = await prisma.service.findFirstOrThrow({ where: { businessId } })
    expect(service.price).toBe(0)
    expect(service.depositAmount).toBe(0)
  })

  const catalogueCases = [
    ...[320, 390, 834, 1440].flatMap(width => (['soft', 'balanced', 'contrast'] as const).map(style => ({ width, style, count: 3 }))),
    { width: 390, style: 'balanced' as const, count: 1 },
    { width: 1440, style: 'contrast' as const, count: 14 },
  ]
  for (const { width, style, count } of catalogueCases) {
    test(`service CTAs remain equal and content readable at ${width}px / ${style} / ${count} services`, async ({ page }) => {
      await prisma.business.update({ where: { id: businessId }, data: { visualStyle: style } })
      const catalogue = [
        { businessId, name: 'Corte', description: null, price: 15000, depositAmount: 0, durationMinutes: 30, pastelColor: '#FFB3BA', sortOrder: 0 },
        { businessId, name: 'Corte, barba y asesoría personalizada para un cambio de estilo completo', description: LONG_DESCRIPTION, price: 9999999, depositAmount: 3500000, durationMinutes: 480, pastelColor: '#A3D8FF', sortOrder: 1 },
        { businessId, name: 'Perfilado de barba', description: 'Incluye terminación.', price: 8000, depositAmount: 4000, durationMinutes: 20, pastelColor: '#B3F0C8', sortOrder: 2 },
      ]
      const data = Array.from({ length: count }, (_, index) => ({
        ...catalogue[index % catalogue.length],
        name: index < 3 ? catalogue[index % catalogue.length].name : `Servicio ${index + 1}: ${catalogue[index % catalogue.length].name}`,
        sortOrder: index,
      }))
      await prisma.service.createMany({ data })
      await page.setViewportSize({ width, height: 1000 })
      await page.goto(`/b/${slug}`)
      const services = page.getByRole('region', { name: 'Servicios', exact: true })
      const cards = services.getByRole('article')
      await expect(cards).toHaveCount(count)
      if (count > 1) {
        await expect(cards.nth(1)).toContainText(LONG_DESCRIPTION)
        await expect(cards.nth(1)).toContainText('$9.999.999')
        await expect(cards.nth(1)).toContainText('$3.500.000')
      }
      const dimensions: { width: number; height: number }[] = []
      for (const card of await cards.all()) {
        const cta = card.getByRole('link', { name: 'Reservar este servicio', exact: true })
        await expectTouchTarget(cta)
        const box = (await cta.boundingBox())!
        const proseColumn = (await card.locator(':scope > div').first().boundingBox())!
        if (box.x > proseColumn.x + 32) {
          // A side-by-side price/action rail must not squeeze the flexible prose
          // into a narrower column; at tablet width the card should reflow.
          expect(proseColumn.width).toBeGreaterThanOrEqual(box.width)
        }
        dimensions.push({ width: box.width, height: box.height })
        await expect(cta).toHaveAttribute('href', new RegExp(`/book/${slug}\\?service=`))
        expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        const description = card.locator('p').first()
        if (await description.count()) {
          expect(await description.evaluate(element => element.scrollHeight <= element.clientHeight)).toBe(true)
        }
      }
      expect(Math.max(...dimensions.map(d => d.width)) - Math.min(...dimensions.map(d => d.width))).toBeLessThanOrEqual(1)
      expect(Math.max(...dimensions.map(d => d.height)) - Math.min(...dimensions.map(d => d.height))).toBeLessThanOrEqual(1)
      await expectNoOverflow(page)
      await page.screenshot({ path: `output/playwright/catalogue-colors-${width}-${style}-${count}.png`, fullPage: true })
    })
  }
})
