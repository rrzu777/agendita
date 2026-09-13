import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DashboardPageHeader } from '@/components/dashboard/dashboard-page-header'
import { DashboardPanel } from '@/components/dashboard/dashboard-panel'
import { KpiStrip } from '@/components/dashboard/kpi-strip'

describe('owner page primitives', () => {
  it('keeps the heading, description and primary action together without nested controls', () => {
    const html = renderToStaticMarkup(<DashboardPageHeader title="Reservas" subtitle="Tus citas" action={<a href="/dashboard/bookings/new">Nueva reserva</a>} />)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(document.querySelector('header a')?.getAttribute('href')).toBe('/dashboard/bookings/new')
    expect(document.querySelector('h1')?.getAttribute('tabindex')).toBe('-1')
    expect(document.querySelector('header')?.textContent).toContain('Tus citas')
  })

  it('associates metric values with labels and definitions, distinguishing missing data from zero', () => {
    const html = renderToStaticMarkup(<KpiStrip label="Resumen" items={[
      { label: 'Reservas hoy', value: 0, description: 'Incluye todos los estados' },
      { label: 'Cobros del mes', value: null, description: 'Pagos aprobados' },
    ]} />)
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('dl')?.getAttribute('aria-label')).toBe('Resumen')
    expect([...document.querySelectorAll('dt')].map((node) => node.textContent)).toEqual(['Reservas hoy', 'Cobros del mes'])
    expect(document.querySelectorAll('dd')[0].textContent).toContain('0')
    expect(document.querySelectorAll('dd')[1].textContent).toContain('No disponible')
    expect(html).toContain('Incluye todos los estados')
  })

  it('names panels with their visible heading and keeps actions reachable', () => {
    const html = renderToStaticMarkup(<DashboardPanel title="Por resolver" action={<a href="/dashboard/bookings">Revisar reservas</a>}><p>No hay transferencias por verificar.</p></DashboardPanel>)
    const document = new DOMParser().parseFromString(html, 'text/html')
    const section = document.querySelector('section')!
    expect(document.getElementById(section.getAttribute('aria-labelledby')!)?.textContent).toBe('Por resolver')
    expect(section.querySelector('a')?.textContent).toBe('Revisar reservas')
  })
})
