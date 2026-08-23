import { expect, test, type Page } from '@playwright/test'
import { prisma } from '@/lib/db'
import { assertSafeTestDatabaseUrl } from '../helpers/test-database-safety'
import {
  cleanupDashboardFixture as cleanupFixture,
  createDashboardFixture as createFixture,
  type DashboardFixture,
} from './helpers/dashboard-tour-fixture'

assertSafeTestDatabaseUrl(process.env.DATABASE_URL)

const E2E_SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'
const INTRO_TOUR = {
  key: 'dashboard_intro',
  version: 1,
  title: 'Primeros pasos en Agendita',
} as const
const BOOKINGS_TOUR = {
  key: 'bookings',
  version: 1,
  title: 'Gestiona tus reservas',
} as const
const SETTINGS_TOUR = {
  key: 'settings',
  version: 1,
  title: 'Configura tu negocio',
} as const

const OWNER_MORE_DESTINATIONS = [
  'Servicios',
  'Profesionales',
  'Horarios',
  'Clientes',
  'Pagos',
  'Promociones',
  'Fidelización',
  'Campañas',
  'Paquetes',
  'Facturación',
  'Reseñas',
  'Configuración',
] as const

const STAFF_MORE_DESTINATIONS = OWNER_MORE_DESTINATIONS.filter((label) => (
  label !== 'Facturación' && label !== 'Configuración'
))

async function createDashboardFixture({
  role,
  withBooking = false,
}: {
  role: 'owner' | 'admin' | 'staff'
  withBooking?: boolean
}): Promise<DashboardFixture> {
  return createFixture(prisma, { role, withBooking })
}

async function cleanupDashboardFixture(fixture: DashboardFixture) {
  await cleanupFixture(prisma, fixture)
}

async function authenticate(page: Page, fixture: DashboardFixture) {
  await page.setExtraHTTPHeaders({
    'x-e2e-test-user-email': fixture.email,
    'x-e2e-auth-secret': E2E_SECRET,
  })
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => ({
    body: document.body.scrollWidth <= document.body.clientWidth,
    root: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
  }))).toEqual({ body: true, root: true })
}

async function expectActiveTourSurfaceWithinViewport(page: Page) {
  const dialog = page.getByRole('dialog')
  await expect.poll(() => dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.left >= 0
      && rect.top >= 0
      && rect.right <= window.innerWidth
      && rect.bottom <= window.innerHeight
  })).toBe(true)
}

async function readTourProgress(
  fixture: DashboardFixture,
  tour: { key: string; version: number },
) {
  const row = await prisma.userTourProgress.findUnique({
    where: {
      userId_businessId_tourKey_tourVersion: {
        userId: fixture.userId,
        businessId: fixture.businessId,
        tourKey: tour.key,
        tourVersion: tour.version,
      },
    },
  })

  return row && {
    completedAt: row.completedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
    lastStep: row.lastStep,
    offeredAt: row.offeredAt?.toISOString() ?? null,
    startedAt: row.startedAt?.toISOString() ?? null,
    status: row.status,
  }
}

async function expectTourStatus(
  fixture: DashboardFixture,
  tour: { key: string; version: number },
  status: 'available' | 'in_progress' | 'completed' | 'dismissed',
) {
  await expect.poll(async () => (await readTourProgress(fixture, tour))?.status).toBe(status)
}

async function openHelp(page: Page, viewportWidth: number) {
  if (viewportWidth < 768) {
    await page.getByRole('button', { name: 'Más opciones' }).click()
  }
  await page.getByRole('button', { name: 'Ayuda y recorridos' }).click()
  await expect(page.getByLabel('Recorridos disponibles')).toBeVisible()
}

