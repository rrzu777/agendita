import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { fixture, guardedPrisma } from '../config/owner-analytics-public-fixture.mjs'

const prisma = guardedPrisma()
const baseURL = 'http://localhost:3555'
const bookingPath = `/book/${fixture.slug}?acq=${fixture.linkToken}`
const auth = { 'x-e2e-test-user-email': fixture.customerEmail, 'x-e2e-auth-secret': 'owner-analytics-e2e-secret' }
const browserUA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

test.afterAll(() => prisma.$disconnect())

async function pickTime(page: Page, daysAhead: number, stopAtTime = false) {
  await page.getByRole('button').filter({ hasText: 'Servicio de prueba' }).click()
  await expect(page.getByRole('heading', { name: 'Elige una fecha' })).toBeVisible()
  const date = new Date()
  date.setDate(date.getDate() + daysAhead)
  const now = new Date()
  const months = (date.getFullYear() - now.getFullYear()) * 12 + date.getMonth() - now.getMonth()
  for (let index = 0; index < months; index++) await page.getByRole('button', { name: 'Mes siguiente' }).click()
  await page.getByRole('button', { name: String(date.getDate()), exact: true }).click()
  await page.getByRole('button', { name: 'Continuar', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Elige una hora' })).toBeVisible()
  await page.getByRole('button').filter({ hasText: /^\d{2}:\d{2}$/ }).first().click()
  if (!stopAtTime) await page.getByRole('button', { name: 'Continuar', exact: true }).click()
}

async function confirmBooking(page: Page) {
  await page.getByPlaceholder('Tu nombre').fill('Synthetic Customer')
  await page.getByPlaceholder('+569...').fill('+56900000006')
  await page.getByPlaceholder('tu@email.com').fill(fixture.customerEmail)
  await page.getByRole('button', { name: 'Continuar al pago' }).click()
  await expect(page.getByRole('heading', { name: 'Confirmar reserva', exact: true })).toBeVisible()
  const confirm = page.getByRole('button', { name: 'Confirmar reserva', exact: true })
  await expect(confirm).toBeDisabled()
  await page.getByRole('checkbox').check()
  await confirm.click()
  await expect(page.getByRole('heading', { name: /Reserva (recibida|confirmada)|Confirmación/ })).toBeVisible({ timeout: 30_000 })
}

test('guest can decline on mobile without an analytics identity or request; campaign survives login navigation', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 })
  const requests: string[] = []
  page.on('request', request => { if (request.url().includes('/api/analytics/')) requests.push(request.url()) })
  await page.goto(bookingPath)
  await expect(page.getByRole('button', { name: 'Permitir métricas', exact: true })).toBeVisible()
  expect(await page.evaluate(() => [...Object.keys(localStorage), ...Object.keys(sessionStorage)].filter(key => key.startsWith('owner-analytics:')))).toEqual([])
  await page.getByRole('button', { name: 'Continuar sin métricas', exact: true }).click()
  await pickTime(page, 3)
  expect(requests).toEqual([])
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('owner-analytics:')))).toEqual([])
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.screenshot({ path: 'test-results/owner-analytics-public/declined-mobile.png', fullPage: true })
  await page.getByRole('button', { name: /¿Ya tienes cuenta/ }).click()
  await expect(page).toHaveURL(/\/ingresar\?next=.*acq%3Dsyntheticacquisitiontoken00000006/)
})

