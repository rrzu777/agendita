import 'server-only'
import type { DailyMetricCell, Grain, MetricKey, Population } from '@/lib/analytics/report-types'
import { ratio } from '@/lib/analytics/daily-metrics'
import { startOfLocalDay } from '@/lib/availability/timezone'
import { ANALYTICS_POLICY as policy } from '@/lib/analytics/policy'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { UserError } from '@/lib/actions/result'
import { channelSchema, dimensionIdSchema } from '@/lib/analytics/contracts'
import { getAnalyticsCaptureConfig } from '@/lib/analytics/budget'
import { getLocalDateStr } from '@/lib/availability/timezone'
import { isDoomedBooking } from '@/lib/payments/confirmation-state'
import { getBookingFunnelUrl } from '@/lib/business/urls'
import { analyticsCoverage, readAnalyticsCohort, type AvailabilityDiagnostics } from './repository'

export function summarizeAnalyticsCells(cells: DailyMetricCell[], grain: Grain = 'total', dimensionKey?: string) {
  function counter(population: Population, metricKey: MetricKey) {
    const matched = cells.filter(c => c.population === population && c.metricKey === metricKey && c.grain === grain && (!dimensionKey || c.dimensionKey === dimensionKey) && c.state !== 'failed' && c.coverage !== 'disabled')
    const numerator = matched.reduce((n, c) => n + c.numerator, 0)
    const denominator = matched.reduce((n, c) => n + c.denominator, 0)
    return { numerator, denominator, rate: ratio(numerator, denominator) }
  }
  function population(kind: Population) {
    return { attempts: counter(kind, 'attempts').numerator, conversion: counter(kind, 'conversion'), bookingsCreated: counter(kind, 'bookings_created').numerator,
      pathComplete: counter(kind, 'conversion_path_complete').numerator, pathIncomplete: counter(kind, 'conversion_path_incomplete').numerator,
      knownInterruptions: counter(kind, 'known_interruption').numerator, measurementIncomplete: counter(kind, 'measurement_incomplete').numerator,
      availabilityEmpty: counter(kind, 'availability_empty'), availabilityErrors: counter(kind, 'availability_error').numerator }
  }
  return { visits: counter('sessions', 'visits').numerator, visitToAttempt: counter('sessions', 'visit_to_attempt'), complete: population('complete_attempts'), partial: population('partial_attempts') }
}
export function addAnalyticsDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
export function analyticsDayRange(localDate: string, timezone: string) {
  new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || new Date(`${localDate}T00:00:00Z`).toISOString().slice(0, 10) !== localDate) throw new Error('Invalid analytics date')
  const start = startOfLocalDay(localDate, timezone)
  const end = startOfLocalDay(addAnalyticsDays(localDate, 1), timezone)
  return { start, end, closeAfter: new Date(end.getTime() + policy.conversionWindowMs + policy.reconciliationMarginMs) }
}

