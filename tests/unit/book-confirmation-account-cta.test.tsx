import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

const { mockGetCurrentUser, mockFindUnique, mockGetTenant, mockGetBankTransferInfo, mockNotFound } = vi.hoisted(() => ({
  mockGetCurrentUser: vi.fn(),
  mockFindUnique: vi.fn(),
  mockGetTenant: vi.fn(),
  mockGetBankTransferInfo: vi.fn(),
  mockNotFound: vi.fn(() => { throw new Error('NOT_FOUND') }),
}))

vi.mock('@/lib/auth/user', () => ({ getCurrentUser: mockGetCurrentUser }))
vi.mock('@/lib/db', () => ({ prisma: { booking: { findUnique: mockFindUnique } } }))
vi.mock('@/lib/tenant/resolver', () => ({ getTenantFromRequest: mockGetTenant }))
vi.mock('@/server/actions/bank-transfer-public', () => ({ getBankTransferInfo: mockGetBankTransferInfo }))
vi.mock('next/navigation', () => ({
  notFound: mockNotFound,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

import BookingConfirmationPage from '@/app/book/confirmation/page'

const searchParams = Promise.resolve({ bookingId: 'b1' })

function baseBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    businessId: 'biz1',
    status: 'confirmed',
    paymentMethod: null,
    holdExpiresAt: null,
    bookingNumber: 4738,
    startDateTime: new Date('2026-07-20T15:00:00Z'),
    finalAmount: 20000,
    depositPaid: 20000,
    depositRequired: 20000,
    remainingBalance: 0,
    business: { name: 'Salón Ana', slug: 'salon-ana', subdomain: null, timezone: 'America/Santiago' },
    service: { name: 'Manicure' },
    customer: { email: 'maria@example.com' },
    payments: [],
    ...overrides,
  }
}

describe('/book/confirmation — CTA de cuenta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetTenant.mockResolvedValue(null)
    mockGetBankTransferInfo.mockResolvedValue(null)
  })

  it('confirmada, sin sesión, con email de cliente → invita a crear cuenta', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockFindUnique.mockResolvedValue(baseBooking())
    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))
    expect(html).toContain('Crea tu cuenta')
    expect(html).toContain('maria@example.com')
    expect(html).toContain('/ingresar?next=/mi')
  })

  it('con transferencia pendiente declarable (canDeclare) → NO muestra el CTA de cuenta', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockFindUnique.mockResolvedValue(baseBooking({
      status: 'pending',
      paymentMethod: 'bank_transfer',
      holdExpiresAt: new Date(Date.now() + 3_600_000),
      depositPaid: 0,
    }))
    mockGetBankTransferInfo.mockResolvedValue({
      bankName: 'Banco X', accountType: 'Cuenta corriente', accountNumber: '123', rut: '1-9', holderName: 'Ana',
    })
    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))
    expect(html).not.toContain('Crea tu cuenta')
    expect(html).not.toContain('Ver mis reservas')
  })

  it('sin email de cliente → no muestra ningún CTA de cuenta', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockFindUnique.mockResolvedValue(baseBooking({ customer: { email: null } }))
    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))
    expect(html).not.toContain('Crea tu cuenta')
    expect(html).not.toContain('/ingresar')
  })

  it('con sesión → "Ver mis reservas" hacia /mi', async () => {
    mockGetCurrentUser.mockResolvedValue({ id: 'u1', email: 'maria@example.com' })
    mockFindUnique.mockResolvedValue(baseBooking())
    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))
    expect(html).toContain('Ver mis reservas')
    expect(html).toContain('href="/mi"')
    expect(html).not.toContain('Crea tu cuenta')
  })
})
