import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { mockPrepareMiUser, mockBusinessFindUnique, mockCustomerFindMany, mockBookingFindMany, mockLoadCard, mockNotFound } = vi.hoisted(() => ({
  mockPrepareMiUser: vi.fn(),
  mockBusinessFindUnique: vi.fn(),
  mockCustomerFindMany: vi.fn(),
  mockBookingFindMany: vi.fn(),
  mockLoadCard: vi.fn(),
  mockNotFound: vi.fn(() => { throw new Error('NOT_FOUND') }),
}))

vi.mock('@/lib/auth/mi-user', () => ({ prepareMiUser: mockPrepareMiUser }))
vi.mock('@/lib/db', () => ({
  prisma: {
    business: { findUnique: mockBusinessFindUnique },
    customer: { findMany: mockCustomerFindMany },
    booking: { findMany: mockBookingFindMany },
  },
}))
vi.mock('@/lib/loyalty/card-data', () => ({ loadLoyaltyCardData: mockLoadCard }))
vi.mock('@/server/actions/loyalty', () => ({ redeemPointsAsMe: vi.fn() }))
vi.mock('@/server/actions/my-bookings', () => ({ cancelMyBooking: vi.fn() }))
vi.mock('next/navigation', () => ({ notFound: mockNotFound, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))

import MiBusinessPage from '@/app/mi/[slug]/page'

const business = {
  id: 'b1', name: 'Mimos Nails', slug: 'mimosnails', subdomain: 'mimosnails', logoUrl: null, selfServiceCutoffHours: 24,
  loyaltyConfig: { isActive: true, programName: 'Club', pointsLabel: 'mimos', cardMessage: null },
}
const cardData = {
  config: business.loyaltyConfig, balance: 50, history: [], catalog: [], grants: [], packages: [], pendingPackages: [], referralUrl: null,
}

describe('/mi/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NEXT_PUBLIC_APP_DOMAIN = 'agendita.test'
    process.env.APP_DOMAIN = 'agendita.test'
  })

  it('notFound si no hay Customer vinculado en el negocio (sin leak)', async () => {
    mockPrepareMiUser.mockResolvedValue({ status: 'ok', user: { id: 'u1' } })
    mockBusinessFindUnique.mockResolvedValue(business)
    mockCustomerFindMany.mockResolvedValue([])
    await expect(MiBusinessPage({ params: Promise.resolve({ slug: 'mimosnails' }) })).rejects.toThrow('NOT_FOUND')
  })

  it('renderiza tarjeta + próximas reservas + historial', async () => {
    mockPrepareMiUser.mockResolvedValue({ status: 'ok', user: { id: 'u1' } })
    mockBusinessFindUnique.mockResolvedValue(business)
    mockCustomerFindMany.mockResolvedValue([{ id: 'c1', name: 'Ana', businessId: 'b1', referralToken: null }])
    mockLoadCard.mockResolvedValue(cardData)
    const future = new Date(Date.now() + 86400000)
    mockBookingFindMany
      .mockResolvedValueOnce([
        { id: 'bk1', bookingNumber: 4738, startDateTime: future, status: 'confirmed', service: { name: 'Manicura' } },
      ])
      .mockResolvedValueOnce([])
    const html = renderToStaticMarkup(await MiBusinessPage({ params: Promise.resolve({ slug: 'mimosnails' }) }))
    expect(html).toContain('Mimos Nails')
    expect(html).toContain('Manicura')
    expect(html).toContain('4738')
    expect(html).toContain('Reservar')
  })
})
