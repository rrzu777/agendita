import { randomUUID } from 'node:crypto'
import { expect, test, type Locator, type Page } from '@playwright/test'
import { addDays } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'
import type { BookingStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { assertSafeTestDatabaseUrl } from '../helpers/test-database-safety'

assertSafeTestDatabaseUrl(process.env.DATABASE_URL)

const TZ = 'America/Santiago'
const SECRET = process.env.PLAYWRIGHT_E2E_AUTH_SECRET || 'e2e-secret-local'
const HOUR_HEIGHT = 56

async function expectNoOverflow(page: Page) {
  await expect.poll(() => page.evaluate(() => (
    document.documentElement.scrollWidth <= document.documentElement.clientWidth
    && document.body.scrollWidth <= document.body.clientWidth
  ))).toBe(true)
}

async function touchTarget(control: Locator) {
  await expect.poll(async () => {
    const box = await control.boundingBox()
    return box ? Math.min(box.width, box.height) : 0
  }).toBeGreaterThanOrEqual(44)
}

async function expectDayFillsTimeline(page: Page, dayKey: string) {
  await expect.poll(() => page.locator(`[data-calendar-day="${dayKey}"]`).evaluate(column => {
    const viewport = column.closest('.overflow-x-auto')
    if (!viewport) throw new Error('Missing calendar scroll region')
    return Math.abs(viewport.getBoundingClientRect().right - column.getBoundingClientRect().right)
  })).toBeLessThanOrEqual(1)
}

async function measureTogether(page: Page, ...locators: Locator[]) {
  for (const locator of locators) await expect(locator).toBeVisible()
  const handles = await Promise.all(locators.map(locator => locator.elementHandle()))
  try {
    // The tablet sidebar settles from its SSR width after hydration. Read all
    // event geometry in one browser frame, not across different animation frames.
    return await page.evaluate(elements => elements.map(element => {
      if (!element) throw new Error('Missing painted calendar event')
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }), handles)
  } finally {
    await Promise.all(handles.map(handle => handle?.dispose()))
  }
}

test.describe('reservation actions and truthful calendar intervals', () => {
  let fixture: { businessId: string; userId: string; serviceId: string; professionals: string[] }
  let createdTenant: { businessId: string; userId: string } | undefined
  let day: string
  let sequence: number
  let browserErrors: string[]

  const localTime = (time: string) => fromZonedTime(`${day}T${time}:00`, TZ)

  async function booking(name: string, start: string, end: string, options: {
    status?: BookingStatus; professional?: number; unpaid?: boolean
    overrides?: Partial<Prisma.BookingUncheckedCreateInput>
  } = {}) {
    sequence += 1
    const customer = await prisma.customer.create({ data: {
      businessId: fixture.businessId, name,
      phone: `+569${String(sequence).padStart(8, '0')}`,
      email: `customer-${sequence}@agendita.test`,
    } })
    return prisma.booking.create({ data: {
      businessId: fixture.businessId, serviceId: fixture.serviceId, customerId: customer.id,
      professionalId: fixture.professionals[options.professional ?? 0],
      bookingNumber: sequence, startDateTime: localTime(start), endDateTime: localTime(end),
      status: options.status ?? 'confirmed', totalPrice: 10000, finalAmount: 10000,
      depositRequired: options.unpaid ? 3000 : 0,
      depositPaid: options.unpaid ? 0 : 10000,
      remainingBalance: options.unpaid ? 10000 : 0,
      paymentStatus: options.unpaid ? 'unpaid' : 'fully_paid',
      ...options.overrides,
    } })
  }

  async function calendar(page: Page, view = 'day', extra = '') {
    await page.goto(`/dashboard/calendar?view=${view}&date=${day}${extra}`)
    await expect(page.getByRole('navigation', { name: 'Vista del calendario' })).toBeVisible()
  }

  function paintedBooking(page: Page, id: string, name: string) {
    // The legacy absolute button permits a meaningful geometry RED before the
    // new noninteractive short band exists. Both selectors identify painted
    // timeline geometry, never the equivalent detail-list button.
    return page.locator(`.absolute[data-booking-id="${id}"], button.absolute[aria-label*="${name}"]`).filter({ visible: true })
  }

  test.beforeEach(async ({ page }) => {
    browserErrors = []
    createdTenant = undefined
    page.on('pageerror', error => browserErrors.push(error.message))
    day = formatInTimeZone(addDays(new Date(), 14), TZ, 'yyyy-MM-dd')
    sequence = 0
    const slug = `calendar-e2e-${randomUUID().slice(0, 12)}`
    const email = `${slug}@agendita.test`
    fixture = await prisma.$transaction(async tx => {
      const user = await tx.user.create({ data: { email, name: 'Dueña calendario de prueba' } })
      const business = await tx.business.create({ data: {
        name: 'Calendario de prueba', slug, subdomain: slug, ownerUserId: user.id,
        city: 'Santiago', timezone: TZ, onboardingCompletedAt: new Date(),
        users: { create: { userId: user.id, role: 'owner' } },
      } })
      const service = await tx.service.create({ data: {
        businessId: business.id, name: 'Corte y terminación de prueba', durationMinutes: 30,
        price: 10000, depositAmount: 0, pastelColor: '#A8BFA8',
      } })
      const professionals = await Promise.all(['Ana estilista', 'Bea estilista'].map(name => tx.professional.create({
        data: { businessId: business.id, name, services: { connect: { id: service.id } } },
      })))
      return { businessId: business.id, userId: user.id, serviceId: service.id, professionals: professionals.map(p => p.id) }
    })
    createdTenant = fixture
    await page.setExtraHTTPHeaders({ 'x-e2e-test-user-email': email, 'x-e2e-auth-secret': SECRET })
  })

  test.afterEach(async () => {
    if (createdTenant) {
      await prisma.business.delete({ where: { id: createdTenant.businessId } })
      await prisma.user.delete({ where: { id: createdTenant.userId } })
    }
    expect(browserErrors, 'Uncaught browser errors').toEqual([])
  })

  for (const width of [834, 1440]) {
    test(`adjacent appointments retain their actual duration and one lane at ${width}px`, async ({ page }) => {
      const first = await booking('Ana corta', '11:30', '11:50')
      const second = await booking('Bea larga', '12:00', '13:30')
      await page.setViewportSize({ width, height: 1050 })
      await calendar(page)
      const short = paintedBooking(page, first.id, 'Ana corta')
      const long = paintedBooking(page, second.id, 'Bea larga')
      await expect(short).toBeVisible()
      const [a, b] = await measureTogether(page, short, long)
      expect(a.height).toBeLessThanOrEqual(HOUR_HEIGHT * 20 / 60)
      expect(a.height).toBeGreaterThan(HOUR_HEIGHT * 20 / 60 - 3)
      expect(a.y + a.height).toBeLessThan(b.y)
      expect(Math.abs(a.x - b.x)).toBeLessThan(1)
      expect(Math.abs(a.width - b.width)).toBeLessThan(1)
      expect(b.y - a.y).toBeCloseTo(HOUR_HEIGHT / 2, 0)
      await expect(short).not.toHaveRole('button')
      await expect(long).toHaveAccessibleName(/12:00.*13:30/)
      await touchTarget(long)
      await expectNoOverflow(page)
      await page.screenshot({ path: `output/playwright/calendar-adjacent-${width}.png`, fullPage: true })
    })
  }

  test('cancelled mobile cards use overflow without offering a confirmation or reminder', async ({ page }) => {
    await booking('Cliente cancelado', '10:00', '11:00', { status: 'cancelled' })
    await page.setViewportSize({ width: 390, height: 950 })
    await page.goto('/dashboard/bookings')
    const card = page.getByRole('article').filter({ hasText: 'Cliente cancelado' })
    await expect(card).toBeVisible()
    const menuTrigger = card.getByRole('button', { name: 'Más acciones', exact: true })
    await expect(menuTrigger).toBeVisible()
    await touchTarget(menuTrigger)
    await menuTrigger.click()
    const menu = page.getByRole('menu')
    await expect(menu).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /confirmación|recordatorio/i })).toHaveCount(0)
    await expect(menu.getByRole('menuitem', { name: 'Copiar resumen', exact: true })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: /Cancelar|Reprogramar|Registrar pago/ })).toHaveCount(0)
  })

  test('genuine overlaps still occupy separate lanes for different professionals', async ({ page }) => {
    const first = await booking('Solape Ana', '11:30', '12:15')
    const second = await booking('Solape Bea', '12:00', '13:30', { professional: 1 })
    await page.setViewportSize({ width: 1440, height: 1050 })
    await calendar(page)
    const [a, b] = await measureTogether(page, paintedBooking(page, first.id, 'Solape Ana'), paintedBooking(page, second.id, 'Solape Bea'))
    expect(a.y + a.height).toBeGreaterThan(b.y)
    expect(a.x + a.width).toBeLessThanOrEqual(b.x)
    expect(Math.abs(a.width - b.width)).toBeLessThan(1)
    expect(a.height).toBeLessThanOrEqual(HOUR_HEIGHT * 45 / 60)
    await page.screenshot({ path: 'output/playwright/calendar-real-overlap.png', fullPage: true })
  })

  test('overnight booking and block continuations remain visible with original detail timestamps', async ({ page }) => {
    const yesterday = formatInTimeZone(addDays(localTime('12:00'), -1), TZ, 'yyyy-MM-dd')
    const beforeYesterday = formatInTimeZone(addDays(localTime('12:00'), -2), TZ, 'yyyy-MM-dd')
    const overnight = await booking('Cliente nocturno', '00:00', '00:10', { overrides: {
      startDateTime: fromZonedTime(`${yesterday}T23:55:00`, TZ),
    } })
    const block = await prisma.timeBlock.create({ data: {
      businessId: fixture.businessId, reason: 'Bloqueo que viene de otro día',
      startDateTime: fromZonedTime(`${beforeYesterday}T18:00:00`, TZ),
      endDateTime: localTime('00:05'),
    } })
    await page.setViewportSize({ width: 834, height: 1050 })
    await calendar(page)
    const bookingBand = paintedBooking(page, overnight.id, 'Cliente nocturno')
    const blockBand = page.locator(`.absolute[data-time-block-id="${block.id}"]`)
    await expect(bookingBand).toBeVisible()
    await expect(blockBand).toBeVisible()
    const [a, b] = await measureTogether(page, bookingBand, blockBand)
    expect(a.height).toBeCloseTo(HOUR_HEIGHT * 10 / 60, 0)
    expect(b.height).toBeCloseTo(HOUR_HEIGHT * 5 / 60, 0)
    expect(a.x + a.width <= b.x || b.x + b.width <= a.x).toBe(true)
    const disclosure = page.locator('[data-slot="brief-calendar-events"]')
    await disclosure.locator('summary').click()
    const blockAction = disclosure.getByRole('button', { name: /Bloqueo que viene de otro día/ })
    await touchTarget(blockAction)
    await blockAction.click()
    const dialog = page.getByRole('dialog', { name: 'Editar bloqueo' })
    await expect(dialog.locator('#block-date')).toHaveValue(beforeYesterday)
    await expect(dialog.getByRole('button', { name: 'Hora inicio', exact: true })).toHaveText('18:00')
    await expect(dialog.getByRole('button', { name: 'Hora fin', exact: true })).toHaveText('00:05')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(blockAction).toBeFocused()
    expect(await prisma.timeBlock.findUniqueOrThrow({ where: { id: block.id } })).toEqual(block)
    expect(await prisma.booking.findUniqueOrThrow({ where: { id: overnight.id } })).toEqual(overnight)
    await page.screenshot({ path: 'output/playwright/calendar-overnight-continuation.png', fullPage: true })
  })

  test('a multiday block fills every intersected day and never disappears before the viewed week', async ({ page }) => {
    const monday = new Date(`${day}T12:00:00Z`)
    monday.setUTCDate(monday.getUTCDate() + (8 - monday.getUTCDay()) % 7)
    day = monday.toISOString().slice(0, 10)
    const previousDay = formatInTimeZone(addDays(localTime('12:00'), -1), TZ, 'yyyy-MM-dd')
    const nextDay = formatInTimeZone(addDays(localTime('12:00'), 1), TZ, 'yyyy-MM-dd')
    const block = await prisma.timeBlock.create({ data: {
      businessId: fixture.businessId, professionalId: fixture.professionals[0], reason: 'Ausencia multidiaria',
      startDateTime: fromZonedTime(`${previousDay}T18:00:00`, TZ),
      endDateTime: fromZonedTime(`${nextDay}T10:00:00`, TZ),
    } })
    await page.setViewportSize({ width: 1440, height: 1050 })
    const focusedDay = day
    let totalPaintedHeight = 0
    for (const [visibleDay, hours] of [[previousDay, 6], [focusedDay, 24], [nextDay, 10]] as const) {
      day = visibleDay
      await calendar(page)
      const band = page.locator(`.absolute[data-time-block-id="${block.id}"]`)
      await expect(band).toBeVisible()
      const height = (await band.boundingBox())!.height
      expect(height).toBeCloseTo(hours * HOUR_HEIGHT, 0)
      totalPaintedHeight += height
    }
    expect(totalPaintedHeight).toBeCloseTo((block.endDateTime.getTime() - block.startDateTime.getTime()) / 3600_000 * HOUR_HEIGHT, 0)
    day = focusedDay
    await page.setViewportSize({ width: 390, height: 950 })
    await calendar(page, 'week')
    // This fixture's focused Monday is preceded by Sunday's start: the source
    // interval begins before the visible week and must still appear in its agenda.
    await expect(page.getByRole('region', { name: 'Agenda de la semana' }).getByRole('button', { name: /Ausencia multidiaria/ }).first()).toBeVisible()
    await expectNoOverflow(page)
  })

  test('Santiago repeated-hour appointments use elapsed duration instead of a false fifteen-minute band', async ({ page }) => {
    // Existing timezone.test.ts proves both23:xx occurrences belong to April4.
    day = '2026-04-04'
    const repeated = await booking('Cliente hora repetida', '23:30', '23:45', { overrides: {
      startDateTime: new Date('2026-04-05T02:30:00.000Z'),
      endDateTime: new Date('2026-04-05T03:45:00.000Z'),
    } })
    await page.setViewportSize({ width: 834, height: 1050 })
    await calendar(page)
    const band = paintedBooking(page, repeated.id, 'Cliente hora repetida')
    await expect(band).toBeVisible()
    expect((await band.boundingBox())!.height).toBeCloseTo(75 / 60 * HOUR_HEIGHT, 0)
    await expect(band).toHaveRole('button')
    await touchTarget(band)
    await expectDayFillsTimeline(page, day)
    await expectNoOverflow(page)
    await page.screenshot({ path: 'output/playwright/calendar-dst-repeated-hour.png', fullPage: true })
  })

  test('Santiago spring day paints its real twenty-three hours in day and week views', async ({ page }) => {
    day = '2026-09-06'
    const block = await prisma.timeBlock.create({ data: {
      businessId: fixture.businessId, reason: 'Cierre en día de cambio de hora',
      startDateTime: new Date('2026-09-06T04:00:00.000Z'),
      endDateTime: new Date('2026-09-07T03:00:00.000Z'),
    } })
    const firstHour = await booking('Primera hora real', '01:00', '02:00')
    await page.setViewportSize({ width: 1440, height: 1050 })
    for (const view of ['day', 'week']) {
      await calendar(page, view)
      const column = page.locator(`[data-calendar-day="${day}"]`).filter({ visible: true })
      const blockBand = column.locator(`.absolute[data-time-block-id="${block.id}"]`)
      const bookingBand = column.locator(`.absolute[data-booking-id="${firstHour.id}"]`)
      const [a, b] = await measureTogether(page, blockBand, bookingBand)
      expect(a.height).toBeCloseTo(23 * HOUR_HEIGHT, 0)
      expect(b.height).toBeCloseTo(HOUR_HEIGHT, 0)
      expect(a.y).toBeCloseTo(b.y, 0)
      if (view === 'day') await expectDayFillsTimeline(page, day)
      await expectNoOverflow(page)
      await column.scrollIntoViewIfNeeded()
      await page.screenshot({ path: `output/playwright/calendar-dst-spring-${view}.png`, fullPage: true })
    }
  })

  for (const scenario of [
    {
      name: 'multiday continuation', day: '2026-09-28',
      start: '2026-09-27T21:00:00.000Z', end: '2026-09-29T13:00:00.000Z',
      startDay: '2026-09-27', endDay: '2026-09-29', startTime: '18:00', endTime: '10:00',
    },
    {
      name: 'repeated-hour interval', day: '2026-04-04',
      start: '2026-04-05T02:30:00.000Z', end: '2026-04-05T03:45:00.000Z',
      startDay: '2026-04-04', endDay: '2026-04-04', startTime: '23:30', endTime: '23:45',
    },
  ]) {
    test(`editing only the reason preserves original UTC endpoints for a ${scenario.name}`, async ({ page }) => {
      day = scenario.day
      const block = await prisma.timeBlock.create({ data: {
        businessId: fixture.businessId, professionalId: fixture.professionals[0],
        reason: 'Motivo original de prueba', overlapToleranceMinutes: 5,
        startDateTime: new Date(scenario.start), endDateTime: new Date(scenario.end),
      } })
      await page.setViewportSize({ width: 834, height: 1050 })
      await calendar(page)
      await page.locator(`.absolute[data-time-block-id="${block.id}"]`).click()
      const dialog = page.getByRole('dialog', { name: 'Editar bloqueo' })
      await expect(dialog.locator('#block-date')).toHaveValue(scenario.startDay)
      await expect(dialog.getByLabel('Fecha fin', { exact: true })).toHaveValue(scenario.endDay)
      await expect(dialog.getByRole('button', { name: 'Hora inicio', exact: true })).toHaveText(scenario.startTime)
      await expect(dialog.getByRole('button', { name: 'Hora fin', exact: true })).toHaveText(scenario.endTime)
      await expect(dialog.getByLabel('Permitir que una cita invada hasta (min)', { exact: true })).toHaveValue('5')
      await dialog.getByLabel('Motivo (opcional)', { exact: true }).fill('Motivo actualizado sin cambiar horario')
      await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click()
      await expect(dialog).toHaveCount(0)
      const saved = await prisma.timeBlock.findUniqueOrThrow({ where: { id: block.id } })
      expect(saved.startDateTime.toISOString()).toBe(scenario.start)
      expect(saved.endDateTime.toISOString()).toBe(scenario.end)
      expect(saved.reason).toBe('Motivo actualizado sin cambiar horario')
      expect(saved.professionalId).toBe(block.professionalId)
      expect(saved.overlapToleranceMinutes).toBe(5)
      expect(await prisma.booking.count({ where: { businessId: fixture.businessId } })).toBe(0)
      expect(await prisma.payment.count({ where: { businessId: fixture.businessId } })).toBe(0)
      await page.reload()
      await page.locator(`.absolute[data-time-block-id="${block.id}"]`).click()
      await expect(dialog.getByLabel('Motivo (opcional)', { exact: true })).toHaveValue(saved.reason!)
      await expect(dialog.getByLabel('Fecha fin', { exact: true })).toHaveValue(scenario.endDay)
    })
  }

  test('five-minute bookings and interleaved blocks retain time geometry with keyboard-accessible details', async ({ page }) => {
    const brief = await booking('Cliente breve con nombre largo para verificar legibilidad', '11:30', '11:35')
    const long = await booking('Cliente largo', '12:00', '13:30')
    const late = await booking('Última cita', '23:55', '23:59')
    const block = await prisma.timeBlock.create({ data: {
      businessId: fixture.businessId, professionalId: fixture.professionals[0],
      startDateTime: localTime('11:35'), endDateTime: localTime('11:40'), reason: 'Limpieza breve',
    } })
    await page.setViewportSize({ width: 834, height: 1050 })
    await calendar(page)
    const briefBand = paintedBooking(page, brief.id, 'Cliente breve')
    const blockBand = page.locator(`.absolute[data-time-block-id="${block.id}"]`)
    const lateBand = paintedBooking(page, late.id, 'Última cita')
    const [a, b] = await measureTogether(page, briefBand, blockBand)
    expect(a.height).toBeGreaterThan(0)
    expect(a.height).toBeLessThanOrEqual(HOUR_HEIGHT * 5 / 60)
    expect(b.height).toBeLessThanOrEqual(HOUR_HEIGHT * 5 / 60)
    expect(a.y + a.height).toBeLessThanOrEqual(b.y)
    expect(Math.abs(a.x - b.x)).toBeLessThan(1)
    expect((await lateBand.boundingBox())!.height).toBeLessThanOrEqual(HOUR_HEIGHT * 4 / 60)
    await expect(briefBand).not.toHaveRole('button')
    await expect(blockBand).not.toHaveRole('button')

    const disclosure = page.locator('[data-slot="brief-calendar-events"]')
    const summary = disclosure.locator('summary')
    await expect(summary).toContainText('Citas breves y bloqueos (3)')
    await touchTarget(summary)
    await summary.focus()
    await page.keyboard.press('Enter')
    const shortAction = disclosure.getByRole('button', { name: /Cliente breve/ })
    await expect(shortAction).toHaveAccessibleName(/11:30.*11:35/)
    await expect(shortAction).toHaveAccessibleName(/Ana estilista/)
    await expect(shortAction).toHaveAccessibleName(/Confirmada/)
    await touchTarget(shortAction)
    await shortAction.focus()
    await page.keyboard.press('Enter')
    const drawer = page.getByRole('dialog', { name: 'Detalle de reserva' })
    await expect(drawer).toContainText('Cliente breve con nombre largo para verificar legibilidad')
    await expect(drawer).toContainText('11:30')
    await page.keyboard.press('Escape')
    await expect(drawer).toHaveCount(0)
    await expect(shortAction).toBeFocused()

    const blockAction = disclosure.getByRole('button', { name: /Limpieza breve/ })
    await expect(blockAction).toHaveAccessibleName(/11:35.*11:40/)
    await touchTarget(blockAction)
    await blockAction.focus()
    await page.keyboard.press('Enter')
    const blockDialog = page.getByRole('dialog', { name: 'Editar bloqueo' })
    await expect(blockDialog).toBeVisible()
    await expect(blockDialog.getByRole('button', { name: 'Hora inicio', exact: true })).toHaveText('11:35')
    await expect(blockDialog.getByRole('button', { name: 'Hora fin', exact: true })).toHaveText('11:40')
    await page.keyboard.press('Escape')
    await expect(blockDialog).toHaveCount(0)
    await expect(blockAction).toBeFocused()

    const longAction = paintedBooking(page, long.id, 'Cliente largo')
    await longAction.focus()
    await page.keyboard.press('Enter')
    await expect(drawer).toContainText('Cliente largo')
    await expect(drawer).toContainText('12:00')
    await page.keyboard.press('Escape')
    await expect(longAction).toBeFocused()
    await expectNoOverflow(page)
    await page.screenshot({ path: 'output/playwright/calendar-short-details.png', fullPage: true })
    const persisted = await prisma.booking.findMany({ where: { businessId: fixture.businessId }, orderBy: { startDateTime: 'asc' } })
    expect(persisted.map(bk => [bk.startDateTime.toISOString(), bk.endDateTime.toISOString(), bk.status])).toEqual(
      [brief, long, late].map(bk => [bk.startDateTime.toISOString(), bk.endDateTime.toISOString(), 'confirmed']),
    )
  })

  for (const width of [320, 390]) {
    test(`phone week agenda avoids a duplicated brief list and preserves professional navigation at ${width}px`, async ({ page }) => {
      await booking('Cliente de Ana con nombre extenso', '11:30', '11:35')
      await booking('Cliente de Bea', '12:00', '13:00', { professional: 1 })
      await page.setViewportSize({ width, height: 950 })
      await calendar(page, 'week', `&persona=${fixture.professionals[0]}`)
      const agenda = page.getByRole('region', { name: 'Agenda de la semana' })
      const detail = agenda.getByRole('button', { name: /Cliente de Ana/ })
      await expect(detail).toHaveAccessibleName(/11:30.*11:35/)
      await touchTarget(detail)
      await expect(agenda.getByRole('button', { name: /Cliente de Bea/ })).toHaveCount(0)
      await expect(page.locator('[data-slot="brief-calendar-events"]:visible')).toHaveCount(0)
      await expectNoOverflow(page)
      await page.screenshot({ path: `output/playwright/calendar-mobile-week-${width}.png`, fullPage: true })
      const nextWeekDay = formatInTimeZone(addDays(localTime('12:00'), 7), TZ, 'yyyy-MM-dd')
      await page.getByRole('link', { name: 'Siguiente', exact: true }).click()
      await expect(page).toHaveURL(new RegExp(`date=${nextWeekDay}`))
      await expect(page).toHaveURL(new RegExp(`persona=${fixture.professionals[0]}`))
      await page.getByRole('navigation', { name: 'Vista del calendario' }).getByRole('link', { name: 'Día', exact: true }).click()
      await expect(page).toHaveURL(/view=day/)
      await expect(page).toHaveURL(new RegExp(`date=${nextWeekDay}`))
      await expect(page).toHaveURL(new RegExp(`persona=${fixture.professionals[0]}`))
    })
  }

  for (const width of [320, 390, 1440]) {
    test(`all reservation statuses retain at most one primary plus overflow at ${width}px`, async ({ page }) => {
      test.setTimeout(60_000)
      const future = new Date(Date.now() + 3600_000)
      const past = new Date(Date.now() - 3600_000)
      const states: { name: string; status: BookingStatus; primary: string | null; unpaid?: boolean; stale?: boolean }[] = [
        { name: 'Confirmada prueba', status: 'confirmed', primary: 'Completar', unpaid: true },
        { name: 'Pago pendiente prueba', status: 'pending_payment', primary: 'Cobrar', unpaid: true },
        { name: 'Solicitud prueba', status: 'pending_confirmation', primary: 'Aceptar', unpaid: true },
        { name: 'Expirada prueba', status: 'expired', primary: 'Revivir', unpaid: true },
        { name: 'Cancelada prueba', status: 'cancelled', primary: null },
        { name: 'Completada prueba', status: 'completed', primary: null },
        { name: 'Ausencia prueba', status: 'no_show', primary: null },
        { name: 'Completada con saldo prueba', status: 'completed', primary: 'Cobrar', unpaid: true },
        { name: 'Plazo vencido prueba', status: 'pending_payment', primary: null, unpaid: true, stale: true },
      ]
      for (const [index, state] of states.entries()) {
        await booking(state.name, `${String(index + 9).padStart(2, '0')}:00`, `${String(index + 9).padStart(2, '0')}:30`, {
          status: state.status, unpaid: state.unpaid,
          overrides: { holdExpiresAt: state.stale ? past : future, approvalExpiresAt: future },
        })
      }
      await page.setViewportSize({ width, height: 1050 })
      await page.goto('/dashboard/bookings')
      for (const state of states) {
        const row = (width < 1024 ? page.getByRole('article') : page.getByRole('row')).filter({ hasText: state.name })
        const actions = row.locator('[data-tour-id="bookings-actions"]')
        await expect(actions).toHaveCount(1)
        await expect(actions.locator('button:visible, a:visible')).toHaveCount(state.primary ? 2 : 1)
        for (const control of await actions.locator('button:visible, a:visible').all()) await touchTarget(control)
        if (state.primary) {
          const primary = actions.getByRole('button', { name: state.primary, exact: true })
          await expect(primary).toBeVisible()
          if (state.stale) await expect(primary).toBeDisabled()
          else await expect(primary).toBeEnabled()
        }
        if (state.stale) {
          await expect(row).toContainText('Venció el plazo para pagar')
          await expect(actions.getByRole('button', { name: 'Cobrar', exact: true })).toHaveCount(0)
        }
        await actions.getByRole('button', { name: 'Más acciones', exact: true }).click()
        const menu = page.getByRole('menu')
        await expect(menu.getByRole('menuitem', { name: 'Copiar resumen', exact: true })).toBeVisible()
        const confirmed = state.status === 'confirmed'
        await expect(menu.getByRole('menuitem', { name: 'Enviar confirmación', exact: true })).toHaveCount(confirmed ? 1 : 0)
        await expect(menu.getByRole('menuitem', { name: 'Copiar confirmación', exact: true })).toHaveCount(confirmed ? 1 : 0)
        await expect(menu.getByRole('menuitem', { name: 'Enviar recordatorio', exact: true })).toHaveCount(confirmed ? 1 : 0)
        await expect(menu.getByRole('menuitem', { name: 'Copiar recordatorio', exact: true })).toHaveCount(confirmed ? 1 : 0)
        await expect(menu.getByRole('menuitem', { name: 'Reprogramar', exact: true })).toHaveCount(confirmed ? 1 : 0)
        await expect(menu.getByRole('menuitem', { name: 'Registrar pago', exact: true })).toHaveCount(confirmed ? 1 : 0)
        const cancelName = state.status === 'pending_confirmation' ? 'Rechazar' : 'Cancelar'
        const actionable = ['confirmed', 'pending_payment', 'pending_confirmation'].includes(state.status)
        await expect(menu.getByRole('menuitem', { name: cancelName, exact: true })).toHaveCount(actionable ? 1 : 0)
        const neutralContact = menu.getByRole('menuitem', { name: 'Contactar por WhatsApp', exact: true })
        await expect(neutralContact).toHaveAttribute('href', /^https:\/\/wa\.me\//)
        expect(new URL((await neutralContact.getAttribute('href'))!).searchParams.get('text'))
          .toBe(`Hola ${state.name}, te escribo por tu reserva.`)
        await page.keyboard.press('Escape')
        await expect(menu).toHaveCount(0)
      }
      await expectNoOverflow(page)
      await page.screenshot({ path: `output/playwright/reservation-actions-${width}.png`, fullPage: true })
      expect(await prisma.booking.count({ where: { businessId: fixture.businessId } })).toBe(states.length)
    })
  }

  for (const rejectedFirst of [false, true]) {
    test(`clipboard ${rejectedFirst ? 'failure and retry' : 'success'} remains visible after the menu closes`, async ({ page, context }) => {
      await booking('Cliente del portapapeles', '10:00', '11:00')
      await context.grantPermissions(['clipboard-read', 'clipboard-write'])
      if (rejectedFirst) {
        await page.addInitScript(() => {
          const writeText = navigator.clipboard.writeText.bind(navigator.clipboard)
          let failedOnce = false
          navigator.clipboard.writeText = async text => {
            if (!failedOnce) {
              failedOnce = true
              throw new DOMException('Fixture clipboard denial', 'NotAllowedError')
            }
            await writeText(text)
          }
        })
      }
      await page.setViewportSize({ width: 390, height: 950 })
      await page.goto('/dashboard/bookings')
      const card = page.getByRole('article').filter({ hasText: 'Cliente del portapapeles' })
      await card.getByRole('button', { name: 'Más acciones', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Copiar resumen', exact: true }).click()
      await expect(page.getByRole('menu')).toHaveCount(0)
      if (rejectedFirst) {
        await expect(card.getByRole('alert')).toContainText('No pudimos copiar el resumen.')
        await expect(card.getByRole('status')).toHaveCount(0)
        const retry = card.getByRole('button', { name: 'Reintentar', exact: true })
        await touchTarget(retry)
        await retry.click()
      }
      await expect(card.getByRole('status')).toHaveText('Resumen copiado')
      await expect(card.getByRole('alert')).toHaveCount(0)
      const copied = await page.evaluate(() => navigator.clipboard.readText())
      expect(copied).toContain('Cliente del portapapeles')
      expect(copied).toContain('10:00')
      await expectNoOverflow(page)
      await page.screenshot({ path: `output/playwright/reservation-copy-${rejectedFirst ? 'retry' : 'success'}.png`, fullPage: true })
    })
  }

  test('mobile payment, cancellation, rejection and revive dialogs retain their wiring without submitting', async ({ page }) => {
    const future = new Date(Date.now() + 3600_000)
    const confirmed = await booking('Diálogo confirmada', '10:00', '11:00', { unpaid: true })
    const pending = await booking('Diálogo pago', '11:00', '12:00', {
      unpaid: true, status: 'pending_payment', overrides: { holdExpiresAt: future },
    })
    const request = await booking('Diálogo solicitud', '12:00', '13:00', {
      unpaid: true, status: 'pending_confirmation', overrides: { approvalExpiresAt: future },
    })
    const expired = await booking('Diálogo expirada', '13:00', '14:00', { status: 'expired', unpaid: true })
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.goto('/dashboard/bookings')
    const cases = [
      { customer: 'Diálogo confirmada', action: 'Registrar pago', menu: true, title: 'Registrar pago manual' },
      { customer: 'Diálogo confirmada', action: 'Cancelar', menu: true, title: 'Confirmar cancelación' },
      { customer: 'Diálogo pago', action: 'Cobrar', menu: false, title: 'Registrar pago manual' },
      { customer: 'Diálogo solicitud', action: 'Rechazar', menu: true, title: 'Rechazar solicitud' },
      { customer: 'Diálogo expirada', action: 'Revivir', menu: false, title: 'Revivir reserva' },
    ]
    for (const step of cases) {
      const card = page.getByRole('article').filter({ hasText: step.customer })
      if (step.menu) {
        await card.getByRole('button', { name: 'Más acciones', exact: true }).click()
        await page.getByRole('menuitem', { name: step.action, exact: true }).click()
      } else await card.getByRole('button', { name: step.action, exact: true }).click()
      const dialog = page.getByRole('dialog', { name: step.title, exact: true })
      await expect(dialog).toBeVisible()
      await expectNoOverflow(page)
      await page.keyboard.press('Escape')
      await expect(dialog).toHaveCount(0)
      if (await page.getByRole('menu').isVisible()) await page.keyboard.press('Escape')
      await expect(page.getByRole('menu')).toHaveCount(0)
    }
    expect(await prisma.booking.findMany({ where: { businessId: fixture.businessId }, orderBy: { startDateTime: 'asc' } }))
      .toEqual([confirmed, pending, request, expired])
    expect(await prisma.payment.count({ where: { businessId: fixture.businessId } })).toBe(0)
  })

  test('past confirmed and cancelled drawer contacts do not offer an upcoming reminder', async ({ page }) => {
    day = formatInTimeZone(addDays(new Date(), -2), TZ, 'yyyy-MM-dd')
    const past = await booking('Confirmada pasada', '10:00', '11:00')
    const cancelled = await booking('Cancelada pasada', '12:00', '13:00', { status: 'cancelled' })
    await page.setViewportSize({ width: 1440, height: 1050 })
    await calendar(page)
    for (const item of [{ booking: past, name: 'Confirmada pasada' }, { booking: cancelled, name: 'Cancelada pasada' }]) {
      await paintedBooking(page, item.booking.id, item.name).click()
      const drawer = page.getByRole('dialog', { name: 'Detalle de reserva' })
      await expect(drawer).toContainText(item.name)
      await expect(drawer.getByRole('link', { name: /recordatorio/i })).toHaveCount(0)
      await expect(drawer.getByRole('button', { name: /recordatorio/i })).toHaveCount(0)
      if (item.booking.status === 'cancelled') {
        await expect(drawer.getByRole('link', { name: /confirmación/i })).toHaveCount(0)
      }
      await expect(drawer.getByRole('link', { name: 'Contactar por WhatsApp', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
    }
  })
})
