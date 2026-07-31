import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { UserError } from '@/lib/actions/result'

// Mocks de dependencias server-only
const mockPrisma = {
  business: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({ bookingNumberSeq: 4242 }) },
  service: { findFirst: vi.fn() },
  booking: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  customer: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  businessUser: {
    findMany: vi.fn().mockResolvedValue([
      { user: { email: 'owner@test.com', name: 'Owner' } },
    ]),
  },
  promotionGrant: { findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]) },
  $executeRaw: vi.fn().mockResolvedValue(0),
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('@/lib/auth/server', () => ({
  requireBusiness: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  requireBusinessRole: vi.fn().mockResolvedValue({ businessId: 'biz-1' }),
  ForbiddenError,
}))

vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: vi.fn().mockResolvedValue(null),
  getConfirmedSessionUser: vi.fn().mockResolvedValue(null),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))

const mockResendSend = vi.fn()
const MockResend = vi.fn(function (this: Record<string, unknown>) {
  this.emails = { send: mockResendSend }
}) as unknown as { new (...args: unknown[]): { emails: { send: typeof mockResendSend } } }

vi.mock('resend', () => ({
  Resend: MockResend,
}))

vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: vi.fn().mockResolvedValue('owner@test.com'),
  sendBookingConfirmationToCustomer: vi.fn(),
  sendBookingReceivedToCustomer: vi.fn(),
  sendNewBookingNotificationToBusiness: vi.fn().mockResolvedValue([]),
  sendBookingCancelledNotification: vi.fn(),
  sendNotificationSafely: vi.fn().mockResolvedValue({ success: true }),
  sendMultiNotificationSafely: vi.fn().mockResolvedValue([]),
}))

const mockAssertSlotFreeOfConflicts = vi.fn().mockResolvedValue(undefined)

vi.mock('@/lib/availability/validation', () => ({
  assertSlotIsAvailable: vi.fn().mockResolvedValue(undefined),
  assertSlotFreeOfConflicts: mockAssertSlotFreeOfConflicts,
  SLOT_UNAVAILABLE_MESSAGE: 'Ese horario ya no está disponible. Por favor selecciona otro.',
}))

// Import DESPUÉS de los mocks
const { createBooking } = await import('@/server/actions/bookings')

