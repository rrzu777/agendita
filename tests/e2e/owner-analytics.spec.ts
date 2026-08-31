import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { prisma, seedAnalyticsFlowObservations, seedAnalyticsReport } from '../helpers/analytics-report-db'
import { assertSafeTestDatabaseUrl } from '../helpers/test-database-safety'

const secret = 'owner-analytics-e2e-secret'
const fixture = { ownerEmail: '', staffEmail: '', businessId: '', ownerId: '', staffId: '', promotionId: '', serviceId: '', attemptId: '' }
const matureDate = new Date()
matureDate.setUTCHours(0, 0, 0, 0)
matureDate.setUTCDate(matureDate.getUTCDate() - 3)
const periodStartDate = new Date(matureDate)
periodStartDate.setUTCDate(periodStartDate.getUTCDate() - 3)
const periodFrom = periodStartDate.toISOString().slice(0, 10)
const periodToDate = new Date(matureDate)
periodToDate.setUTCDate(periodToDate.getUTCDate() + 1)
const periodTo = periodToDate.toISOString().slice(0, 10)
const metricsUrl = `/dashboard/metricas?from=${periodFrom}&to=${periodTo}`
const flowEnd = new Date()
flowEnd.setUTCDate(flowEnd.getUTCDate() + 1)
const flowMetricsUrl = `/dashboard/metricas?from=${periodFrom}&to=${flowEnd.toISOString().slice(0, 10)}`

assertSafeTestDatabaseUrl(process.env.DATABASE_URL)

function setFixtureHeaders(page: import('@playwright/test').Page, email: string) {
  return page.setExtraHTTPHeaders({
    'x-e2e-test-user-email': email,
    'x-e2e-auth-secret': secret,
  })
}

function observeRuntimeErrors(page: import('@playwright/test').Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  return errors
}