test('actual collector excludes bot and member, and records bounded HTTP ingestion samples', async ({ request }) => {
  const endpoint = `${baseURL}/api/analytics/${fixture.slug}`
  const headers = { origin: baseURL, 'user-agent': browserUA }
  const body = () => ({ bootstrapKey: randomUUID(), consent: true, consentVersion: 1, acq: fixture.linkToken })
  expect((await request.post(`${endpoint}/session`, { headers: { ...headers, 'user-agent': 'SyntheticHeadlessBot' }, data: body() })).status()).toBe(403)
  expect((await request.post(`${endpoint}/session`, { headers: { ...headers, ...auth, 'x-e2e-test-user-email': fixture.ownerEmail }, data: body() })).status()).toBe(403)
  const started = performance.now()
  const sessionResponse = await request.post(`${endpoint}/session`, { headers, data: body() })
  expect(sessionResponse.ok()).toBe(true)
  const session = await sessionResponse.json()
  const attemptResponse = await request.post(`${endpoint}/attempt`, { headers, data: { bootstrapKey: randomUUID(), credential: session.credential, entryKind: 'complete' } })
  expect(attemptResponse.ok()).toBe(true)
  const attempt = await attemptResponse.json()
  const bootstrapMs = performance.now() - started
  const samples: { events: number; elapsedMs: number }[] = []
  for (let sample = 0; sample < 3; sample++) {
    const events = Array.from({ length: 20 }, (_, index) => ({ version: 1, eventId: randomUUID(), sequence: sample * 20 + index + 1, selectionRevision: 1, type: 'service_considered', data: { serviceId: fixture.serviceId } }))
    const start = performance.now()
    const response = await request.post(`${endpoint}/events`, { headers, data: { credential: attempt.credential, events } })
    const elapsedMs = performance.now() - start
    expect(response.ok()).toBe(true)
    expect((await response.json()).receipts.every((receipt: { status: string }) => receipt.status === 'accepted')).toBe(true)
    samples.push({ events: 20, elapsedMs })
  }
  const gapStart = performance.now()
  const gap = await request.post(`${endpoint}/events`, { headers, data: { credential: attempt.credential, events: [], captureGap: true } })
  expect((await gap.json()).captureGapRecorded).toBe(true)
  expect(await prisma.bookingFunnelEvent.count({ where: { attemptId: attempt.id } })).toBe(60)
  console.log(JSON.stringify({ metric: 'local-http-ingest', bootstrapRows: 2, bootstrapMs, samples, gapMs: performance.now() - gapStart, gapEventRows: 0, reservedUnits: 63 }))
})

for (const degraded of [false, true]) {
  test(`campaign → service → time → Booking ${degraded ? 'on mobile with offline recovery and capture failure' : 'on desktop with actual capture'}`, async ({ page, context }) => {
    await page.setExtraHTTPHeaders(auth)
    if (degraded) await page.setViewportSize({ width: 375, height: 812 })
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto(bookingPath)
    const attemptReady = page.waitForResponse(response => response.url().endsWith(`/api/analytics/${fixture.slug}/attempt`) && response.ok())
    await page.getByRole('button', { name: 'Permitir métricas', exact: true }).click()
    const attempt = await (await attemptReady).json()
    if (degraded) await page.route(`**/api/analytics/${fixture.slug}/events`, route => route.abort('internetdisconnected'))
    await pickTime(page, degraded ? 5 : 4)
    if (degraded) {
      await context.setOffline(true)
      await expect(page.getByPlaceholder('Tu nombre')).toBeVisible()
      await page.getByPlaceholder('Tu nombre').fill('Synthetic offline draft')
      await expect(page.getByPlaceholder('Tu nombre')).toHaveValue('Synthetic offline draft')
      await context.setOffline(false)
    }
    await confirmBooking(page)
    const booking = await prisma.booking.findFirstOrThrow({ where: { businessId: fixture.businessId, analyticsAttemptId: attempt.id } })
    expect(booking.analyticsChannel).toBe('instagram')
    expect(booking.analyticsAcquisitionLinkId).not.toBeNull()
    expect(booking.createdAt.getTime()).toBeGreaterThanOrEqual(booking.analyticsAttemptStartedAt!.getTime())
    expect(booking.createdAt.getTime()).toBeLessThan(booking.analyticsConversionDeadlineAt!.getTime())
    if (!degraded) {
      await expect.poll(() => prisma.bookingFunnelEvent.count({ where: { attemptId: attempt.id, type: 'booking_submit_result' } })).toBe(1)
      const events = await prisma.bookingFunnelEvent.findMany({ where: { attemptId: attempt.id }, select: { type: true, data: true } })
      expect(events.map(event => event.type)).toEqual(expect.arrayContaining(['service_selected', 'date_selected', 'time_selected', 'customer_step_completed', 'payment_branch_viewed', 'booking_submit_result']))
      expect(events.find(event => event.type === 'booking_submit_result')?.data).toMatchObject({ result: 'submitted' })
      expect(JSON.stringify(events)).not.toContain(fixture.customerEmail)
      expect(JSON.stringify(events)).not.toContain('+56900000006')
    }
    expect(errors).toEqual([])
    // Capture from top: full-page screenshots otherwise place sticky chrome at the old scroll offset.
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `test-results/owner-analytics-public/booking-${degraded ? 'mobile-capture-failed' : 'desktop'}.png`, fullPage: true })
  })
}

