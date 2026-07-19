import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockPrisma = {
  business: { findUnique: vi.fn() },
  plan: { findMany: vi.fn() },
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/auth/user', () => ({
  getPlatformAdminUser: vi.fn().mockResolvedValue({ id: 'admin-1', email: 'admin@example.com' }),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('@/app/admin/businesses/[businessId]/admin-actions', () => ({
  AdminActions: () => <div>admin actions</div>,
}))

vi.mock('@/app/admin/businesses/[businessId]/copy-link-button', () => ({
  CopyLinkButton: () => <button>copiar</button>,
}))

describe('BusinessDetailPage (admin)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.plan.findMany.mockResolvedValue([])
    mockPrisma.business.findUnique.mockResolvedValue({
      id: 'biz-1',
      name: 'Salón Luna',
      slug: 'salon-luna',
      subdomain: null,
      city: 'Santiago',
      currency: 'CLP',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      trialEndsAt: null,
      subscriptionStatus: 'active',
      plan: { name: 'Plan Pro' },
      subscriptions: [],
      services: [],
      bookings: [
        {
          id: 'bk-1',
          status: 'confirmed',
          startDateTime: new Date('2026-07-05T14:00:00Z'),
          finalAmount: 15000,
          service: { name: 'Corte' },
          customer: { name: 'Maria Perez' },
        },
      ],
      payments: [
        {
          id: 'pay-1',
          createdAt: new Date('2026-07-01T00:00:00Z'),
          paymentType: 'subscription',
          provider: 'manual',
          amount: 19990,
        },
      ],
      subscriptionLogs: [],
      _count: { bookings: 1, customers: 1, payments: 1 },
    })
  })

  it('renders the booking row with a StatusBadge and no raw <table>', async () => {
    const { default: BusinessDetailPage } = await import('@/app/admin/businesses/[businessId]/page')

    const html = renderToStaticMarkup(
      await BusinessDetailPage({ params: Promise.resolve({ businessId: 'biz-1' }) })
    )

    expect(html).toContain('Maria Perez')
    expect(html).toContain('Confirmada')
    expect(html).toContain('$19.990')
    expect(html).not.toContain('<table class="w-full text-sm">')
    expect(html).toContain('data-slot="table"')
  })
})