test.beforeAll(async () => {
  const suffix = randomUUID()
  const report = await seedAnalyticsReport(matureDate.toISOString().slice(0, 10), 'UTC')
  fixture.businessId = report.businessId
  await seedAnalyticsFlowObservations(report)
  const acquisitionLink = await prisma.acquisitionLink.create({ data: { businessId: report.businessId, token: `e2e${suffix.replaceAll('-', '')}`, channel: 'instagram', campaignName: 'Campaña de muestra' } })
  const promotion = await prisma.promotion.create({ data: { businessId: report.businessId, name: 'Bienvenida', code: `E2E-${suffix}`, rewardType: 'fixed_amount', rewardValue: 1000 } })
  const booking = await prisma.booking.findUniqueOrThrow({ where: { id: report.booking.id }, select: { customerId: true } })
  const redemptionAt = new Date(matureDate)
  redemptionAt.setUTCHours(14, 0, 0, 0)
  await prisma.promotionRedemption.create({ data: { businessId: report.businessId, promotionId: promotion.id, bookingId: report.booking.id, customerId: booking.customerId, discountAmount: 1000, source: 'public_booking', createdAt: redemptionAt } })

  const cohortDates = Array.from({ length: 4 }, (_, index) => {
    const date = new Date(periodStartDate)
    date.setUTCDate(date.getUTCDate() + index)
    return date
  })
  const cells = cohortDates.flatMap((cohortLocalDate, index) => {
    const publishedAt = new Date(cohortLocalDate)
    publishedAt.setUTCDate(publishedAt.getUTCDate() + 1)
    publishedAt.setUTCHours(12, 0, 0, 0)
    const retentionExpiresAt = new Date(cohortLocalDate)
    retentionExpiresAt.setUTCDate(retentionExpiresAt.getUTCDate() + 90)
    const base = { businessId: report.businessId, cohortLocalDate, businessTimeZone: 'UTC', definitionVersion: 1, revision: 1, state: 'closed' as const, coverage: 'complete' as const, calculatedAt: publishedAt, cutoffAt: publishedAt }
    const total = { ...base, grain: 'total' as const, dimensionKey: 'total', retentionExpiresAt }
    const completeAttempts = 8 + index
    const visits = 12 + index
    const partialAttempts = 2 + (index % 2)
    const metric = <T extends { grain: string; dimensionKey: string }>(scope: T, population: 'sessions' | 'complete_attempts' | 'partial_attempts', metricKey: string, numerator: number, denominator = 0) => ({ ...scope, population, metricKey, numerator, denominator })
    const complete = (metricKey: string, numerator: number, denominator = 0) => metric(total, 'complete_attempts', metricKey, numerator, denominator)
    const partial = (metricKey: string, numerator: number, denominator = 0) => metric(total, 'partial_attempts', metricKey, numerator, denominator)
    const serviceScope = { ...base, grain: 'service' as const, dimensionKey: report.service.id, retentionExpiresAt }
    const channelScope = { ...base, grain: 'channel' as const, dimensionKey: 'instagram', retentionExpiresAt }
    const linkScope = { ...base, grain: 'acquisition_link' as const, dimensionKey: acquisitionLink.id, retentionExpiresAt }
    return [
      ...(['sessions', 'complete_attempts', 'partial_attempts'] as const).map((population) => metric(total, population, '__publication__', 0)),
      metric(total, 'sessions', 'visits', visits), metric(total, 'sessions', 'visit_to_attempt', completeAttempts, visits),
      complete('attempts', completeAttempts), complete('conversion', 3 + (index % 2), completeAttempts), complete('bookings_created', 4 + index), complete('conversion_path_complete', 2 + (index % 2)), complete('conversion_path_incomplete', 1), complete('known_interruption', completeAttempts - (3 + index % 2) - 1), complete('measurement_incomplete', 1), complete('availability_empty', 2, completeAttempts), complete('availability_error', 1),
      partial('attempts', partialAttempts), partial('conversion', 1, partialAttempts), partial('bookings_created', 1), partial('conversion_path_complete', 1), partial('conversion_path_incomplete', 0), partial('known_interruption', partialAttempts - 2), partial('measurement_incomplete', 1),
      ...['started', 'service', 'professional', 'date', 'time', 'customer', 'payment', 'submit'].map((milestone, step) => complete(`milestone:${milestone}`, Math.max(completeAttempts - step - (milestone === 'professional' ? 1 : 0), 2))),
      complete('last_step:payment', 2), partial('last_step:date', 1),
      metric(serviceScope, 'complete_attempts', 'service_interest', completeAttempts), metric(serviceScope, 'complete_attempts', 'service_selected', completeAttempts - 1), metric(serviceScope, 'complete_attempts', 'service_conversion', 3 + (index % 2), completeAttempts - 1), metric(serviceScope, 'complete_attempts', 'service_conversion_unobserved', 1),
      metric(serviceScope, 'partial_attempts', 'service_interest', partialAttempts), metric(serviceScope, 'partial_attempts', 'service_selected', partialAttempts), metric(serviceScope, 'partial_attempts', 'service_conversion', 1, partialAttempts),
      metric(channelScope, 'sessions', 'visits', visits - 2), metric(channelScope, 'sessions', 'visit_to_attempt', completeAttempts - 1, visits - 2), metric(channelScope, 'complete_attempts', 'attempts', completeAttempts - 1), metric(channelScope, 'complete_attempts', 'conversion', 2, completeAttempts - 1),
      metric(linkScope, 'sessions', 'visits', visits - 4), metric(linkScope, 'sessions', 'visit_to_attempt', completeAttempts - 2, visits - 4), metric(linkScope, 'complete_attempts', 'attempts', completeAttempts - 2), metric(linkScope, 'complete_attempts', 'conversion', 1, completeAttempts - 2),
    ]
  })
  await prisma.analyticsDailyMetric.createMany({ data: cells })
  const owner = await prisma.user.create({ data: { email: `owner-analytics-${suffix}@e2e.agendita.test`, name: 'Owner analytics' } })
  const staff = await prisma.user.create({ data: { email: `staff-analytics-${suffix}@e2e.agendita.test`, name: 'Staff analytics' } })
  await prisma.business.update({ where: { id: report.businessId }, data: { ownerUserId: owner.id, onboardingCompletedAt: new Date() } })
  await prisma.businessUser.createMany({ data: [{ businessId: report.businessId, userId: owner.id, role: 'owner' }, { businessId: report.businessId, userId: staff.id, role: 'staff' }] })
  Object.assign(fixture, { ownerEmail: owner.email, staffEmail: staff.email, businessId: report.businessId, ownerId: owner.id, staffId: staff.id, promotionId: promotion.id, serviceId: report.service.id, attemptId: report.attempt.id })
})

test.afterAll(async () => {
  if (fixture.businessId) await prisma.business.deleteMany({ where: { id: fixture.businessId } })
  await prisma.user.deleteMany({ where: { id: { in: [fixture.ownerId, fixture.staffId] } } })
  await prisma.$disconnect()
})