test('late opt-in and withdrawal do not erase the selected booking hour', async ({ page }) => {
  await page.goto(bookingPath)
  await page.getByRole('button', { name: 'Continuar sin métricas', exact: true }).click()
  await pickTime(page, 6, true)
  const next = page.getByRole('button', { name: 'Continuar', exact: true })
  await expect(next).toBeEnabled()
  await page.getByRole('button', { name: 'Cambiar preferencia de métricas' }).click()
  const bootstrapped = page.waitForResponse(response => response.url().endsWith(`/api/analytics/${fixture.slug}/attempt`) && response.ok())
  await page.getByRole('button', { name: 'Permitir métricas', exact: true }).click()
  await bootstrapped
  await expect(next).toBeEnabled()
  await page.getByRole('button', { name: 'Retirar permiso de métricas' }).click()
  await expect(next).toBeEnabled()
  await next.click()
  await expect(page.getByRole('heading', { name: 'Tus datos', exact: true })).toBeVisible()
})

for (const consent of ['declined', 'withdrawn'] as const) {
  test(`Booking commits without analytics after consent is ${consent}`, async ({ page }) => {
    // Catches making analytics mandatory, retaining a withdrawn credential, or
    // sending new capture requests while completing a non-consented reservation.
    await page.setExtraHTTPHeaders(auth)
    const before = await prisma.booking.findMany({ where: { businessId: fixture.businessId }, select: { id: true } })
    const requests: string[] = []
    page.on('request', request => { if (request.url().includes('/api/analytics/')) requests.push(request.url()) })
    await page.goto(bookingPath)
    if (consent === 'withdrawn') {
      const bootstrapped = page.waitForResponse(response => response.url().endsWith(`/api/analytics/${fixture.slug}/attempt`) && response.ok())
      await page.getByRole('button', { name: 'Permitir métricas', exact: true }).click()
      await bootstrapped
      await page.waitForLoadState('networkidle')
      requests.length = 0 // Capture was permitted only before the withdrawal click.
      await page.getByRole('button', { name: 'Retirar permiso de métricas' }).click()
    } else {
      await page.getByRole('button', { name: 'Continuar sin métricas', exact: true }).click()
    }
    await pickTime(page, consent === 'declined' ? 8 : 9)
    await confirmBooking(page)
    const created = await prisma.booking.findMany({ where: { businessId: fixture.businessId, id: { notIn: before.map(row => row.id) } } })
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({
      serviceId: fixture.serviceId, totalPrice: 10000, depositRequired: 0,
      analyticsVersion: null, analyticsSessionId: null, analyticsAttemptId: null,
      analyticsAttemptStartedAt: null, analyticsConversionDeadlineAt: null,
      analyticsRetentionExpiresAt: null, analyticsChannel: null,
      analyticsNormalizationVersion: null, analyticsAcquisitionLinkId: null,
      analyticsSelectionRevision: null,
    })
    expect(requests).toEqual([])
    expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('owner-analytics:')))).toEqual([])
  })
}
