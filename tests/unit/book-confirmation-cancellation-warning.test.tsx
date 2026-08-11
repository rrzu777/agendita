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

function booking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    businessId: 'biz1',
    status: 'confirmed',
    paymentMethod: null,
    paymentStatus: 'deposit_paid',
    holdExpiresAt: null,
    approvalExpiresAt: null,
    bookingNumber: 4738,
    startDateTime: new Date('2026-07-20T15:00:00Z'),
    endDateTime: new Date('2026-07-20T16:00:00Z'),
    finalAmount: 20_000,
    depositPaid: 5_000,
    depositRequired: 5_000,
    remainingBalance: 15_000,
    cancellationCutoffHours: 24,
    cancellationPolicySnapshot: 'Condiciones aceptadas',
    modality: 'on_site',
    serviceAddress: null,
    meetingUrl: null,
    business: {
      name: 'Salón Ana',
      slug: 'salon-ana',
      subdomain: null,
      timezone: 'America/Santiago',
      currency: 'CLP',
      addressText: null,
      whatsapp: null,
      selfServiceCutoffHours: 72,
      cancellationPolicy: 'Condiciones actuales',
    },
    service: { name: 'Manicure' },
    customer: { email: 'maria@example.com' },
    payments: [],
    ...overrides,
  }
}

describe('/book/confirmation cancellation warning', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetCurrentUser.mockResolvedValue(null)
    mockGetTenant.mockResolvedValue(null)
    mockGetBankTransferInfo.mockResolvedValue(null)
  })

  it('usa el cutoff persistido aunque la configuración actual sea distinta', async () => {
    mockFindUnique.mockResolvedValue(booking())
    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))

    const warning = 'Podés cancelar o reprogramar hasta 24 horas antes. Con menos anticipación, el abono no se devuelve. Para cancelaciones anteriores aplica la política del negocio.'
    expect(html).toContain(warning)
    expect(html).not.toContain('hasta 72 horas antes')
    expect(html).toContain('Condiciones aceptadas')
    expect(html.indexOf(warning)).toBeLessThan(html.indexOf('Condiciones aceptadas'))
    expect(html).not.toContain('Condiciones actuales')
  })

  it('una reserva legacy con cutoff null usa la configuración actual', async () => {
    mockFindUnique.mockResolvedValue(booking({ cancellationCutoffHours: null }))
    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))

    expect(html).toContain('hasta 72 horas antes')
    expect(html).toContain('Condiciones actuales')
    expect(html).not.toContain('Condiciones aceptadas')
  })

  it('sin abono requerido ni pagado no muestra el warning', async () => {
    mockFindUnique.mockResolvedValue(booking({ depositRequired: 0, depositPaid: 0 }))
    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))

    expect(html).not.toContain('el abono no se devuelve')
    expect(html).toContain('Condiciones aceptadas')
  })

  it('con cutoff cero no muestra el warning', async () => {
    mockFindUnique.mockResolvedValue(booking({ cancellationCutoffHours: 0 }))
    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))

    expect(html).not.toContain('el abono no se devuelve')
  })

  it('una proyección sin snapshot falla cerrado y nunca renderiza undefined horas', async () => {
    const incomplete = booking()
    delete (incomplete as Partial<typeof incomplete>).cancellationCutoffHours
    mockFindUnique.mockResolvedValue(incomplete)

    await expect(BookingConfirmationPage({ searchParams })).rejects.toThrow(/cancellationCutoffHours/)
  })
})