for (const layout of ['desktop', 'mobile'] as const) {
  test(`owner reads retained flow populations and final-service scope on ${layout}`, async ({ page }) => {
    await setFixtureHeaders(page, fixture.ownerEmail)
    if (layout === 'mobile') await page.setViewportSize({ width: 375, height: 812 })
    const runtimeErrors = observeRuntimeErrors(page)
    await page.goto(flowMetricsUrl)
    const flow = page.getByRole('region', { name: 'Detalle del flujo observado', exact: true })
    await expect(flow.getByRole('heading', { name: 'Detalle del flujo observado' })).toBeVisible()
    await expect(flow).toContainText('Detalle disponible')
    await expect(flow).toContainText('(fin exclusivo)')
    await expect(flow).toContainText('UTC')
    for (const [label, count] of [['Entrada completa · maduros', 3], ['Entrada completa · en curso', 2], ['Entrada parcial · maduros', 1], ['Entrada parcial · en curso', 4]] as const) {
      await expect(flow.getByRole('region', { name: label, exact: true }).locator('[data-flow-count]')).toHaveText(`${count} intento${count === 1 ? '' : 's'} observado${count === 1 ? '' : 's'}`)
    }
    const mature = flow.getByRole('region', { name: 'Entrada completa · maduros', exact: true })
    const expand = mature.locator('summary')
    await expand.focus()
    await page.keyboard.press('Enter')
    await expect(mature.locator('details')).toHaveAttribute('open', '')
    await expect(mature.getByRole('table', { name: 'Elección profesional', exact: true })).toContainText('Persona específica · elección explícita1')
    await expect(mature.getByRole('table', { name: 'Elección profesional', exact: true })).toContainText('Cualquier profesional · paso no requerido1')
    await expect(mature.getByRole('table', { name: 'Elección profesional', exact: true })).toContainText('No observado1')
    await expect(mature.getByRole('table', { name: 'Pantalla de pago', exact: true })).toContainText('Cobro1')
    await expect(mature.getByRole('table', { name: 'Condición económica', exact: true })).toContainText('Paquete1')
    await expect(mature.getByRole('table', { name: 'Métodos ofrecidos', exact: true })).toContainText('Ningún método ofrecido1')
    await expect(mature.getByRole('table', { name: 'Método elegido', exact: true })).toContainText('Transferencia1')
    await expect(mature.getByRole('table', { name: 'Errores observados', exact: true })).toContainText('Disponibilidad · error1')
    await expect(mature.getByRole('table', { name: 'Errores observados', exact: true })).toContainText('Promoción rechazada · inválida1')
    await expect(mature.getByRole('table', { name: 'Errores observados', exact: true })).toContainText('Envío con error · red1')
    await expect(flow).toContainText('Elegido no significa pagado')
    await expect(flow).toContainText('Métodos ofrecidos y errores no son aditivos')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await flow.screenshot({ path: `test-results/owner-analytics/flow-breakdowns-${layout}.png` })
    await expand.press('Enter')
    await expect(mature.getByRole('table', { name: 'Elección profesional', exact: true })).toBeHidden()
    await page.waitForLoadState('networkidle')
    await page.goto(`${flowMetricsUrl}&serviceId=${fixture.serviceId}`)
    await expect(flow).toContainText('Servicio del último contexto observado')
    await expect(flow).toContainText('no incluye todos los servicios considerados')
    await expect(flow.getByRole('region', { name: 'Entrada completa · maduros', exact: true }).locator('[data-flow-count]')).toHaveText('2 intentos observados')
    await expect(flow.getByRole('region', { name: 'Entrada completa · en curso', exact: true }).locator('[data-flow-count]')).toHaveText('0 intentos observados')
    await expect(flow.getByRole('region', { name: 'Entrada parcial · maduros', exact: true })).toContainText('Sin intentos observados')
    await expect(flow.getByRole('region', { name: 'Entrada parcial · en curso', exact: true }).locator('[data-flow-count]')).toHaveText('0 intentos observados')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.waitForLoadState('networkidle')
    await flow.screenshot({ path: `test-results/owner-analytics/flow-breakdowns-${layout}-service.png` })
    expect(runtimeErrors).toEqual([])
  })
}