const inputSchema = z.strictObject({ days: z.union([z.literal(7), z.literal(28), z.literal(90)]).optional(), from: z.string().optional(), to: z.string().optional(), channel: channelSchema.optional(), acquisitionLinkId: dimensionIdSchema.optional(), serviceId: dimensionIdSchema.optional(), page: z.number().int().min(1).max(1000).default(1), pageSize: z.number().int().min(1).max(100).default(25) })
export type OwnerAnalyticsReportInput = z.input<typeof inputSchema>
type Summary = ReturnType<typeof summarizeAnalyticsCells>
type Ratio = Summary['complete']['conversion']
export interface AnalyticsOpportunity { key: 'availability_empty' | 'overdue_approval'; numerator: number; denominator: number | null; rate: number | null; href: string; message: string; diagnostics: { status: 'available' | 'not_queried' | 'not_retained' | 'not_applicable'; reasons: Record<string, number>; converted: number | null } }
export interface OwnerAnalyticsReport extends Summary {
  definitionVersion: 1
  period: { from: string; to: string; timezone: string; cutoffAt: string; previousFrom: string; previousTo: string }
  capture: { enabled: boolean; collectionOpen: boolean; activatedAt: string | null; status: 'enabled' | 'disabled' | 'paused' }
  coverage: { status: 'complete' | 'partial' | 'disabled' | 'unavailable'; cohorts: { date: string; timezone: string; version: number; coverage: string; state: string; frozen: boolean; calculatedAt: string | null }[]; warnings: string[] }
  comparison: { status: 'comparable' | 'coverage_not_comparable' | 'no_data'; deltaPercentagePoints: number | null; previousConversion: Ratio }
  recent: Summary & { status: 'provisional' | 'unavailable'; from: string; to: string; cutoffAt: string; timezones: string[]; inProgress: { complete: number; partial: number } }
  suppression: { applied: false; note: string }
  trend: { date: string; timezone: string; complete: Summary['complete']; partial: Summary['partial']; visits: number }[]
  funnel: { population: Population; milestone: string; count: number }[]
  quality: { population: Population; lastStep: string; count: number }[]
  services: { rows: { id: string; label: string; population: Population; interest: number; selected: number; conversion: Ratio; unobservedConversions: number }[]; page: number; pageSize: number; total: number }
  channels: { rows: { id: string; summary: Summary }[]; scope: 'independent_grain' }
  links: { rows: { id: string; label: string; archived: boolean; summary: Summary }[]; page: number; pageSize: number; total: number }
  acquisitionLinks: { rows: { id: string; channel: string; campaignName: string; promotionId: string | null; createdAt: string; archivedAt: string | null; url: string }[]; page: number; pageSize: number; total: number }
  currentBookings: { label: 'estado al consultar'; scope: 'all_bookings_created_in_period'; counts: { status: string; count: number }[]; overdueApproval: { count: number; lowerBound: boolean }; attendedByService: { serviceId: string; count: number }[] }
  redemptions: { label: 'canjes al consultar'; scope: 'all_redemptions_created_in_period'; rows: { promotionId: string; label: string; status: string; count: number }[]; page: number; pageSize: number; hasMore: boolean }
  opportunities: AnalyticsOpportunity[]
  opportunityNote: string
  filter: { channel: string | null; acquisitionLinkId: string | null; serviceId: string | null; scope: 'independent_grains'; unsupportedIntersections: true }
}

export function buildAnalyticsOpportunities(empty: Ratio, diagnostics: AvailabilityDiagnostics | null, overdue: number): AnalyticsOpportunity[] {
  const opportunities: AnalyticsOpportunity[] = []
  if (empty.denominator >= 20 && empty.numerator >= 5 && empty.rate !== null && empty.rate >= 0.3) opportunities.push({ key: 'availability_empty', ...empty, href: '/dashboard/availability', message: 'Se encontraron búsquedas sin horarios; revisa fechas, plazos permitidos y profesionales solicitados. No prueba ventas perdidas ni falta de capacidad.', diagnostics: { status: diagnostics ? 'available' : 'not_queried', reasons: diagnostics?.reasons ?? {}, converted: diagnostics?.converted ?? null } })
  if (overdue > 0) opportunities.push({ key: 'overdue_approval', numerator: overdue, denominator: null, rate: null, href: '/dashboard/bookings', message: 'Hay solicitudes con plazo de respuesta vencido al consultar. No son holds de pago ni una causa inferida del embudo.', diagnostics: { status: 'not_applicable', reasons: {}, converted: null } })
  return opportunities.slice(0, 3)
}

