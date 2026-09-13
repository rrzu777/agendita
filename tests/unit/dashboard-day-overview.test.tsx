import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ next: vi.fn(), summary: vi.fn() }))
vi.mock('@/lib/auth/user', () => ({ getCurrentUserWithBusiness: async () => ({ user: { id: 'owner' }, role: 'owner', business: { id: 'business-1', name: 'Mi negocio', category: 'other', currency: 'CLP', timezone: 'America/Santiago', onboardingCompletedAt: new Date(), slug: 'negocio' } }) }))
vi.mock('@/lib/db', () => ({ prisma: {
  booking: { findFirst: mocks.next },
  service: { count: async () => 2 }, availabilityRule: { count: async () => 5 },
  paymentAccount: { count: async () => 0 }, packagePurchase: { count: async () => 0 },
} }))
vi.mock('@/server/actions/bookings', () => ({ getDashboardBookingSummary: mocks.summary }))
vi.mock('@/server/actions/ledger', () => ({ getFinancialSummary: async () => ({ incomeMonth: 42000 }) }))
vi.mock('@/components/dashboard/setup-checklist', () => ({ SetupChecklist: () => null }))
vi.mock('@/components/dashboard/tours/tour-invitation', () => ({ TourInvitation: () => null }))
vi.mock('@/components/dashboard/pending-transfers-banner', () => ({ PendingTransfersBanner: () => null }))
vi.mock('@/components/dashboard/pending-package-transfers-banner', () => ({ PendingPackageTransfersBanner: () => null }))
import DashboardPage from '@/app/dashboard/page'

describe('Cabina del día', () => {
  beforeEach(() => {
    mocks.next.mockReset().mockResolvedValue(null)
    mocks.summary.mockReset().mockResolvedValue({ today: 0, total: 123, pendingTransfers: 0, upcoming: [] })
  })

  it('shows a truthful empty next appointment and explicit metric windows', async () => {
    const html = renderToStaticMarkup(await DashboardPage())
    expect(html).toContain('Cabina del día')
    expect(html).toContain('No tienes citas por comenzar')
    expect(html).toContain('Incluye todos los estados')
    expect(html).toContain('Sin transferencias por verificar')
    expect(html).not.toContain('Próximas reservas</dt>')
  })

  it('fetches the next nonterminal appointment after the server clock, scoped to the business', async () => {
    mocks.next.mockResolvedValue({ id: 'b-next', startDateTime: new Date('2026-09-15T15:30:00Z'), status: 'confirmed', customer: { name: 'Ana' }, service: { name: 'Corte' }, serviceLines: [], payments: [] })
    const html = renderToStaticMarkup(await DashboardPage())
    expect(mocks.next).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ businessId: 'business-1', startDateTime: { gte: expect.any(Date) }, status: { in: ['confirmed', 'pending_payment', 'pending_confirmation'] } }) }))
    expect(html).toContain('Próxima cita')
    expect(html).toContain('Ana')
    expect(html).toContain('15 de septiembre')
    expect(html).toContain('view=day&amp;date=2026-09-15')
    const document = new DOMParser().parseFromString(html, 'text/html')
    expect(document.querySelector('a button, button a')).toBeNull()
  })
})
