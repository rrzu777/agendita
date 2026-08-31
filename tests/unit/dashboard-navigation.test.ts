import { describe, expect, it } from 'vitest'
import { getDashboardNavItems, isDashboardNavItemActive } from '@/lib/dashboard/navigation'

const vocabulary = { Professionals: 'Profesionales', Clients: 'Clientes' } as never

describe('dashboard navigation registry', () => {
  it('keeps settings and billing out of staff navigation', () => {
    const hrefs = getDashboardNavItems(vocabulary, 'staff').map((item) => item.href)
    expect(hrefs).not.toContain('/dashboard/settings')
    expect(hrefs).not.toContain('/dashboard/billing')
    expect(hrefs).not.toContain('/dashboard/metricas')
    expect(hrefs).toContain('/dashboard/bookings')
    expect(hrefs).toContain('/dashboard/calendar')
  })

  it('exposes every destination to owner and admin', () => {
    for (const role of ['owner', 'admin'] as const) {
      const hrefs = getDashboardNavItems(vocabulary, role).map((item) => item.href)
      expect(hrefs).toHaveLength(16)
      expect(hrefs).toContain('/dashboard/metricas')
    }
  })

  it('marks descendants active without marking dashboard for every route', () => {
    const [summary, bookings] = getDashboardNavItems(vocabulary, 'owner')
    expect(isDashboardNavItemActive(summary, '/dashboard/bookings')).toBe(false)
    expect(isDashboardNavItemActive(bookings, '/dashboard/bookings/new')).toBe(true)
  })
})
