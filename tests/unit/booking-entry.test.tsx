import { beforeEach, describe, expect, it, vi } from 'vitest'

const deps = vi.hoisted(() => ({ business: vi.fn(), tenant: vi.fn(), session: vi.fn() }))
vi.mock('next/navigation', () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`) },
  notFound: () => { throw new Error('not-found') },
}))
vi.mock('@/lib/business/public', () => ({ getBookingBusinessBySlug: deps.business }))
vi.mock('@/lib/tenant/resolver', () => ({ getTenantFromRequest: deps.tenant }))
vi.mock('@/lib/customers/session-prefill', () => ({ getFunnelSession: deps.session }))
vi.mock('@/components/booking/booking-business-page', () => ({ BookingBusinessPage: () => null }))
vi.mock('@/components/analytics/public-analytics', () => ({ PublicAnalytics: () => null }))
vi.mock('@/lib/analytics/public-context', () => ({ isPublicAnalyticsEligible: async () => false }))
vi.mock('@/lib/analytics/budget', () => ({ getConfiguredAnalyticsConsentVersion: () => 1 }))

import BookPage from '@/app/book/[slug]/page'

describe('booking entry origin', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_APP_DOMAIN', 'www.agendita.test')
    deps.tenant.mockResolvedValue(null)
    deps.business.mockResolvedValue({ id: 'b1', slug: 'mimos', subdomain: 'mimos', timezone: 'America/Santiago' })
    deps.session.mockResolvedValue(null)
  })
  it('redirects before creating a draft so login returns to the same storage origin', async () => {
    await expect(BookPage({ params: Promise.resolve({ slug: 'mimos' }), searchParams: Promise.resolve({ professional: 'ana', email: 'secret@example.test' }) }))
      .rejects.toThrow('redirect:https://mimos.agendita.test/book?professional=ana')
  })
  it('keeps path booking available when no subdomain is configured', async () => {
    deps.business.mockResolvedValue({ id: 'b1', slug: 'mimos', subdomain: null, timezone: 'America/Santiago' })
    await expect(BookPage({ params: Promise.resolve({ slug: 'mimos' }), searchParams: Promise.resolve({}) })).resolves.toBeDefined()
  })
  it('does not navigate to another business through a tenant slug mismatch', async () => {
    deps.tenant.mockResolvedValue({ slug: 'other' })
    await expect(BookPage({ params: Promise.resolve({ slug: 'mimos' }), searchParams: Promise.resolve({}) })).rejects.toThrow('not-found')
  })
})
