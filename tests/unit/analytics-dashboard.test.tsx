import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AnalyticsDashboard, buildMetricsHref } from '@/components/dashboard/analytics/analytics-dashboard'
import Loading from '@/app/dashboard/metricas/loading'
import type { OwnerAnalyticsReport } from '@/server/analytics/reports'

const report = {
  definitionVersion: 1,
  period: { from: '2026-08-01', to: '2026-08-29', timezone: 'America/Santiago', cutoffAt: '2026-08-29T00:00:00.000Z', previousFrom: '2026-07-04', previousTo: '2026-08-01' },
  capture: { enabled: true, collectionOpen: true, activatedAt: '2026-08-01T00:00:00.000Z', status: 'enabled' },
  coverage: { status: 'complete', cohorts: [], warnings: [] },
  visits: 14,
  visitToAttempt: { numerator: 10, denominator: 14, rate: 10 / 14 },
  complete: { attempts: 10, conversion: { numerator: 4, denominator: 10, rate: 0.4 }, bookingsCreated: 5, pathComplete: 3, pathIncomplete: 1, knownInterruptions: 2, measurementIncomplete: 1, availabilityEmpty: { numerator: 3, denominator: 10, rate: 0.3 }, availabilityErrors: 1 },
  partial: { attempts: 3, conversion: { numerator: 2, denominator: 3, rate: 2 / 3 }, bookingsCreated: 2, pathComplete: 1, pathIncomplete: 1, knownInterruptions: 0, measurementIncomplete: 1, availabilityEmpty: { numerator: 0, denominator: 0, rate: null }, availabilityErrors: 0 },
  comparison: { status: 'comparable', deltaPercentagePoints: 5, previousConversion: { numerator: 3, denominator: 10, rate: 0.3 } },
  recent: { visits: 2, visitToAttempt: { numerator: 1, denominator: 2, rate: 0.5 }, complete: { attempts: 1, conversion: { numerator: 0, denominator: 0, rate: null }, bookingsCreated: 0, pathComplete: 0, pathIncomplete: 0, knownInterruptions: 0, measurementIncomplete: 0, availabilityEmpty: { numerator: 0, denominator: 0, rate: null }, availabilityErrors: 0 }, partial: { attempts: 0, conversion: { numerator: 0, denominator: 0, rate: null }, bookingsCreated: 0, pathComplete: 0, pathIncomplete: 0, knownInterruptions: 0, measurementIncomplete: 0, availabilityEmpty: { numerator: 0, denominator: 0, rate: null }, availabilityErrors: 0 }, status: 'provisional', from: '2026-08-28', to: '2026-08-30', cutoffAt: '2026-08-29T12:00:00.000Z', timezones: ['America/Santiago'], inProgress: { complete: 1, partial: 0 } },
  suppression: { applied: false, note: 'No aplica.' },
  trend: [{ date: '2026-08-28', timezone: 'America/Santiago', complete: { attempts: 10, conversion: { numerator: 4, denominator: 10, rate: 0.4 }, bookingsCreated: 5, pathComplete: 3, pathIncomplete: 1, knownInterruptions: 2, measurementIncomplete: 1, availabilityEmpty: { numerator: 3, denominator: 10, rate: 0.3 }, availabilityErrors: 1 }, partial: { attempts: 3, conversion: { numerator: 2, denominator: 3, rate: 2 / 3 }, bookingsCreated: 2, pathComplete: 1, pathIncomplete: 1, knownInterruptions: 0, measurementIncomplete: 1, availabilityEmpty: { numerator: 0, denominator: 0, rate: null }, availabilityErrors: 0 }, visits: 14 }],
  funnel: [{ population: 'complete_attempts', milestone: 'started', count: 10 }, { population: 'complete_attempts', milestone: 'service', count: 9 }, { population: 'complete_attempts', milestone: 'professional', count: 6 }, { population: 'complete_attempts', milestone: 'date', count: 7 }, { population: 'complete_attempts', milestone: 'time', count: 6 }, { population: 'complete_attempts', milestone: 'customer', count: 5 }, { population: 'complete_attempts', milestone: 'payment', count: 4 }, { population: 'complete_attempts', milestone: 'submit', count: 3 }],
  quality: [{ population: 'complete_attempts', lastStep: 'payment', count: 2 }],
  services: { rows: [{ id: 'svc-1', label: 'Manicure', population: 'complete_attempts', interest: 9, selected: 8, conversion: { numerator: 4, denominator: 8, rate: 0.5 }, unobservedConversions: 1 }], page: 1, pageSize: 25, total: 1 },
  channels: { rows: [{ id: 'instagram', summary: { visits: 9, visitToAttempt: { numerator: 6, denominator: 9, rate: 2 / 3 }, complete: { attempts: 6, conversion: { numerator: 2, denominator: 6, rate: 1 / 3 }, bookingsCreated: 2, pathComplete: 1, pathIncomplete: 1, knownInterruptions: 0, measurementIncomplete: 0, availabilityEmpty: { numerator: 0, denominator: 0, rate: null }, availabilityErrors: 0 }, partial: { attempts: 0, conversion: { numerator: 0, denominator: 0, rate: null }, bookingsCreated: 0, pathComplete: 0, pathIncomplete: 0, knownInterruptions: 0, measurementIncomplete: 0, availabilityEmpty: { numerator: 0, denominator: 0, rate: null }, availabilityErrors: 0 } } }], scope: 'independent_grain' },
  links: { rows: [], page: 1, pageSize: 25, total: 0 },
  acquisitionLinks: { rows: [{ id: 'link-1', channel: 'instagram', campaignName: 'Lanzamiento', promotionId: null, createdAt: '2026-08-01T00:00:00.000Z', archivedAt: null, url: 'https://example.test/book?acq=token' }], page: 1, pageSize: 25, total: 1 },
  currentBookings: { label: 'estado al consultar', scope: 'all_bookings_created_in_period', counts: [{ status: 'pending_confirmation', count: 2 }], overdueApproval: { count: 1, lowerBound: false }, attendedByService: [{ serviceId: 'svc-1', count: 1 }] },
  redemptions: { label: 'canjes al consultar', scope: 'all_redemptions_created_in_period', rows: [], page: 1, pageSize: 25, hasMore: false },
  opportunities: [],
  opportunityNote: 'Sin señales adicionales.',
  filter: { channel: null, acquisitionLinkId: null, serviceId: null, scope: 'independent_grains', unsupportedIntersections: true },
} satisfies OwnerAnalyticsReport