test('owner sees empty versus incomplete retained detail without losing historical metrics', async ({ page }) => {
  await setFixtureHeaders(page, fixture.ownerEmail)
  const flow = page.getByRole('region', { name: 'Detalle del flujo observado', exact: true })
  await page.goto(`${metricsUrl}&channel=direct`)
  await expect(flow).toContainText('Sin intentos observados en este rango')
  await expect(flow).toContainText('no confirma tráfico cero ni captura activa')
  await expect(flow.getByRole('table')).toHaveCount(0)
  await page.waitForLoadState('networkidle')
  const before = await prisma.bookingFunnelAttempt.findUniqueOrThrow({ where: { id: fixture.attemptId }, select: { acceptedEventCount: true } })
  try {
    await prisma.bookingFunnelAttempt.update({ where: { id: fixture.attemptId }, data: { acceptedEventCount: before.acceptedEventCount + 1 } })
    await page.goto(metricsUrl)
    await expect(flow).toContainText('Fuente incompleta')
    await expect(flow.getByRole('table')).toHaveCount(0)
    await expect(page.getByText('Conversión en 24 h')).toBeVisible()
    await expect(page.getByRole('table', { name: 'Tendencia diaria' })).toBeVisible()
    await page.waitForLoadState('networkidle')
  } finally {
    await prisma.bookingFunnelAttempt.update({ where: { id: fixture.attemptId }, data: before })
  }
})