describe('createBooking idempotency', () => {
  const baseInput = {
    serviceId: 'svc-1',
    customerName: 'Juan',
    customerPhone: '+56912345678',
    startDateTime: new Date('2026-05-20T14:00:00Z'),
    idempotencyKey: 'key-abc-123',
    acceptedTerms: true,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('FROM_EMAIL', '')
    mockPrisma.business.findUnique.mockResolvedValue({
      id: 'biz-1',
      timezone: 'America/Santiago',
      name: 'Test Business',
      whatsapp: '+56987654321',
      addressText: 'Test Address',
      currency: 'CLP',
      cancellationPolicy: null,
      slug: 'test-biz',
      subdomain: null,
    })
    mockPrisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      businessId: 'biz-1',
      price: 10000,
      depositAmount: 5000,
      durationMinutes: 60,
      modalities: ['on_site'],
      isActive: true,
    })
    mockPrisma.customer.findFirst.mockResolvedValue(null)
    mockPrisma.customer.create.mockResolvedValue({ id: 'cust-1' })
  })

  // El reintento con la misma key (botón "Intentar de nuevo", re-envío tras
  // volver del checkout). Antes devolvía la reserva guardada sin mirar nada: si
  // el horario ya era de otra, la mandaba a pagarlo igual; si el hold había
  // vencido, initiatePayment la rechazaba y el botón repetía el mismo error para
  // siempre, porque reusaba la misma key.
  describe('reintento con la misma idempotencyKey', () => {
    // Futuro relativo, no una fecha escrita a mano: el reintento sí mira el reloj
    // (una reserva cuya hora ya pasó no se paga), así que una constante de 2026
    // haría fallar el archivo al llegar la fecha.
    const EN_UNA_SEMANA = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const input = { ...baseInput, startDateTime: EN_UNA_SEMANA }

    function reservaGuardada(over: Record<string, unknown> = {}) {
      return {
        id: 'booking-1',
        businessId: 'biz-1',
        serviceId: 'svc-1',
        status: BookingStatus.pending_payment,
        startDateTime: EN_UNA_SEMANA,
        endDateTime: new Date(EN_UNA_SEMANA.getTime() + 60 * 60 * 1000),
        professionalId: null,
        holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000), // vencido hace rato
        ...over,
      }
    }

    /** El $transaction real corre el callback; el default del mock no. */
    function corriendoLaTx() {
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))
    }

    it('con el horario libre renueva el hold y devuelve la misma reserva', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada())
      corriendoLaTx()
      const antes = Date.now()

      const result = await createBooking(input, 'biz-1')

      expect(result.ok).toBe(true)
      expect(result.ok && result.data.id).toBe('booking-1')
      expect(mockPrisma.booking.create).not.toHaveBeenCalled()

      // El hold vencido se renueva: sin esto initiatePayment rechaza el pago y
      // no hay forma de salir del error.
      const renovado = mockPrisma.booking.update.mock.calls[0][0].data.holdExpiresAt as Date
      const minutos = (renovado.getTime() - antes) / 60_000
      expect(minutos).toBeGreaterThan(14)
      expect(minutos).toBeLessThan(16)
      expect(result.ok && (result.data as { holdExpiresAt: Date }).holdExpiresAt).toEqual(renovado)
    })

    it('no acorta un hold más largo que el default (transferencia → MP)', async () => {
      const holdLargo = new Date(Date.now() + 20 * 60 * 60 * 1000)
      mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada({ holdExpiresAt: holdLargo }))
      corriendoLaTx()

      await createBooking(input, 'biz-1')

      // Recalcular a secas le comería casi 20 horas de plazo a quien ya las tenía.
      expect(mockPrisma.booking.update.mock.calls[0][0].data.holdExpiresAt).toEqual(holdLargo)
    })

    it('si el horario ya no está libre, no deja seguir al pago', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada())
      corriendoLaTx()
      mockAssertSlotFreeOfConflicts.mockRejectedValueOnce(
        new UserError('Ese horario ya no está disponible. Por favor selecciona otro.'),
      )

      const result = await createBooking(input, 'biz-1')

      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toContain('ya no está disponible')
      expect(mockPrisma.booking.update).not.toHaveBeenCalled()
    })

    it('rechaza la key si la reserva guardada es de otro horario', async () => {
      // La clienta volvió atrás y eligió otra hora. El wizard suelta la key al
      // elegir, así que esto es el fail-closed: devolver la vieja sería cobrarle
      // por una hora que ya no eligió.
      mockPrisma.booking.findUnique.mockResolvedValue(
        reservaGuardada({ startDateTime: new Date('2026-05-20T18:00:00Z') }),
      )

      const result = await createBooking(input, 'biz-1')

      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toContain('de otro horario')
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('no revive una reserva cancelada ni una expirada', async () => {
      for (const status of [BookingStatus.cancelled, BookingStatus.expired, BookingStatus.no_show]) {
        vi.clearAllMocks()
        mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada({ status }))

        const result = await createBooking(input, 'biz-1')

        expect(result.ok).toBe(false)
        expect(!result.ok && result.error).toContain('ya no está vigente')
        expect(mockPrisma.$transaction).not.toHaveBeenCalled()
      }
    })

    it('un reenvío sobre una reserva ya confirmada la devuelve intacta', async () => {
      const confirmada = reservaGuardada({ status: BookingStatus.confirmed, holdExpiresAt: null })
      mockPrisma.booking.findUnique.mockResolvedValue(confirmada)

      const result = await createBooking(input, 'biz-1')

      expect(result).toEqual({ ok: true, data: confirmada })
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
      expect(mockPrisma.booking.update).not.toHaveBeenCalled()
    })
  })

  it('creates new booking when idempotencyKey is new', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    const createdBooking = {
      id: 'booking-new',
      businessId: 'biz-1',
      serviceId: 'svc-1',
      customerId: 'cust-1',
      status: BookingStatus.pending_payment,
      totalPrice: 10000,
      depositRequired: 5000,
      depositPaid: 0,
      remainingBalance: 10000,
      finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.unpaid,
      startDateTime: new Date('2026-05-20T14:00:00Z'),
      endDateTime: new Date('2026-05-20T15:00:00Z'),
      service: { name: 'Manicure' },
      customer: { name: 'Juan', phone: '+56912345678', email: null },
    }
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ...mockPrisma,
        booking: { ...mockPrisma.booking, create: vi.fn().mockResolvedValue(createdBooking) },
      }
      return fn(tx)
    })

    const result = await createBooking(baseInput, 'biz-1')

    expect(result).toEqual({ ok: true, data: createdBooking })
    expect(mockPrisma.booking.findUnique).toHaveBeenCalledWith({
      where: {
        businessId_idempotencyKey: {
          businessId: 'biz-1',
          idempotencyKey: 'key-abc-123',
        },
      },
      include: { service: true, customer: true },
    })
  })

  it('handles race condition by returning existing booking on P2002', async () => {
    mockPrisma.booking.findUnique.mockResolvedValueOnce(null)
    const existingBooking = {
      id: 'booking-race',
      businessId: 'biz-1',
      serviceId: 'svc-1',
    }
    mockPrisma.booking.findUnique.mockResolvedValueOnce(existingBooking)

    // Simular que $transaction lanza P2002 por unique constraint
    const p2002Error = new Error('Unique constraint failed') as Error & { code: string; meta?: unknown }
    p2002Error.code = 'P2002'
    p2002Error.meta = { target: ['businessId_idempotencyKey'] }
    mockPrisma.$transaction.mockRejectedValue(p2002Error)

    const result = await createBooking(baseInput, 'biz-1')

    expect(result).toEqual({ ok: true, data: existingBooking })
  })

  it('re-throws non-idempotency errors as safe generic message', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    const genericError = new Error('DB connection lost') as Error & { code: string }
    genericError.code = 'P1001'
    mockPrisma.$transaction.mockRejectedValue(genericError)

    // Prisma errors are caught and re-thrown as a UserError with a safe
    // custom message (still specific, not the wrapper's generic fallback).
    const result = await createBooking(baseInput, 'biz-1')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('Error de base de datos')
  })

  it('works without idempotencyKey (backward compatible)', async () => {
    const inputWithoutKey = { ...baseInput, idempotencyKey: undefined }
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    const createdBooking = {
      id: 'booking-no-key',
      businessId: 'biz-1',
      serviceId: 'svc-1',
      customerId: 'cust-1',
      status: BookingStatus.pending_payment,
      totalPrice: 10000,
      depositRequired: 5000,
      depositPaid: 0,
      remainingBalance: 10000,
      finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.unpaid,
      startDateTime: new Date('2026-05-20T14:00:00Z'),
      endDateTime: new Date('2026-05-20T15:00:00Z'),
      service: { name: 'Manicure' },
      customer: { name: 'Juan', phone: '+56912345678', email: null },
    }
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ...mockPrisma,
        booking: { ...mockPrisma.booking, create: vi.fn().mockResolvedValue(createdBooking) },
      }
      return fn(tx)
    })

    const result = await createBooking(inputWithoutKey, 'biz-1')

    expect(result).toEqual({ ok: true, data: createdBooking })
    expect(mockPrisma.booking.findUnique).not.toHaveBeenCalled()
  })
})

