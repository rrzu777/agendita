import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

import BookingConfirmationPage, { generateViewport } from '@/app/book/confirmation/page'

const searchParams = Promise.resolve({ bookingId: 'b1' })

function baseBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    businessId: 'biz1',
    status: 'confirmed',
    paymentMethod: null,
    paymentStatus: 'unpaid',
    holdExpiresAt: null,
    approvalExpiresAt: null,
    bookingNumber: 4738,
    startDateTime: new Date('2026-07-20T15:00:00Z'),
    endDateTime: new Date('2026-07-20T16:00:00Z'),
    finalAmount: 20000,
    depositPaid: 20000,
    depositRequired: 20000,
    remainingBalance: 0,
    cancellationCutoffHours: 24,
    cancellationPolicySnapshot: null,
    modality: 'on_site',
    serviceAddress: null,
    meetingUrl: null,
    business: {
      name: 'Salón Ana', slug: 'salon-ana', subdomain: null, timezone: 'America/Santiago',
      selfServiceCutoffHours: 24, cancellationPolicy: null,
    },
    service: { name: 'Manicure' },
    customer: { email: 'maria@example.com' },
    payments: [],
    ...overrides,
  }
}

describe('/book/confirmation — CTA de cuenta', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_APP_DOMAIN', 'www.agendita.cl')
    mockGetTenant.mockResolvedValue(null)
    mockGetBankTransferInfo.mockResolvedValue(null)
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('usa el color real del tenant en el chrome del retorno de pago', async () => {
    mockFindUnique.mockResolvedValue(baseBooking({ business: { ...baseBooking().business, brandColor: '#35524A' } }))
    await expect(generateViewport({ searchParams })).resolves.toEqual({ themeColor: '#35524A' })
  })

  it('usa un color neutral si no puede resolver el tenant del retorno', async () => {
    mockFindUnique.mockRejectedValueOnce(new Error('db unavailable'))
    await expect(generateViewport({ searchParams })).resolves.toEqual({ themeColor: '#f7f7f4' })
  })

  it.each([
    ['success', { status: 'confirmed' }, 'Reserva confirmada'],
    ['verifying', { status: 'pending_payment', holdExpiresAt: new Date(Date.now() + 3_600_000), depositPaid: 0, remainingBalance: 20000, payments: [{ status: 'pending', provider: 'mercado_pago', providerPaymentId: 'mp-1', amount: 20000, proofKey: null }] }, 'Verificando tu pago'],
    ['rejected', { status: 'pending_payment', holdExpiresAt: new Date(Date.now() + 3_600_000), depositPaid: 0, remainingBalance: 20000, payments: [{ status: 'rejected', provider: 'mercado_pago', providerPaymentId: 'mp-1', amount: 20000, proofKey: null }] }, 'Pago no aprobado'],
    ['pending', { status: 'pending_payment', holdExpiresAt: new Date(Date.now() + 3_600_000), depositPaid: 0 }, 'Reserva pendiente de pago'],
    ['expired', { status: 'expired', depositPaid: 0 }, 'Tu reserva expiró'],
    ['cancelled', { status: 'cancelled', depositPaid: 0 }, 'Reserva cancelada'],
  ])('mantiene identidad, progreso y estado observable en %s', async (_state, overrides, title) => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockFindUnique.mockResolvedValue(baseBooking(overrides))

    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))

    expect(html).toContain('Salón Ana')
    expect(html).toContain('Paso 6 de 6')
    expect(html).toContain(title)
  })

  it('ofrece un reintento explícito después de un pago rechazado', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockFindUnique.mockResolvedValue(baseBooking({
      status: 'pending_payment',
      holdExpiresAt: new Date(Date.now() + 3_600_000),
      depositPaid: 0,
      remainingBalance: 20000,
      payments: [{ status: 'rejected', provider: 'mercado_pago', providerPaymentId: 'mp-1', amount: 20000, proofKey: null }],
    }))

    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))
    expect(html).toContain('Intentar de nuevo')
    expect(html).toContain('href="/book/salon-ana"')
  })

  it('confirmada, sin sesión, con email de cliente → invita a crear cuenta', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockFindUnique.mockResolvedValue(baseBooking())
    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))
    expect(html).toContain('Crea tu cuenta')
    expect(html).toContain('maria@example.com')
    expect(html).toContain('/ingresar?next=/mi')
    expect(html).toContain('Salón Ana')
    expect(html).toContain('Paso 6 de 6')
    expect(html).not.toContain('confirmación por WhatsApp')
  })

  it('con transferencia pendiente declarable (canDeclare) → NO muestra el CTA de cuenta', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockFindUnique.mockResolvedValue(baseBooking({
      status: 'pending',
      paymentMethod: 'bank_transfer',
      // Futuro relativo en las DOS: declarar exige plazo vivo, y desde
      // holdDeadlinePromise el plazo tampoco sobrevive a la cita.
      startDateTime: new Date(Date.now() + 3_600_000),
      endDateTime: new Date(Date.now() + 7_200_000),
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

  it('reserva confirmada → ofrece instalar Agendita desde el origen canónico', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockFindUnique.mockResolvedValue(baseBooking())

    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))

    expect(html).toContain('Ten tus citas y recordatorios a mano')
    expect(html).toContain('href="https://www.agendita.cl/instalar"')
  })

  it('reserva pendiente → no compite con el flujo de pago', async () => {
    mockGetCurrentUser.mockResolvedValue(null)
    mockFindUnique.mockResolvedValue(baseBooking({
      status: 'pending',
      startDateTime: new Date(Date.now() + 3_600_000),
      endDateTime: new Date(Date.now() + 7_200_000),
      holdExpiresAt: new Date(Date.now() + 3_600_000),
      depositPaid: 0,
    }))

    const html = renderToStaticMarkup(await BookingConfirmationPage({ searchParams }))

    expect(html).not.toContain('Ten tus citas y recordatorios a mano')
    expect(html).not.toContain('/instalar')
  })
})
