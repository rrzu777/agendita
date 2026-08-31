import { describe, expect, it, vi } from 'vitest'

const business = vi.hoisted(() => ({ id: 'biz-a', slug: 'salon', subdomain: 'salon' }))
const tenant = vi.hoisted(() => vi.fn().mockResolvedValue(null))
vi.mock('@/lib/business/public', () => ({ getPublicBusinessBySlug: async () => business, getPublicBusinessBySubdomain: async () => business }))
vi.mock('@/lib/tenant/resolver', () => ({ getTenantFromRequest: tenant }))
vi.mock('@/lib/db', () => ({ prisma: { packageProduct: { count: async () => 0 }, customer: { findFirst: async () => null } } }))
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: async () => null }))
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('404') }, redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))
import ProfilePage from '@/app/b/[slug]/page'
import HomePage from '@/app/page'

describe('profile acquisition navigation contracts', () => {
  it('path-based profile carries acquisition and referral in the booking CTA and login alias', async () => {
    tenant.mockResolvedValue(null)
    const page = await ProfilePage({ params: Promise.resolve({ slug: 'salon' }), searchParams: Promise.resolve({ acq: 'abcdefghijklmnopqrstuv', ref: '74d2b4a1-c53a-41d5-a145-5318f1d2d382' }) })
    expect(page.props.bookingHref).toBe('/book/salon?ref=74d2b4a1-c53a-41d5-a145-5318f1d2d382&acq=abcdefghijklmnopqrstuv')
    expect(decodeURIComponent(page.props.accountCta.href)).toContain('/ir/salon?ref=74d2b4a1-c53a-41d5-a145-5318f1d2d382&acq=abcdefghijklmnopqrstuv')
  })
  it('subdomain profile carries acquisition to /book', async () => {
    tenant.mockResolvedValue({ slug: 'salon', subdomain: 'salon' })
    const page = await HomePage({ searchParams: Promise.resolve({ acq: 'abcdefghijklmnopqrstuv' }) })
    expect(page.props.bookingHref).toBe('/book?acq=abcdefghijklmnopqrstuv')
  })
})