describe('AnalyticsDashboard', () => {
  it('renders a route-local loading state', () => {
    expect(renderToStaticMarkup(<Loading />)).toContain('Cargando métricas')
  })
  it('shows observed conversion, incomplete measurement and an accessible daily trend table', () => {
    const markup = renderToStaticMarkup(<AnalyticsDashboard report={report} />)

    expect(markup).toContain('Conversión en 24 h')
    expect(markup).toContain('71% · 10 de 14 visitas llegan a intento')
    expect(markup).toContain('4 de 10 intentos')
    expect(markup).toContain('Pendiente de confirmación: 2')
    expect(markup).toContain('Entrada completa')
    expect(markup).toContain('Pago')
    expect(markup).not.toContain('>payment<')
    expect(markup).toContain('Recorrido incompleto')
    expect(markup).toContain('<table')
    expect(markup).toContain('aria-label="Tendencia diaria"')
    expect(markup).toContain('+5 puntos porcentuales')
    expect(markup).toContain('aún no entran al denominador maduro')
  })

  it('labels unavailable reports instead of showing a zero-valued graph', () => {
    const markup = renderToStaticMarkup(<AnalyticsDashboard report={{ ...report, coverage: { ...report.coverage, status: 'unavailable' }, recent: { ...report.recent, status: 'unavailable' } }} />)

    expect(markup).toContain('Datos no disponibles')
    expect(markup).not.toContain('0 de 0 intentos')
  })

  it('does not present an inverted recent range as an active period', () => {
    const markup = renderToStaticMarkup(<AnalyticsDashboard report={{ ...report, recent: { ...report.recent, from: '2026-08-29', to: '2026-08-02' } }} />)

    expect(markup).toContain('No hay días recientes aplicables')
    expect(markup).not.toContain('Período reciente en curso')
  })

  it('identifies the population of each repeated last step and makes the selected scope explicit', () => {
    const markup = renderToStaticMarkup(<AnalyticsDashboard report={{ ...report, filter: { ...report.filter, channel: 'instagram' }, quality: [{ population: 'complete_attempts', lastStep: 'payment', count: 4 }, { population: 'partial_attempts', lastStep: 'payment', count: 2 }] }} />)

    expect(markup).toContain('Pago · entrada completa')
    expect(markup).toContain('Pago · entrada parcial')
    expect(markup).toContain('Período seleccionado: 2026-08-01 a 2026-08-29')
    expect(markup).toContain('Filtro activo: Canal: instagram')
    expect(markup).toContain('Zona: America/Santiago')
  })

  it('keeps operational states and diagnostic opportunities when mature metrics are absent', () => {
    const markup = renderToStaticMarkup(<AnalyticsDashboard report={{ ...report, visits: 0, complete: { ...report.complete, attempts: 0 }, partial: { ...report.partial, attempts: 0 }, coverage: { ...report.coverage, status: 'disabled' }, currentBookings: { ...report.currentBookings, counts: [{ status: 'pending_confirmation', count: 3 }], overdueApproval: { count: 3, lowerBound: false } }, opportunities: [{ key: 'overdue_approval', numerator: 3, denominator: null, rate: null, href: '/dashboard/bookings', message: 'Hay aprobaciones vencidas.', diagnostics: { status: 'not_applicable', reasons: {}, converted: null } }, { key: 'availability_empty', numerator: 6, denominator: 20, rate: 0.3, href: '/dashboard/availability', message: 'Hay búsquedas sin horarios.', diagnostics: { status: 'available', reasons: { no_slots: 4 }, converted: 2 } }] }} />)

    expect(markup).toContain('Aún no hay datos maduros')
    expect(markup).toContain('Pendiente de confirmación: 3')
    expect(markup).toContain('Hay aprobaciones vencidas.')
    expect(markup).toContain('6 de 20')
    expect(markup).toContain('no_slots: 4')
    expect(markup).toContain('2 con conversión')
  })

  it('shows a missing middle cohort as a coverage discontinuity', () => {
    const markup = renderToStaticMarkup(<AnalyticsDashboard report={{ ...report, coverage: { ...report.coverage, status: 'partial', cohorts: [{ date: '2026-08-01', timezone: 'America/Santiago', version: 1, coverage: 'complete', state: 'closed', frozen: true, calculatedAt: '2026-08-02T00:00:00.000Z' }, { date: '2026-08-02', timezone: 'America/Santiago', version: 1, coverage: 'unknown', state: 'unavailable', frozen: false, calculatedAt: null }, { date: '2026-08-03', timezone: 'America/Santiago', version: 1, coverage: 'complete', state: 'closed', frozen: true, calculatedAt: '2026-08-04T00:00:00.000Z' }] }, trend: [{ ...report.trend[0], date: '2026-08-01' }, { ...report.trend[0], date: '2026-08-03' }] }} />)

    expect(markup).toContain('Cobertura por cohorte')
    expect(markup).toContain('2026-08-02')
    expect(markup).toContain('No disponible')
    expect(markup).toContain('Discontinuidades de cobertura')
    expect(markup).toContain('data-segments="2"')
  })

  it('preserves preset mode across pages and uses explicit dates only for an explicit range', () => {
    expect(buildMetricsHref(report, { days: 7 }, 2)).toContain('days=7&page=2')
    expect(buildMetricsHref(report, { days: 28 }, 2)).toContain('days=28&page=2')
    expect(buildMetricsHref(report, { days: 90 }, 2)).toContain('days=90&page=2')
    expect(buildMetricsHref(report, { days: null }, 2)).toContain('from=2026-08-01&to=2026-08-29&page=2')
  })

  it('orders the observed milestones semantically instead of relying on database row order', () => {
    const markup = renderToStaticMarkup(<AnalyticsDashboard report={{ ...report, funnel: [...report.funnel].reverse() }} />)

    expect(markup.indexOf('Inicio')).toBeLessThan(markup.indexOf('Servicio'))
    expect(markup.indexOf('Servicio')).toBeLessThan(markup.indexOf('Profesional (opcional)'))
    expect(markup.indexOf('Profesional (opcional)')).toBeLessThan(markup.indexOf('Fecha'))
    expect(markup.indexOf('Fecha')).toBeLessThan(markup.indexOf('Envío'))
  })
})

export { report as analyticsDashboardFixture }
