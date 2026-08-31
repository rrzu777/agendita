import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { AnalyticsDashboard, buildMetricsHref } from '@/components/dashboard/analytics/analytics-dashboard'
import Loading from '@/app/dashboard/metricas/loading'
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { analyticsDashboardFixture as report } from '../helpers/analytics-dashboard-fixture'

describe('AnalyticsDashboard', () => {
  it('plots both complete attempts and their created bookings with a textual equivalent', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<AnalyticsDashboard report={report} />)
    expect(host.querySelector('svg[aria-label="Tendencia visual de intentos completos y sus reservas creadas"]')).not.toBeNull()
    expect(host.querySelectorAll('polyline[data-series="bookings"]')).toHaveLength(1)
    expect(host.querySelector('[aria-label="Tendencia diaria"]')?.textContent).toContain('Reservas creadas completas')
  })
  it('shows required separate populations, verified endpoint, quality partition and operational service attendance', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<AnalyticsDashboard report={{ ...report, complete: { ...report.complete, knownInterruptions: 4, measurementIncomplete: 2 } }} />)
    expect(host.textContent).toContain('67% · 2 de 3 intentos parciales')
    expect(host.textContent).toContain('Reservas creadas · entrada completa')
    expect(host.textContent).toContain('4 convertidos + 4 interrupciones conocidas + 2 con medición incompleta = 10 intentos maduros')
    expect(host.querySelector('[aria-label="Recorrido observado"]')?.textContent).toContain('Reserva verificada con recorrido completo3')
    expect(host.querySelector('[aria-label="Tendencia diaria"]')?.textContent).toContain('Reservas creadas completas')
    expect(host.querySelector('[aria-label="Servicios observados"]')?.textContent).toContain('Atendidas al consultar')
    expect(host.textContent).toContain('9 visitas · 6 intentos completos')
    expect(host.textContent).toContain('3 de 10 intentos con búsqueda')
    expect(host.textContent).toContain('Errores de disponibilidad: 1')
    expect(host.textContent).toContain('2 visitas recientes')
  })
  it('keeps verified path-incomplete conversions visible without any milestone rows', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<AnalyticsDashboard report={{ ...report, funnel: [] }} />)
    expect(host.textContent).toContain('Recorrido incompleto: 1 conversión')
  })
  it('offers labeled custom dates, independent-grain filters and an operable capture surface', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<AnalyticsDashboard report={report} />)
    expect(host.querySelector('input[type="date"][name="from"]')).not.toBeNull()
    expect(host.querySelector('input[type="date"][name="to"]')).not.toBeNull()
    expect(host.querySelector('[aria-label="Tipo de filtro histórico"]')).not.toBeNull()
    expect(host.textContent).toContain('Cerrar captura')
  })
  it('keeps an explicit range through the actual async page and rendered next-page link', async () => {
    vi.resetModules()
    vi.doMock('@/lib/auth/server', () => ({ requireBusinessRole: vi.fn().mockResolvedValue({}) }))
    vi.doMock('@/server/analytics/reports', () => ({ getOwnerAnalyticsReport: vi.fn().mockResolvedValue({ ...report, services: { ...report.services, total: 50 } }) }))
    vi.doMock('@/components/dashboard/header', () => ({ DashboardHeader: () => <header /> }))
    try {
      const Page = (await import('@/app/dashboard/metricas/page')).default
      const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({ from: report.period.from, to: report.period.to }) }))
      expect(markup).toContain('from=2026-08-01&amp;to=2026-08-29&amp;page=2')
      expect(markup).not.toContain('days=28&amp;page=2')
    } finally { vi.doUnmock('@/lib/auth/server'); vi.doUnmock('@/server/analytics/reports'); vi.doUnmock('@/components/dashboard/header') }
  })
  it('renders a route-local loading state', () => {
    expect(renderToStaticMarkup(<Loading />)).toContain('Cargando métricas')
  })
  it('shows observed conversion, incomplete measurement and an accessible daily trend table', () => {
    const markup = renderToStaticMarkup(<AnalyticsDashboard report={report} />)

    expect(markup).toContain('Conversión en 24 h')
    expect(markup).toContain('71% · 10 de 14 visitas llegan a intento')
    expect(markup).toContain('4 de 10 intentos')
    expect(markup).toContain('Sin señales adicionales.')
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
    expect(markup).toContain('Sin horarios: 4')
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

  it('passes implicit preset 28 from the actual async page when searchParams is empty', async () => {
    vi.resetModules()
    const requireBusinessRole = vi.fn().mockResolvedValue({})
    const getOwnerAnalyticsReport = vi.fn().mockResolvedValue(report)
    vi.doMock('@/lib/auth/server', () => ({ requireBusinessRole }))
    vi.doMock('@/server/analytics/reports', () => ({ getOwnerAnalyticsReport }))
    vi.doMock('@/components/dashboard/header', () => ({ DashboardHeader: () => <header /> }))
    vi.doMock('@/components/dashboard/analytics/analytics-dashboard', () => ({ AnalyticsDashboard: ({ periodMode }: { periodMode: { days: number | null } }) => <output data-period-days={String(periodMode.days)} /> }))
    const Page = (await import('@/app/dashboard/metricas/page')).default
    const markup = renderToStaticMarkup(await Page({ searchParams: Promise.resolve({}) }))

    expect(requireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
    expect(getOwnerAnalyticsReport).toHaveBeenCalledWith({})
    expect(markup).toContain('data-period-days="28"')
    vi.doUnmock('@/lib/auth/server'); vi.doUnmock('@/server/analytics/reports'); vi.doUnmock('@/components/dashboard/header'); vi.doUnmock('@/components/dashboard/analytics/analytics-dashboard')
  })

  it('orders the observed milestones semantically instead of relying on database row order', () => {
    const host = document.createElement('div')
    host.innerHTML = renderToStaticMarkup(<AnalyticsDashboard report={{ ...report, funnel: [...report.funnel].reverse() }} />)
    const markup = host.querySelector('[aria-label="Recorrido observado"]')!.textContent!

    expect(markup.indexOf('Inicio')).toBeLessThan(markup.indexOf('Servicio'))
    expect(markup.indexOf('Servicio')).toBeLessThan(markup.indexOf('Profesional (opcional)'))
    expect(markup.indexOf('Profesional (opcional)')).toBeLessThan(markup.indexOf('Fecha'))
    expect(markup.indexOf('Fecha')).toBeLessThan(markup.indexOf('Envío'))
  })
})

export { report as analyticsDashboardFixture }