test('owner sees mature metrics, can create a zero-traffic link, and keeps it after reload', async ({ page }) => {
  await setFixtureHeaders(page, fixture.ownerEmail)
  const runtimeErrors = observeRuntimeErrors(page)
  await page.goto(metricsUrl)

  await expect(page.getByRole('heading', { name: 'Métricas' })).toBeVisible()
  await expect(page.getByText('Conversión en 24 h')).toBeVisible()
  await expect(page.getByRole('table', { name: 'Tendencia diaria' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pagos' }).first()).toBeVisible()
  await expect(page.getByRole('table', { name: 'Enlaces de adquisición' })).toContainText('Campaña de muestra')
  await expect(page.getByText('Bienvenida: Aplicado')).toBeVisible()
  await expect(page.getByText('Cancelada: 1')).toBeVisible()

  await page.getByLabel('Etiqueta de campaña', { exact: true }).fill('Enlace sin tráfico')
  await page.getByLabel('Promoción opcional', { exact: true }).selectOption(fixture.promotionId)
  await page.getByRole('button', { name: 'Crear enlace' }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Enlace creado:' })).toBeVisible()
  await page.waitForLoadState('networkidle')
  await page.reload()
  await expect(page.getByRole('table', { name: 'Enlaces de adquisición' })).toContainText('Enlace sin tráfico')
  await expect(page.getByRole('button', { name: 'Copiar Enlace sin tráfico' })).toBeVisible()
  expect(await prisma.acquisitionLink.findFirst({ where: { businessId: fixture.businessId, campaignName: 'Enlace sin tráfico' }, select: { promotionId: true } })).toEqual({ promotionId: fixture.promotionId })
  const originalLink = await prisma.acquisitionLink.findFirstOrThrow({ where: { businessId: fixture.businessId, campaignName: 'Enlace sin tráfico' } })
  const currentUrl = page.url()
  await page.getByRole('button', { name: 'Editar etiqueta de Enlace sin tráfico', exact: true }).click()
  await page.getByLabel('Etiqueta actual del enlace', { exact: true }).fill('Etiqueta vigente')
  await page.getByRole('button', { name: 'Guardar etiqueta', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Etiqueta actualizada.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Copiar Etiqueta vigente', exact: true })).toBeVisible()
  await expect(page.getByRole('table', { name: 'Enlaces de adquisición' })).not.toContainText('Enlace sin tráfico')
  expect(page.url()).toBe(currentUrl)
  expect(await prisma.acquisitionLink.findUniqueOrThrow({ where: { id: originalLink.id } })).toEqual({ ...originalLink, campaignName: 'Etiqueta vigente' })
  await page.getByRole('button', { name: 'Archivar Etiqueta vigente', exact: true }).click()
  await expect(page.getByRole('status').filter({ hasText: 'Enlace archivado.' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Archivar Etiqueta vigente', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Editar etiqueta de Etiqueta vigente', exact: true }).click()
  await page.getByLabel('Etiqueta actual del enlace', { exact: true }).fill('Etiqueta archivada actual')
  await page.getByRole('button', { name: 'Guardar etiqueta', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copiar Etiqueta archivada actual', exact: true })).toBeVisible()
  expect((await prisma.acquisitionLink.findUniqueOrThrow({ where: { id: originalLink.id } })).archivedAt).not.toBeNull()
  await page.waitForLoadState('networkidle')
  expect(runtimeErrors).toEqual([])
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/owner-analytics/dashboard-owner.png', fullPage: true })
})

test('owner can apply a custom independent filter, paginate it, close with Redis absent and cannot enable invalid configuration', async ({ page }) => {
  await setFixtureHeaders(page, fixture.ownerEmail)
  const runtimeErrors = observeRuntimeErrors(page)
  await page.goto(`${metricsUrl}&pageSize=1`)
  await page.getByLabel('Tipo de filtro histórico').selectOption('channel')
  await page.getByLabel('Canal histórico', { exact: true }).selectOption('instagram')
  await page.getByRole('button', { name: 'Aplicar filtros' }).click()
  await expect(page).toHaveURL(new RegExp(`from=${periodFrom}&to=${periodTo}.*channel=instagram.*page=1`))
  await page.getByRole('link', { name: 'Siguiente servicios' }).click()
  await expect(page).toHaveURL(new RegExp(`from=${periodFrom}&to=${periodTo}.*page=2.*channel=instagram`))
  await expect(page).not.toHaveURL(/days=28/)
  await expect(page.getByText('Cancelada: 1')).toBeVisible()
  const capture = page.getByRole('region', { name: 'Control de captura' })
  await expect(capture).toContainText('apagada por configuración, período abierto')
  await capture.getByRole('button', { name: 'Cerrar captura' }).click()
  await expect(capture).toContainText('período cerrado')
  expect(await prisma.analyticsCollectionPeriod.count({ where: { businessId: fixture.businessId, endedAt: null } })).toBe(0)
  await capture.getByRole('button', { name: 'Abrir captura' }).click()
  await expect(capture).toContainText('no cumple los requisitos')
  expect(await prisma.analyticsCollectionPeriod.count({ where: { businessId: fixture.businessId, endedAt: null } })).toBe(0)
  expect(runtimeErrors).toEqual([])
})

test('staff cannot read the metrics route and does not see the navigation entry', async ({ page }) => {
  await setFixtureHeaders(page, fixture.staffEmail)
  await page.goto('/dashboard')
  await expect(page.getByRole('link', { name: 'Métricas', exact: true })).toHaveCount(0)

  await page.goto(metricsUrl)
  await expect(page.getByText('No fue posible cargar las métricas')).toBeVisible()
  await expect(page.getByText('Conversión en 24 h')).toHaveCount(0)
})

test('owner can reach Métricas through Más on a narrow keyboard-operated layout', async ({ page }) => {
  await setFixtureHeaders(page, fixture.ownerEmail)
  const runtimeErrors = observeRuntimeErrors(page)
  await page.setViewportSize({ width: 375, height: 812 })
  await page.goto('/dashboard')
  const more = page.getByRole('button', { name: 'Más opciones' })
  await more.focus()
  await page.keyboard.press('Enter')
  const moreNavigation = page.getByRole('navigation', { name: 'Más secciones del dashboard' })
  await expect(moreNavigation.getByRole('link', { name: 'Métricas', exact: true })).toBeVisible()
  await moreNavigation.getByRole('link', { name: 'Métricas', exact: true }).press('Enter')
  await expect(page).toHaveURL(/\/dashboard\/metricas/)
  await page.waitForLoadState('networkidle')
  await page.goto(metricsUrl)
  await page.waitForLoadState('networkidle')
  const editLabel = page.getByRole('button', { name: 'Editar etiqueta de Campaña de muestra', exact: true })
  await editLabel.focus(); await page.keyboard.press('Enter')
  await expect(page.getByLabel('Etiqueta actual del enlace', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  await page.getByRole('button', { name: 'Cancelar edición', exact: true }).press('Enter')
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: 'test-results/owner-analytics/dashboard-owner-mobile-viewport.png', fullPage: false })
  const trendScroller = page.getByLabel('Desplazar tendencia diaria horizontalmente')
  await expect(trendScroller).toHaveAttribute('tabindex', '0')
  const initialScrollLeft = await trendScroller.evaluate((element) => element.scrollLeft)
  await trendScroller.press('ArrowRight')
  await expect.poll(() => trendScroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(initialScrollLeft)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375)
  expect(runtimeErrors).toEqual([])
  await page.screenshot({ path: 'test-results/owner-analytics/dashboard-owner-mobile.png', fullPage: true })
})
