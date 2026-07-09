import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetCurrentUserWithBusiness = vi.hoisted(() => vi.fn())
const mockGetCurrentSubscription = vi.hoisted(() => vi.fn())

vi.mock('@/lib/auth/user', () => ({
  getCurrentUserWithBusiness: mockGetCurrentUserWithBusiness,
}))

vi.mock('@/server/actions/subscriptions', () => ({
  getCurrentSubscription: mockGetCurrentSubscription,
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}))

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentUserWithBusiness.mockResolvedValue({
      user: { id: 'user-1' },
      business: { subscriptionStatus: 'active' },
    })
    mockGetCurrentSubscription.mockResolvedValue({
      subscription: {
        status: 'active',
        plan: { name: 'Plan Pro', priceMonthly: 19990, priceYearly: 0 },
        trialStartAt: null,
        trialEndAt: null,
        currentPeriodStart: new Date('2026-07-01T00:00:00Z'),
        currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
        interval: 'monthly',
      },
      payments: [
        {
          id: 'pay-1',
          amount: 19990,
          paymentMethod: 'Transferencia',
          status: 'approved',
          notes: null,
          paidAt: new Date('2026-07-01T00:00:00Z'),
          createdAt: new Date('2026-07-01T00:00:00Z'),
        },
      ],
    })
  })

  it('renders the payment history row with a StatusBadge and no raw legacy <table>', async () => {
    const { default: BillingPage } = await import('@/app/dashboard/billing/page')

    const html = renderToStaticMarkup(await BillingPage())

    expect(html).toContain('Transferencia')
    expect(html).toContain('$19.990')
    expect(html).toContain('Aprobado')
    // The unified Table primitive (src/components/ui/table.tsx) legitimately renders a
    // real <table data-slot="table" ...> for the desktop view — same as every other
    // already-migrated table (see ledger-table.tsx). What we actually want to rule out
    // is the old hand-rolled markup this page used before migration.
    expect(html).not.toContain('<table class="w-full text-sm">')
    expect(html).toContain('data-slot="table"')
  })
})
