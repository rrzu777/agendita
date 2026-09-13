import { describe, expect, it } from 'vitest'
import { getDashboardNavGroups, getDashboardNavItems, isDashboardNavGroupActive, isDashboardNavItemActive } from '@/lib/dashboard/navigation'
import { SETTINGS_SECTIONS } from '@/lib/business/settings-navigation'

const vocabulary = { Professionals: 'Profesionales', Clients: 'Clientes' } as never

describe('dashboard navigation registry', () => {
  it('presents eight stable destinations and keeps nested routes in their owning group', () => {
    const groups = getDashboardNavGroups(vocabulary, 'owner')

    expect(groups.map((group) => group.label)).toEqual([
      'Hoy', 'Calendario', 'Reservas', 'Clientes',
      'Catálogo', 'Crecimiento', 'Finanzas', 'Configuración',
    ])
    expect(groups.find((group) => group.label === 'Catálogo')?.items.map((item) => item.href)).toEqual([
      '/dashboard/services', '/dashboard/equipo', '/dashboard/availability',
    ])
    expect(groups.find((group) => group.label === 'Crecimiento')?.items.map((item) => item.href)).toEqual([
      '/dashboard/metricas', '/dashboard/promociones', '/dashboard/fidelizacion',
      '/dashboard/campanas', '/dashboard/paquetes', '/dashboard/reviews',
    ])
    expect(groups.find((group) => group.label === 'Configuración')?.items.map(({ href, label }) => ({ href, label }))).toEqual(
      SETTINGS_SECTIONS.map(({ href, label }) => ({ href, label })),
    )
  })

  it('keeps settings and billing out of staff navigation', () => {
    const hrefs = getDashboardNavItems(vocabulary, 'staff').map((item) => item.href)
    expect(hrefs).not.toContain('/dashboard/settings/profile')
    expect(hrefs).not.toContain('/dashboard/settings/reservations')
    expect(hrefs).not.toContain('/dashboard/settings/policies')
    expect(hrefs).not.toContain('/dashboard/settings/payments')
    expect(hrefs).not.toContain('/dashboard/billing')
    expect(hrefs).not.toContain('/dashboard/metricas')
    expect(hrefs).toContain('/dashboard/bookings')
    expect(hrefs).toContain('/dashboard/calendar')
  })

  it('exposes every destination to owner and admin', () => {
    for (const role of ['owner', 'admin'] as const) {
      const hrefs = getDashboardNavItems(vocabulary, role).map((item) => item.href)
      expect(hrefs).toHaveLength(19)
      expect(hrefs).toContain('/dashboard/metricas')
      expect(hrefs).toContain('/dashboard/settings/profile')
      expect(hrefs).toContain('/dashboard/settings/payments')
    }
  })

  it('marks descendants active without marking dashboard for every route', () => {
    const [summary, bookings] = getDashboardNavItems(vocabulary, 'owner')
    expect(isDashboardNavItemActive(summary, '/dashboard/bookings')).toBe(false)
    expect(isDashboardNavItemActive(bookings, '/dashboard/bookings/new')).toBe(true)
  })

  it('marks the owning group active for nested destinations', () => {
    const groups = getDashboardNavGroups(vocabulary, 'owner')
    const growth = groups.find((group) => group.label === 'Crecimiento')!
    const catalogue = groups.find((group) => group.label === 'Catálogo')!

    expect(isDashboardNavGroupActive(growth, '/dashboard/campanas/campaign-1')).toBe(true)
    expect(isDashboardNavGroupActive(catalogue, '/dashboard/campanas')).toBe(false)
  })
})