async function startTourFromHelp(
  page: Page,
  viewportWidth: number,
  title: string,
  actionName: 'Iniciar recorrido' | 'Repetir recorrido',
) {
  await openHelp(page, viewportWidth)
  const titleElement = page.getByLabel('Recorridos disponibles').getByText(title, { exact: true })
  const item = titleElement.locator('xpath=..').locator('xpath=..')
  await item.getByRole('button', { name: actionName, exact: true }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
}

async function expectTourSurfacesClosed(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.locator('[data-tour-highlight]')).toHaveCount(0)
  await expect(page.locator('[data-tour-anchor]')).toHaveCount(0)
  await expect(page.locator('[data-slot="sheet-overlay"]')).toHaveCount(0)
}

async function finishTour(page: Page, titles: readonly string[]) {
  for (const [index, title] of titles.entries()) {
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible()
    await page.getByRole('button', {
      name: index === titles.length - 1 ? 'Terminar' : 'Siguiente',
      exact: true,
    }).click()
  }
  await expectTourSurfacesClosed(page)
}

for (const scenario of [
  { width: 375, height: 812, role: 'owner' as const },
  { width: 768, height: 900, role: 'admin' as const },
  { width: 1440, height: 900, role: 'owner' as const },
]) {
  test(`${scenario.role} completes and persists the explicit intro at ${scenario.width}px`, async ({ page }) => {
    test.setTimeout(90_000)
    const fixture = await createDashboardFixture({ role: scenario.role })

    try {
      await authenticate(page, fixture)
      await page.setViewportSize({ width: scenario.width, height: scenario.height })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.addInitScript(() => {
        const browserWindow = window as typeof window & { __tourScrollBehaviors?: string[] }
        const original = Element.prototype.scrollIntoView
        browserWindow.__tourScrollBehaviors = []
        Element.prototype.scrollIntoView = function scrollIntoView(options?: boolean | ScrollIntoViewOptions) {
          browserWindow.__tourScrollBehaviors?.push(
            typeof options === 'object' && options?.behavior ? options.behavior : 'unspecified',
          )
          return original.call(this, options)
        }
      })

      await page.goto('/dashboard')
      await expect(page.getByRole('heading', { name: /Resumen de Tours/ })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Conoce Agendita en 2 minutos' })).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expectTourStatus(fixture, INTRO_TOUR, 'available')

      if (scenario.width === 375) {
        await page.getByRole('button', { name: 'Más opciones' }).click()
        const moreNavigation = page.getByRole('navigation', { name: 'Más secciones del dashboard' })
        for (const label of OWNER_MORE_DESTINATIONS) {
          await expect(moreNavigation.getByRole('link', { name: label, exact: true })).toBeVisible()
        }
        await expect(moreNavigation.getByRole('link')).toHaveCount(OWNER_MORE_DESTINATIONS.length)
        await expect(page.getByRole('button', { name: 'Ayuda y recorridos' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('button', { name: 'Más opciones' })).toBeFocused()
      }

      await page.getByRole('button', { name: 'Iniciar recorrido', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expectActiveTourSurfaceWithinViewport(page)
      await expect.poll(() => page.evaluate(() => (
        (window as typeof window & { __tourScrollBehaviors?: string[] }).__tourScrollBehaviors ?? []
      ))).toContain('auto')

      if (scenario.width === 375) {
        for (let tab = 0; tab < 6; tab += 1) {
          await page.keyboard.press('Tab')
          await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
        }
      }
      if (scenario.width !== 768) {
        await page.keyboard.press('Escape')
        await expect(page.getByRole('heading', { name: '¿Omitir este recorrido?' })).toBeVisible()
        await page.getByRole('button', { name: 'Seguir recorrido' }).click()
      }

      await page.getByRole('button', { name: 'Terminar' }).click()
      await expectTourSurfacesClosed(page)
      await expectTourStatus(fixture, INTRO_TOUR, 'completed')
      const focusTarget = page.locator(
        scenario.width < 768
          ? '[data-tour-id="nav-mobile-more"]'
          : '[data-tour-id="nav-desktop"]',
      )
      await expect(focusTarget).toBeFocused()

      await page.reload()
      await expect(page.getByRole('heading', { name: /Resumen de Tours/ })).toBeVisible()
      if (scenario.width < 768) {
        await page.getByRole('button', { name: 'Más opciones' }).click()
      }
      await expect(page.getByRole('button', { name: 'Ayuda y recorridos' })).toBeVisible()
      await expect(page.getByRole('heading', { name: 'Conoce Agendita en 2 minutos' })).toHaveCount(0)
      if (scenario.width < 768) await page.keyboard.press('Escape')

      if (scenario.width === 1440) {
        const beforeReplay = await readTourProgress(fixture, INTRO_TOUR)
        await startTourFromHelp(page, scenario.width, INTRO_TOUR.title, 'Repetir recorrido')
        await page.getByRole('button', { name: 'Terminar' }).click()
        await expectTourSurfacesClosed(page)
        await expect.poll(() => readTourProgress(fixture, INTRO_TOUR)).toEqual(beforeReplay)
        await expect(page.locator('[data-tour-id="nav-desktop"]')).toBeFocused()
      }

      await expectNoHorizontalOverflow(page)
    } finally {
      await cleanupDashboardFixture(fixture)
    }
  })
}

test('staff mobile navigation is role-filtered and never offers tours', async ({ page }) => {
  const fixture = await createDashboardFixture({ role: 'staff' })

  try {
    await authenticate(page, fixture)
    await page.setViewportSize({ width: 375, height: 812 })
    await page.goto('/dashboard')
    await expect(page.getByRole('heading', { name: /Resumen de Tours/ })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Conoce Agendita en 2 minutos' })).toHaveCount(0)

    await page.getByRole('button', { name: 'Más opciones' }).click()
    const moreNavigation = page.getByRole('navigation', { name: 'Más secciones del dashboard' })
    for (const label of STAFF_MORE_DESTINATIONS) {
      await expect(moreNavigation.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    await expect(moreNavigation.getByRole('link')).toHaveCount(STAFF_MORE_DESTINATIONS.length)
    await expect(moreNavigation.getByRole('link', { name: 'Configuración', exact: true })).toHaveCount(0)
    await expect(moreNavigation.getByRole('link', { name: 'Facturación', exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ayuda y recorridos' })).toHaveCount(0)
    await expectNoHorizontalOverflow(page)
    await expect.poll(() => prisma.userTourProgress.count({
      where: { userId: fixture.userId, businessId: fixture.businessId },
    })).toBe(0)
  } finally {
    await cleanupDashboardFixture(fixture)
  }
})

test('an available bookings microtour can be dismissed once and only manually replayed', async ({ page }) => {
  test.setTimeout(90_000)
  const fixture = await createDashboardFixture({ role: 'owner', withBooking: true })

  try {
    await authenticate(page, fixture)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/bookings')
    await startTourFromHelp(page, 1440, BOOKINGS_TOUR.title, 'Iniciar recorrido')
    await expectTourStatus(fixture, BOOKINGS_TOUR, 'in_progress')

    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: '¿Omitir este recorrido?' })).toBeVisible()
    await page.getByRole('button', { name: 'Omitir recorrido' }).click()
    await expectTourSurfacesClosed(page)
    await expectTourStatus(fixture, BOOKINGS_TOUR, 'dismissed')

    await page.reload()
    await openHelp(page, 1440)
    const item = page.getByText(BOOKINGS_TOUR.title, { exact: true }).locator('xpath=..').locator('xpath=..')
    await expect(item.getByRole('button', { name: 'Iniciar recorrido', exact: true })).toHaveCount(0)
    await expect(item.getByRole('button', { name: 'Repetir recorrido', exact: true })).toBeVisible()
    await expectTourStatus(fixture, BOOKINGS_TOUR, 'dismissed')
    await expectNoHorizontalOverflow(page)
  } finally {
    await cleanupDashboardFixture(fixture)
  }
})

for (const scenario of [
  { width: 375, height: 812, withBooking: false, state: 'empty' },
  { width: 1440, height: 900, withBooking: true, state: 'data' },
] as const) {
  test(`bookings tour completes against the ${scenario.state} fallback at ${scenario.width}px`, async ({ page }) => {
    test.setTimeout(90_000)
    const fixture = await createDashboardFixture({ role: 'owner', withBooking: scenario.withBooking })

    try {
      await authenticate(page, fixture)
      await page.setViewportSize({ width: scenario.width, height: scenario.height })
      await page.goto('/dashboard/bookings')
      if (scenario.withBooking) {
        await expect(page.locator('[data-tour-id="bookings-status"]').first()).toBeVisible()
        await expect(page.locator('[data-tour-id="bookings-actions"]').first()).toBeVisible()
      } else {
        await expect(page.getByRole('heading', { name: 'No tienes reservas todavía' })).toBeVisible()
        await expect(page.getByRole('main').locator('[data-tour-id="bookings-empty"]')).toBeVisible()
      }

      await startTourFromHelp(page, scenario.width, BOOKINGS_TOUR.title, 'Iniciar recorrido')
      await finishTour(page, [
        'Crea una reserva',
        'Busca una reserva',
        'Revisa transferencias',
        'Consulta el estado y saldo',
        'Gestiona la reserva',
      ])
      await expectTourStatus(fixture, BOOKINGS_TOUR, 'completed')
      await expectNoHorizontalOverflow(page)
    } finally {
      await cleanupDashboardFixture(fixture)
    }
  })
}

test('a target becoming hidden fails open and leaves the bookings page interactive', async ({ page }) => {
  test.setTimeout(90_000)
  const fixture = await createDashboardFixture({ role: 'admin' })

  try {
    await authenticate(page, fixture)
    await page.setViewportSize({ width: 768, height: 900 })
    await page.goto('/dashboard/bookings')
    await startTourFromHelp(page, 768, BOOKINGS_TOUR.title, 'Iniciar recorrido')

    await page.locator('[data-tour-id="bookings-new"]').evaluate((target) => {
      target.setAttribute('hidden', '')
    })
    await expectTourSurfacesClosed(page)

    const search = page.getByPlaceholder('Buscar reserva #1234')
    await search.focus()
    await expect(search).toBeFocused()
    await search.fill('#1234')
    await expect(search).toHaveValue('#1234')
    await expectNoHorizontalOverflow(page)
  } finally {
    await cleanupDashboardFixture(fixture)
  }
})

test('a dirty Settings form pauses the tour, preserves the edit and resumes safely', async ({ page }) => {
  test.setTimeout(90_000)
  const fixture = await createDashboardFixture({ role: 'owner' })

  try {
    await authenticate(page, fixture)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/dashboard/settings/profile')
    const description = page.getByLabel('Descripción')
    const original = await description.inputValue()
    const draft = `Borrador recorrido ${Date.now()}`

    await startTourFromHelp(page, 1440, SETTINGS_TOUR.title, 'Iniciar recorrido')
    await description.fill(draft)
    await expect(page.getByRole('status')).toContainText('Termina o descarta tus cambios para continuar')
    await expect(page.getByRole('button', { name: 'Siguiente' })).toBeDisabled()
    await expect(description).toHaveValue(draft)

    await page.keyboard.press('Escape')
    await expect(page.getByRole('heading', { name: '¿Omitir este recorrido?' })).toBeVisible()
    await page.getByRole('button', { name: 'Seguir recorrido' }).click()
    await expect(description).toHaveValue(draft)
    await expect(page.getByRole('button', { name: 'Siguiente' })).toBeDisabled()

    await description.fill(original)
    await expect(page.getByRole('button', { name: 'Siguiente' })).toBeEnabled()
    await finishTour(page, [
      'Ordena la configuración',
      'Revisa tu perfil público',
      'Guarda los cambios',
      'Define políticas y avisos',
    ])
    await expectTourStatus(fixture, SETTINGS_TOUR, 'completed')
    await expectNoHorizontalOverflow(page)
  } finally {
    await cleanupDashboardFixture(fixture)
  }
})