/** Authenticated DAL: no caller business ID, no shared cache, no capture-config gate on reads. */
export async function getOwnerAnalyticsReport(input: unknown = {}, now = new Date()): Promise<OwnerAnalyticsReport> {
  const { businessId, business } = await requireBusinessRole(['owner', 'admin'])
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) throw new UserError('Filtros de métricas inválidos.')
  const p = parsed.data
  if ([p.channel, p.acquisitionLinkId, p.serviceId].filter(Boolean).length > 1) throw new UserError('El histórico admite canal, enlace o servicio por separado; no sus intersecciones.')
  const today = getLocalDateStr(now, business.timezone)
  const from = p.from ?? addAnalyticsDays(today, -(p.days ?? 28))
  const to = p.to ?? today
  if (Boolean(p.from) !== Boolean(p.to) || (p.days && p.from)) throw new UserError('Selecciona un único período.')
  try { analyticsDayRange(from, business.timezone); analyticsDayRange(to, business.timezone) } catch { throw new UserError('Período o zona inválidos.') }
  const length = (+new Date(to) - +new Date(from)) / 86400000
  if (length < 1 || length > 90 || from < addAnalyticsDays(today, -90) || to > addAnalyticsDays(today, 1)) throw new UserError('El detalle admite hasta 90 días dentro de la retención vigente.')
  const previousFrom = addAnalyticsDays(from, -length)
  const configured = Boolean(getAnalyticsCaptureConfig(businessId))
  return prisma.$transaction(async tx => {
    if (p.acquisitionLinkId && !await tx.acquisitionLink.findFirst({ where: { businessId, id: p.acquisitionLinkId }, select: { id: true } })) throw new UserError('Enlace no disponible.')
    if (p.serviceId && !await tx.service.findFirst({ where: { businessId, id: p.serviceId }, select: { id: true } }) && !await tx.analyticsDailyMetric.findFirst({ where: { businessId, grain: 'service', dimensionKey: p.serviceId, retentionExpiresAt: { gt: now } }, select: { id: true } })) throw new UserError('Servicio no disponible.')
    const stored = await tx.analyticsDailyMetric.findMany({ where: { businessId, cohortLocalDate: { gte: new Date(previousFrom), lt: new Date(to) }, retentionExpiresAt: { gt: now } }, orderBy: [{ cohortLocalDate: 'asc' }, { id: 'asc' }], take: 20001 })
    if (stored.length > 20000) throw new UserError('El período excede el límite de detalle; selecciona menos días.')
    const all = stored.map(c => ({ ...c, cohortLocalDate: c.cohortLocalDate.toISOString().slice(0, 10), metricKey: c.metricKey as MetricKey }))
    // Only complete publication revisions are readable; never mix a partly deleted/invalid revision.
    const groups = new Map<string, DailyMetricCell[]>()
    for (const c of all) { const key = JSON.stringify([c.cohortLocalDate, c.businessTimeZone, c.definitionVersion]); const group = groups.get(key) ?? []; group.push(c); groups.set(key, group) }
    const valid = [...groups.values()].filter(g => { const markers = g.filter(c => c.metricKey === '__publication__'); return markers.length === 3 && markers.every(c => c.state === 'closed') && g.every(c => c.revision === markers[0].revision && c.state === 'closed') }).flat()
    const cells = valid.filter(c => c.cohortLocalDate >= from)
    const prior = valid.filter(c => c.cohortLocalDate < from)
    const grain: Grain = p.channel ? 'channel' : p.acquisitionLinkId ? 'acquisition_link' : 'total'
    const key = p.channel ?? p.acquisitionLinkId
    const summary = summarizeAnalyticsCells(cells, grain, key)
    const previous = summarizeAnalyticsCells(prior, grain, key)
    const periods = await tx.analyticsCollectionPeriod.findMany({ where: { businessId }, select: { startedAt: true, endedAt: true }, orderBy: { startedAt: 'asc' }, take: 1001 })
    const collectionOpen = periods.some(c => !c.endedAt)
    const cohorts: OwnerAnalyticsReport['coverage']['cohorts'] = []
    for (let day = from; day < to; day = addAnalyticsDays(day, 1)) {
      const markers = all.filter(c => c.cohortLocalDate === day && c.metricKey === '__publication__' && c.population === 'complete_attempts')
      if (markers.length) for (const m of markers) cohorts.push({ date: day, timezone: m.businessTimeZone, version: m.definitionVersion, coverage: m.coverage, state: valid.includes(m) ? 'closed' : 'unavailable', frozen: Boolean(m.frozenAt), calculatedAt: m.calculatedAt.toISOString() })
      else {
        const range = analyticsDayRange(day, business.timezone)
        const coverage = await analyticsCoverage(tx, businessId, business.timezone, 1, range.start, range.end, configured)
        cohorts.push({ date: day, timezone: business.timezone, version: 1, coverage, state: coverage === 'disabled' ? 'disabled' : now < range.closeAfter ? 'provisional' : 'unavailable', frozen: false, calculatedAt: null })
      }
    }
    function recentBounds(timezone: string) {
      const localToday = getLocalDateStr(now, timezone)
      const tomorrow = addAnalyticsDays(localToday, 1)
      // Presets include today provisionally; an explicit historical range is never widened.
      return { from: [p.from ?? addAnalyticsDays(localToday, -(p.days ?? 28)), addAnalyticsDays(localToday, -2)].sort().at(-1)!, to: p.to ? [p.to, tomorrow].sort()[0] : tomorrow }
    }
    const currentRecent = recentBounds(business.timezone)
    const recentRanges = new Map([[business.timezone, currentRecent]])
    const recentCells: DailyMetricCell[] = []
    const diagnostics: AvailabilityDiagnostics = { eligible: 0, affected: 0, converted: 0, reasons: {} }
    let recentAvailable = true
    const recentIdentities = new Map<string, { day: string; timezone: string; version: number }>()
    for (let day = currentRecent.from; day < currentRecent.to; day = addAnalyticsDays(day, 1)) recentIdentities.set(JSON.stringify([day, business.timezone, 1]), { day, timezone: business.timezone, version: 1 })
    {
      // Discover by elapsed time BEFORE applying calendar bounds in each source's frozen zone.
      // Four elapsed days cover three local calendar dates plus offset/DST boundaries.
      const where = { businessId, startedAt: { gte: new Date(+now - 4 * policy.conversionWindowMs), lte: now } }
      const args = { by: ['cohortLocalDate', 'businessTimeZone', 'definitionVersion'] as ['cohortLocalDate', 'businessTimeZone', 'definitionVersion'], where, orderBy: { cohortLocalDate: 'asc' as const }, take: 101 }
      const sessions = await tx.analyticsSession.groupBy(args)
      const attempts = await tx.bookingFunnelAttempt.groupBy(args)
      if (sessions.length > 100 || attempts.length > 100) recentAvailable = false
      else for (const c of [...sessions, ...attempts]) {
        const day = c.cohortLocalDate.toISOString().slice(0, 10)
        const bounds = recentBounds(c.businessTimeZone)
        if (day < bounds.from || day >= bounds.to) continue
        recentRanges.set(c.businessTimeZone, bounds)
        recentIdentities.set(JSON.stringify([day, c.businessTimeZone, c.definitionVersion]), { day, timezone: c.businessTimeZone, version: c.definitionVersion })
      }
    }
    for (const { day, timezone, version } of recentAvailable ? recentIdentities.values() : []) {
      const range = analyticsDayRange(day, timezone)
      if (now >= range.closeAfter) continue
      try {
        const raw = await readAnalyticsCohort(tx, { businessId, cohortLocalDate: day, businessTimeZone: timezone, definitionVersion: version, cohortEndAt: range.end, calculatedAt: now, cutoffAt: now, revision: 1, state: 'provisional', coverage: 'unknown', frozenAt: null, retentionExpiresAt: new Date(+range.end + policy.aggregateRetentionMs) }, range.start)
        recentCells.push(...raw.cells)
        diagnostics.eligible += raw.diagnostics.eligible; diagnostics.affected += raw.diagnostics.affected; diagnostics.converted += raw.diagnostics.converted
        for (const [reason, n] of Object.entries(raw.diagnostics.reasons)) diagnostics.reasons[reason] = (diagnostics.reasons[reason] ?? 0) + n
      } catch { recentAvailable = false }
    }
    const recentFrom = [...recentRanges.values()].map(r => r.from).sort()[0]
    const recentTo = [...recentRanges.values()].map(r => r.to).sort().at(-1)!
    const recentSummary = summarizeAnalyticsCells(recentAvailable ? recentCells : [], grain, key)
    // The denominator is precisely the mature subset of the SAME population and selected grain.
    const inProgress = { complete: recentSummary.complete.attempts - recentSummary.complete.conversion.denominator, partial: recentSummary.partial.attempts - recentSummary.partial.conversion.denominator }
    const recent = { ...recentSummary, status: recentAvailable ? 'provisional' as const : 'unavailable' as const, from: recentFrom, to: recentTo, cutoffAt: now.toISOString(), timezones: [...new Set([...recentIdentities.values()].map(c => c.timezone))], inProgress }
    const comparable = (rows: DailyMetricCell[], start: string, end: string) => {
      for (let day = start; day < end; day = addAnalyticsDays(day, 1)) { const m = rows.filter(c => c.cohortLocalDate === day && c.metricKey === '__publication__'); if (m.length !== 3 || m.some(c => c.coverage !== 'complete' || c.businessTimeZone !== business.timezone || c.definitionVersion !== 1)) return false }
      return true
    }
    const comparableCoverage = comparable(cells, from, to) && comparable(prior, previousFrom, from)
    const comparison: OwnerAnalyticsReport['comparison'] = { status: !comparableCoverage ? 'coverage_not_comparable' : summary.complete.conversion.rate === null || previous.complete.conversion.rate === null ? 'no_data' : 'comparable', deltaPercentagePoints: null, previousConversion: previous.complete.conversion }
    if (comparison.status === 'comparable') comparison.deltaPercentagePoints = (summary.complete.conversion.rate! - previous.complete.conversion.rate!) * 100
    const dimensionIds = (g: Grain) => [...new Set(cells.filter(c => c.grain === g).map(c => c.dimensionKey))].sort()
    const serviceIds = dimensionIds('service').filter(id => !p.serviceId || p.serviceId === id)
    const linkIds = dimensionIds('acquisition_link').filter(id => !p.acquisitionLinkId || p.acquisitionLinkId === id)
    const page = <T,>(rows: T[]) => rows.slice((p.page - 1) * p.pageSize, p.page * p.pageSize)
    const servicePairs = serviceIds.flatMap(id => (['complete_attempts', 'partial_attempts'] as const).filter(population => cells.some(c => c.grain === 'service' && c.dimensionKey === id && c.population === population)).map(population => ({ id, population })))
    const serviceLabels = await tx.service.findMany({ where: { businessId, id: { in: page(servicePairs).map(s => s.id) } }, select: { id: true, name: true }, take: 100 })
    const linkLabels = await tx.acquisitionLink.findMany({ where: { businessId, id: { in: page(linkIds) } }, select: { id: true, campaignName: true, archivedAt: true }, take: 100 })
    const managedLinks = await tx.acquisitionLink.findMany({ where: { businessId }, orderBy: { id: 'asc' }, skip: (p.page - 1) * p.pageSize, take: p.pageSize, select: { id: true, channel: true, campaignName: true, promotionId: true, createdAt: true, archivedAt: true, token: true } })
    const managedLinkCount = await tx.acquisitionLink.count({ where: { businessId } })
    const serviceRows: OwnerAnalyticsReport['services']['rows'] = []
    for (const { id, population } of page(servicePairs)) {
      const selected = cells.filter(c => c.grain === 'service' && c.dimensionKey === id && c.population === population)
      const sum = (metric: MetricKey, column: 'numerator' | 'denominator' = 'numerator') => selected.filter(c => c.metricKey === metric).reduce((n, c) => n + c[column], 0)
      const n = sum('service_conversion'), d = sum('service_conversion', 'denominator')
      serviceRows.push({ id, population, label: serviceLabels.find(s => s.id === id)?.name ?? 'Servicio eliminado', interest: sum('service_interest'), selected: sum('service_selected'), conversion: { numerator: n, denominator: d, rate: ratio(n, d) }, unobservedConversions: sum('service_conversion_unobserved') })
    }
    const transactionalRange = { gte: analyticsDayRange(from, business.timezone).start, lt: analyticsDayRange(to, business.timezone).start }
    const bookingWhere = { businessId, createdAt: transactionalRange }
    const statuses = await tx.booking.groupBy({ by: ['status'], where: bookingWhere, _count: true })
    const attended = await tx.booking.groupBy({ by: ['serviceId'], where: { ...bookingWhere, status: 'completed', serviceId: { in: page(servicePairs).map(s => s.id) } }, _count: true })
    const pending = await tx.booking.findMany({ where: { businessId, status: 'pending_confirmation', approvalExpiresAt: { lt: now } }, select: { status: true, paymentStatus: true, approvalExpiresAt: true, holdExpiresAt: true }, orderBy: { approvalExpiresAt: 'asc' }, take: 1001 })
    const overdue = pending.filter(b => b.status === 'pending_confirmation' && isDoomedBooking(b, now)).length
    const redemptions = await tx.promotionRedemption.groupBy({ by: ['promotionId', 'status'], where: { businessId, createdAt: transactionalRange }, orderBy: [{ promotionId: 'asc' }, { status: 'asc' }], _count: true, skip: (p.page - 1) * p.pageSize, take: p.pageSize + 1 })
    const promotions = await tx.promotion.findMany({ where: { businessId, id: { in: redemptions.slice(0, p.pageSize).map(r => r.promotionId) } }, select: { id: true, name: true }, take: 100 })
    const opportunityCells = [...cells, ...(recentAvailable ? recentCells.filter(c => c.cohortLocalDate >= from && c.cohortLocalDate < to) : [])]
    const opportunityRatio = summarizeAnalyticsCells(opportunityCells, grain, key).complete.availabilityEmpty
    const opportunities = buildAnalyticsOpportunities(opportunityRatio, !summary.complete.availabilityEmpty.denominator && !key && recentAvailable && diagnostics.eligible === opportunityRatio.denominator && diagnostics.affected === opportunityRatio.numerator ? diagnostics : null, overdue)
    const observed = cells.some(c => c.metricKey !== '__publication__')
    const coverageStatus = cohorts.every(c => c.coverage === 'complete' && c.state === 'closed') ? 'complete' : cohorts.every(c => c.coverage === 'disabled') ? 'disabled' : observed || recentCells.length ? 'partial' : 'unavailable'
    return {
      ...summary, definitionVersion: 1, period: { from, to, timezone: business.timezone, cutoffAt: now.toISOString(), previousFrom, previousTo: from },
      capture: { enabled: configured && collectionOpen, collectionOpen, activatedAt: periods[0]?.startedAt.toISOString() ?? null, status: !configured ? 'disabled' : collectionOpen ? 'enabled' : 'paused' },
      coverage: { status: coverageStatus, cohorts, warnings: ['Sólo sesiones e intentos consentidos; no personas únicas ni tráfico total.', ...(!configured && collectionOpen ? ['La captura está apagada; el instante exacto del cambio de configuración no es conocido.'] : []), ...(cohorts.some(c => c.timezone !== business.timezone || c.version !== 1) ? ['El rango contiene zonas o definiciones históricas distintas.'] : []), ...(p.serviceId ? ['El filtro de servicio sólo aplica a su grano; el resumen total no se reconstruye sumando servicios.'] : [])] },
      comparison, recent, suppression: { applied: false, note: 'Celdas pequeñas visibles sólo al owner/admin; no implica anonimización. Política de activación pendiente.' },
      trend: [...new Map(cells.map(c => [JSON.stringify([c.cohortLocalDate, c.businessTimeZone]), c])).values()].map(c => ({ date: c.cohortLocalDate, timezone: c.businessTimeZone, ...summarizeAnalyticsCells(cells.filter(r => r.cohortLocalDate === c.cohortLocalDate && r.businessTimeZone === c.businessTimeZone), grain, key) })),
      funnel: groupedObserved(cells, 'milestone:', grain, key).map(c => ({ population: c.population, milestone: c.key, count: c.count })), quality: groupedObserved(cells, 'last_step:', grain, key).map(c => ({ population: c.population, lastStep: c.key, count: c.count })),
      services: { rows: serviceRows, page: p.page, pageSize: p.pageSize, total: servicePairs.length }, channels: { rows: dimensionIds('channel').filter(id => !p.channel || id === p.channel).map(id => ({ id, summary: summarizeAnalyticsCells(cells, 'channel', id) })), scope: 'independent_grain' },
      links: { rows: page(linkIds).map(id => ({ id, label: linkLabels.find(l => l.id === id)?.campaignName ?? (id === 'unknown' ? 'Sin enlace atribuido' : 'Enlace eliminado'), archived: Boolean(linkLabels.find(l => l.id === id)?.archivedAt), summary: summarizeAnalyticsCells(cells, 'acquisition_link', id) })), page: p.page, pageSize: p.pageSize, total: linkIds.length },
      acquisitionLinks: { rows: managedLinks.map(l => ({ id: l.id, channel: l.channel, campaignName: l.campaignName, promotionId: l.promotionId, createdAt: l.createdAt.toISOString(), archivedAt: l.archivedAt?.toISOString() ?? null, url: getBookingFunnelUrl(business, new URLSearchParams({ acq: l.token }).toString()) })), page: p.page, pageSize: p.pageSize, total: managedLinkCount },
      currentBookings: { label: 'estado al consultar', scope: 'all_bookings_created_in_period', counts: statuses.map(s => ({ status: s.status, count: s._count })), overdueApproval: { count: overdue, lowerBound: pending.length === 1001 }, attendedByService: attended.map(s => ({ serviceId: s.serviceId, count: s._count })) },
      redemptions: { label: 'canjes al consultar', scope: 'all_redemptions_created_in_period', rows: redemptions.slice(0, p.pageSize).map(r => ({ promotionId: r.promotionId, label: promotions.find(p => p.id === r.promotionId)?.name ?? 'Promoción eliminada', status: r.status, count: r._count })), page: p.page, pageSize: p.pageSize, hasMore: redemptions.length > p.pageSize }, opportunities, opportunityNote: opportunities.length ? 'Señales descriptivas, no causas ni significancia estadística. Los detalles no retenidos no se reconstruyen.' : 'Se requieren 20 intentos completos y maduros con disponibilidad no errónea, 5 afectados y al menos 30% con búsqueda vacía.',
      filter: { channel: p.channel ?? null, acquisitionLinkId: p.acquisitionLinkId ?? null, serviceId: p.serviceId ?? null, scope: 'independent_grains', unsupportedIntersections: true },
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 5000, timeout: 15000 })
}

function groupedObserved(cells: DailyMetricCell[], prefix: string, grain: Grain, key?: string) {
  const result = new Map<string, { population: Population; key: string; count: number }>()
  for (const c of cells.filter(c => c.grain === grain && (!key || c.dimensionKey === key) && c.metricKey.startsWith(prefix))) { const id = `${c.population}:${c.metricKey}`; const row = result.get(id) ?? { population: c.population, key: c.metricKey.slice(prefix.length), count: 0 }; row.count += c.numerator; result.set(id, row) }
  return [...result.values()]
}
