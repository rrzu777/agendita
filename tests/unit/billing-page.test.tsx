import { describe, expect, it, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const mockGetCurrentSubscription = vi.hoisted(() => vi.fn())
const mockRequireSettingsPageAccess = vi.hoisted(() => vi.fn())
const mockRedirect = vi.hoisted(() => vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) }))

vi.mock('@/lib/business/settings-access', () => ({
  requireSettingsPageAccess: mockRequireSettingsPageAccess,
}))

vi.mock('@/server/actions/subscriptions', () => ({
  getCurrentSubscription: mockGetCurrentSubscription,
  startSubscriptionAction: vi.fn(),
  cancelSubscriptionAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mockRedirect,
}))

describe('BillingPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireSettingsPageAccess.mockResolvedValue({
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

  it('redirects staff before querying subscription data', async () => {
    mockRequireSettingsPageAccess.mockImplementation(async () => mockRedirect('/dashboard'))
    const { default: BillingPage } = await import('@/app/dashboard/billing/page')

    await expect(BillingPage()).rejects.toThrow('REDIRECT:/dashboard')
    expect(mockGetCurrentSubscription).not.toHaveBeenCalled()
  })
})