describe('createBooking acceptedTerms enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('FROM_EMAIL', '')
    mockPrisma.business.findUnique.mockResolvedValue({
      id: 'biz-1',
      timezone: 'America/Santiago',
      name: 'Test Business',
      whatsapp: '+56987654321',
      addressText: 'Test Address',
      currency: 'CLP',
      cancellationPolicy: null,
      slug: 'test',
      subdomain: 'test',
      subscriptionStatus: 'trialing',
    })
    mockPrisma.service.findFirst.mockResolvedValue({
      id: 'svc-1',
      businessId: 'biz-1',
      isActive: true,
      durationMinutes: 60,
      price: 10000,
      depositAmount: 5000,
      modalities: ['on_site'],
    })
  })

  const baseInput = {
    serviceId: 'svc-1',
    customerName: 'Juan',
    customerPhone: '+56912345678',
    startDateTime: new Date('2026-05-20T14:00:00Z'),
  }

  it('rejects when acceptedTerms is false', async () => {
    const result = await createBooking({ ...baseInput, acceptedTerms: false }, 'biz-1')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('Debes aceptar los términos')
  })

  it('rejects when acceptedTerms is omitted', async () => {
    const result = await createBooking(baseInput as any, 'biz-1')
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('Datos de reserva inválidos')
  })

  it('allows booking when acceptedTerms is true', async () => {
    const createdBooking = {
      id: 'booking-ok',
      businessId: 'biz-1',
      serviceId: 'svc-1',
      customerId: 'cust-1',
      status: BookingStatus.pending_payment,
      totalPrice: 10000,
      depositRequired: 5000,
      depositPaid: 0,
      remainingBalance: 10000,
      finalAmount: 10000,
      paymentStatus: BookingPaymentStatus.unpaid,
      startDateTime: new Date('2026-05-20T14:00:00Z'),
      endDateTime: new Date('2026-05-20T15:00:00Z'),
      service: { name: 'Manicure' },
      customer: { name: 'Juan', phone: '+56912345678', email: null },
    }

    mockPrisma.customer.findFirst.mockResolvedValue(null)
    mockPrisma.customer.create.mockResolvedValue({ id: 'cust-1' })

    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ...mockPrisma,
        booking: { ...mockPrisma.booking, create: vi.fn().mockResolvedValue(createdBooking) },
      }
      return fn(tx)
    })

    const result = await createBooking({ ...baseInput, acceptedTerms: true }, 'biz-1')

    expect(result).toEqual({ ok: true, data: createdBooking })
  })
})
