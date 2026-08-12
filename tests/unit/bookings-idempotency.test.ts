import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'
import { BookingStatus, BookingPaymentStatus } from '@prisma/client'
import { UserError } from '@/lib/actions/result'
import { DEFAULT_HOLD_MINUTES } from '@/lib/bookings/hold'
import { TEST_VAPID_PRIVATE_KEY, TEST_VAPID_PUBLIC_KEY } from '../helpers/push-fixtures'
import { cancellationPolicyRevision } from '@/lib/bookings/cancellation-policy-revision'

// Mocks de dependencias server-only
const mockPrisma = {
  business: { findUnique: vi.fn(), update: vi.fn().mockResolvedValue({ bookingNumberSeq: 4242 }) },
  service: { findFirst: vi.fn() },
  booking: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
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
  promotionRedemption: { findFirst: vi.fn().mockResolvedValue(null) },
  $executeRaw: vi.fn().mockResolvedValue(0),
  $queryRaw: vi.fn(),
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

// El resolver de pago online decide el largo del hold (15 min con checkout,
// la ventana de coordinación manual sin él). Default: disponible, que es el
// escenario que estos tests siempre asumieron.
const mockResolveOnline = vi.fn()
vi.mock('@/lib/payments/factory', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/payments/factory')>()),
  resolveOnlinePaymentAvailabilityForBusiness: (...args: unknown[]) => mockResolveOnline(...args),
}))

const mockAssertSlotFreeOfConflicts = vi.fn().mockResolvedValue(undefined)

// Sólo los dos asserts se mockean: `SLOT_UNAVAILABLE_MESSAGE` sale del módulo real,
// para que un cambio de copy no deje al test asertando un texto que ya no existe.
vi.mock('@/lib/availability/validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/availability/validation')>()),
  assertSlotIsAvailable: vi.fn().mockResolvedValue(undefined),
  // Las dos mitades del assert, que es lo que llama el camino de reservar desde que
  // "cualquiera disponible" prueba candidatos (ver `assertSlotAndResolveProfessional`).
  assertSlotIsBookable: vi.fn().mockResolvedValue(undefined),
  assertProfessionalIsFree: vi.fn().mockResolvedValue(undefined),
  assertSlotFreeOfConflicts: mockAssertSlotFreeOfConflicts,
}))

// Import DESPUÉS de los mocks — incluido el mensaje real de slot ocupado, que se
// lee del módulo mockeado (el factory conserva todo lo que no reemplaza). Arriba
// no puede ir: cargar `validation` a nivel de módulo dispara el factory de
// `@/lib/db` antes de que exista `mockPrisma`.
const { createBooking } = await import('@/server/actions/bookings')
const { SLOT_UNAVAILABLE_MESSAGE } = await import('@/lib/availability/validation')

describe('createBooking idempotency', () => {
  const baseInput = {
    serviceId: 'svc-1',
    customerName: 'Juan',
    customerPhone: '+56912345678',
    startDateTime: new Date('2027-05-20T14:00:00Z'),
    idempotencyKey: 'key-abc-123',
    acceptedTerms: true,
    cancellationPolicyRevision: '27f95039ffe60460abd372196819b22618f17f170193f2612ebae2f0ed098a71',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ENCRYPTION_KEY', 'bookings-idempotency-push-grant-key')
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', TEST_VAPID_PUBLIC_KEY)
    vi.stubEnv('VAPID_PRIVATE_KEY', TEST_VAPID_PRIVATE_KEY)
    vi.stubEnv('VAPID_SUBJECT', 'mailto:soporte@agendita.cl')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('FROM_EMAIL', '')
    mockResolveOnline.mockResolvedValue({ available: true, provider: 'mercado_pago', isMock: false })
    mockPrisma.business.findUnique.mockResolvedValue({
      id: 'biz-1',
      timezone: 'America/Santiago',
      name: 'Test Business',
      whatsapp: '+56987654321',
      addressText: 'Test Address',
      currency: 'CLP',
      selfServiceCutoffHours: 24,
      cancellationReminderEnabled: true,
      cancellationPolicy: null,
      slug: 'test-biz',
      subdomain: null,
      manualHoldHours: 24,
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
    mockPrisma.$queryRaw.mockResolvedValue([{
      selfServiceCutoffHours: 24,
      cancellationPolicy: null,
      cancellationReminderEnabled: true,
    }])
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
        customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
        discountAmount: 0,
        holdExpiresAt: new Date(Date.now() - 60 * 60 * 1000), // vencido hace rato
        cancellationCutoffHours: 24,
        cancellationPolicySnapshot: null,
        depositRequired: 5_000,
        depositPaid: 0,
        ...over,
      }
    }

    /** El hold renovado, tal como quedó escrito en la base. */
    function holdEscrito(): Date {
      return mockPrisma.booking.updateMany.mock.calls[0][0].data.holdExpiresAt as Date
    }

    beforeEach(() => {
      // El $transaction real corre su callback; el default del mock no.
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))
      mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })
    })

    it('con el horario libre renueva el hold y devuelve la misma reserva', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada())
      const antes = Date.now()

      const result = await createBooking(input, 'biz-1')

      expect(result.ok).toBe(true)
      expect(result.ok && result.data.id).toBe('booking-1')
      expect(mockPrisma.booking.create).not.toHaveBeenCalled()

      // El hold vencido se renueva: sin esto initiatePayment rechaza el pago y
      // no hay forma de salir del error.
      const minutos = (holdEscrito().getTime() - antes) / 60_000
      expect(minutos).toBeGreaterThan(DEFAULT_HOLD_MINUTES - 1)
      expect(minutos).toBeLessThan(DEFAULT_HOLD_MINUTES + 1)
      expect(result.ok && result.data.holdExpiresAt).toEqual(holdEscrito())
    })

    it('el update va guardado por status: si el cron la expiró en el medio, no escribe un hold zombi', async () => {
      // La reserva se lee FUERA de la tx. El updateMany condicionado es lo que
      // convierte esa carrera en un no-op con aviso, en vez de un hold fresco
      // sobre una reserva muerta.
      mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada())
      mockPrisma.booking.updateMany.mockResolvedValue({ count: 0 })

      const result = await createBooking(input, 'biz-1')

      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toContain('ya no está vigente')
    })

    it('no acorta un hold más largo que el default (transferencia → MP)', async () => {
      const holdLargo = new Date(Date.now() + 20 * 60 * 60 * 1000)
      mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada({ holdExpiresAt: holdLargo }))

      await createBooking(input, 'biz-1')

      // Recalcular a secas le comería casi 20 horas de plazo a quien ya las tenía.
      expect(holdEscrito()).toEqual(holdLargo)
    })

    it('si el horario ya no está libre, no deja seguir al pago', async () => {
      mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada())
      mockAssertSlotFreeOfConflicts.mockRejectedValueOnce(new UserError(SLOT_UNAVAILABLE_MESSAGE))

      const result = await createBooking(input, 'biz-1')

      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toContain('ya no está disponible')
      expect(mockPrisma.booking.updateMany).not.toHaveBeenCalled()
    })

    it('rechaza la key si la reserva guardada es de otro horario', async () => {
      // La clienta volvió atrás y eligió otra hora. El wizard suelta la key al
      // elegir, así que esto es el fail-closed: devolver la vieja sería cobrarle
      // por una hora que ya no eligió.
      mockPrisma.booking.findUnique.mockResolvedValue(
        reservaGuardada({ startDateTime: new Date(EN_UNA_SEMANA.getTime() + 3 * 60 * 60 * 1000) }),
      )

      const result = await createBooking(input, 'biz-1')

      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toContain('de otro horario')
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
    })

    it('rechaza la key si el cupón se aplicó después de crear la reserva', async () => {
      // Aplicar el descuento en el paso de pago y reintentar devolvía la reserva
      // SIN descuento mientras la pantalla mostraba el precio rebajado.
      mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada({ discountAmount: 0 }))
      mockPrisma.promotionRedemption.findFirst.mockResolvedValue(null)

      const result = await createBooking({ ...input, promotionCode: 'PRIMERA' }, 'biz-1')

      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toContain('descuento')
      expect(mockPrisma.booking.updateMany).not.toHaveBeenCalled()
    })

    it('un cupón que ya se aplicó y vale $0 NO rompe el reintento', async () => {
      // `rewardValue` admite 0 y un porcentaje chico se va a 0 por el Math.floor:
      // el descuento en 0 no prueba que el cupón falte. Lo que decide es el canje.
      mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada({ discountAmount: 0 }))
      mockPrisma.promotionRedemption.findFirst.mockResolvedValue({ id: 'redemption-1' })

      const result = await createBooking({ ...input, promotionCode: 'PRIMERA' }, 'biz-1')

      expect(result.ok).toBe(true)
      expect(mockPrisma.booking.updateMany).toHaveBeenCalled()
    })

    it.each([BookingStatus.cancelled, BookingStatus.expired, BookingStatus.no_show])(
      'una reserva %s suelta la key y deja reservar de nuevo',
      async (status) => {
        // No se revive: la vieja se queda muerta y se le saca la key, que no
        // protege nada (una reserva muerta no se puede duplicar). Quedarse con
        // ella era el callejón sin salida que este fix vino a cerrar.
        mockPrisma.booking.findUnique.mockResolvedValue(reservaGuardada({ status }))
        mockPrisma.booking.create.mockResolvedValue({
          id: 'booking-nueva',
          status: BookingStatus.pending_payment,
          totalPrice: 10000, depositRequired: 5000, depositPaid: 0,
          remainingBalance: 10000, finalAmount: 10000,
          paymentStatus: BookingPaymentStatus.unpaid,
          businessId: 'biz-1', customerId: 'cust-1',
          cancellationCutoffHours: 24, cancellationPolicySnapshot: null,
          startDateTime: EN_UNA_SEMANA,
          endDateTime: new Date(EN_UNA_SEMANA.getTime() + 60 * 60 * 1000),
          service: { name: 'Manicure' },
          customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
        })

        const result = await createBooking(input, 'biz-1')

        expect(mockPrisma.booking.update).toHaveBeenCalledWith({
          where: { id: 'booking-1' },
          data: { idempotencyKey: null },
        })
        expect(result.ok && result.data.id).toBe('booking-nueva')
      },
    )

    it('un reenvío sobre una reserva ya confirmada la devuelve intacta', async () => {
      const confirmada = reservaGuardada({ status: BookingStatus.confirmed, holdExpiresAt: null })
      mockPrisma.booking.findUnique.mockResolvedValue(confirmada)

      const result = await createBooking(input, 'biz-1')

      expect(result).toMatchObject({ ok: true, data: confirmada })
      expect(result.ok && result.data.pushGrant).toEqual(expect.any(String))
      expect(mockPrisma.$transaction).not.toHaveBeenCalled()
      expect(mockPrisma.booking.updateMany).not.toHaveBeenCalled()
    })

    it('returns the idempotent booking with push disabled when ENCRYPTION_KEY is absent', async () => {
      vi.stubEnv('ENCRYPTION_KEY', '')
      const confirmada = reservaGuardada({ status: BookingStatus.confirmed, holdExpiresAt: null })
      mockPrisma.booking.findUnique.mockResolvedValue(confirmada)

      const result = await createBooking(input, 'biz-1')

      expect(result).toMatchObject({ ok: true, data: { ...confirmada, pushGrant: null } })
      expect(mockPrisma.booking.create).not.toHaveBeenCalled()
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
      cancellationCutoffHours: 24,
      cancellationPolicySnapshot: null,
      startDateTime: baseInput.startDateTime,
      endDateTime: new Date(baseInput.startDateTime.getTime() + 60 * 60 * 1000),
      service: { name: 'Manicure' },
      customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
    }
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ...mockPrisma,
        booking: { ...mockPrisma.booking, create: vi.fn().mockResolvedValue(createdBooking) },
      }
      return fn(tx)
    })

    const result = await createBooking(baseInput, 'biz-1')

    expect(result).toMatchObject({ ok: true, data: createdBooking })
    expect(result.ok && result.data.pushGrant).toEqual(expect.any(String))
    expect(mockPrisma.booking.findUnique).toHaveBeenCalledWith({
      where: {
        businessId_idempotencyKey: {
          businessId: 'biz-1',
          idempotencyKey: 'key-abc-123',
        },
      },
      // La persona viaja en la lectura de la key y no sólo en la creación: el
      // reintento devuelve ESA reserva, y sin el nombre la confirmación de quien
      // pidió "cualquiera" no podría decir quién la atiende.
      include: { service: true, customer: true, professional: { select: { name: true } } },
    })
  })

  it('rejects old consent when the locked policy revision already changed', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    mockPrisma.$queryRaw.mockResolvedValue([{
      selfServiceCutoffHours: 12,
      cancellationPolicy: 'Nueva política',
      cancellationReminderEnabled: true,
    }])
    const createdBooking = {
      id: 'booking-must-not-exist',
      businessId: 'biz-1',
      customerId: 'cust-1',
      status: BookingStatus.pending_payment,
      cancellationCutoffHours: 24,
      cancellationPolicySnapshot: null,
      depositRequired: 5_000,
      depositPaid: 0,
      startDateTime: baseInput.startDateTime,
      service: { name: 'Manicure' },
      customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
    }
    const create = vi.fn().mockResolvedValue(createdBooking)
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      ...mockPrisma,
      booking: { ...mockPrisma.booking, create },
    }))

    const result = await createBooking(baseInput, 'biz-1')

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain('política de cancelación se actualizó')
    expect(create).not.toHaveBeenCalled()
  })

  it('snapshots the exact policy values protected by the booking transaction lock', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    const lockedPolicy = {
      selfServiceCutoffHours: 12,
      cancellationPolicy: 'Avisar por WhatsApp',
      cancellationReminderEnabled: true,
    }
    mockPrisma.$queryRaw.mockResolvedValue([lockedPolicy])
    const create = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      id: 'booking-locked-policy',
      businessId: 'biz-1',
      customerId: 'cust-1',
      status: BookingStatus.pending_payment,
      cancellationCutoffHours: data.cancellationCutoffHours,
      cancellationPolicySnapshot: data.cancellationPolicySnapshot,
      depositRequired: 5_000,
      depositPaid: 0,
      startDateTime: baseInput.startDateTime,
      service: { name: 'Manicure' },
      customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
    }))
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      ...mockPrisma,
      booking: { ...mockPrisma.booking, create },
    }))
    const revision = cancellationPolicyRevision({
      businessId: 'biz-1',
      cutoffHours: lockedPolicy.selfServiceCutoffHours,
      additionalPolicy: lockedPolicy.cancellationPolicy,
    })

    const result = await createBooking({ ...baseInput, cancellationPolicyRevision: revision }, 'biz-1')

    expect(result.ok).toBe(true)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        cancellationCutoffHours: 12,
        cancellationPolicySnapshot: 'Avisar por WhatsApp',
      }),
    }))
  })

  it('uses the locked reminder toggle instead of emitting a grant from the stale outer read', async () => {
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    mockPrisma.$queryRaw.mockResolvedValue([{
      selfServiceCutoffHours: 24,
      cancellationPolicy: null,
      cancellationReminderEnabled: false,
    }])
    const createdBooking = {
      id: 'booking-toggle-disabled',
      businessId: 'biz-1',
      customerId: 'cust-1',
      status: BookingStatus.pending_payment,
      cancellationCutoffHours: 24,
      cancellationPolicySnapshot: null,
      depositRequired: 5_000,
      depositPaid: 0,
      startDateTime: baseInput.startDateTime,
      service: { name: 'Manicure' },
      customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
    }
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({
      ...mockPrisma,
      booking: { ...mockPrisma.booking, create: vi.fn().mockResolvedValue(createdBooking) },
    }))

    const result = await createBooking(baseInput, 'biz-1')

    expect(result).toMatchObject({
      ok: true,
      data: { id: 'booking-toggle-disabled', pushMode: null, pushGrant: null },
    })
  })

  it('does not fail a newly persisted booking when push signing is disabled', async () => {
    vi.stubEnv('ENCRYPTION_KEY', '')
    mockPrisma.booking.findUnique.mockResolvedValue(null)
    const createdBooking = {
      id: 'booking-no-push',
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
      cancellationCutoffHours: 24,
      cancellationPolicySnapshot: null,
      startDateTime: baseInput.startDateTime,
      endDateTime: new Date(baseInput.startDateTime.getTime() + 60 * 60 * 1000),
      service: { name: 'Manicure' },
      customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
    }
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ...mockPrisma,
        booking: { ...mockPrisma.booking, create: vi.fn().mockResolvedValue(createdBooking) },
      }
      return fn(tx)
    })

    const result = await createBooking(baseInput, 'biz-1')

    expect(result).toMatchObject({ ok: true, data: { ...createdBooking, pushGrant: null } })
  })

  it('handles race condition by returning existing booking on P2002', async () => {
    // Dos envíos concurrentes con la misma key: el perdedor no encuentra nada en
    // el fast path, choca contra el unique constraint y recupera la reserva del
    // ganador — por el MISMO resume que el fast path, así que también le renueva
    // el hold y re-valida el cupo.
    const enUnaSemana = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    mockPrisma.booking.findUnique.mockResolvedValueOnce(null)
    const existingBooking = {
      id: 'booking-race',
      businessId: 'biz-1',
      serviceId: 'svc-1',
      status: BookingStatus.pending_payment,
      startDateTime: enUnaSemana,
      endDateTime: new Date(enUnaSemana.getTime() + 60 * 60 * 1000),
      professionalId: null,
      customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
      discountAmount: 0,
      holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
      cancellationCutoffHours: 24,
      cancellationPolicySnapshot: null,
      depositRequired: 5_000,
      depositPaid: 0,
    }
    mockPrisma.booking.findUnique.mockResolvedValueOnce(existingBooking)

    // La tx de creación lanza P2002 por unique constraint; la del resume corre normal.
    const p2002Error = new Error('Unique constraint failed') as Error & { code: string; meta?: unknown }
    p2002Error.code = 'P2002'
    p2002Error.meta = { target: ['businessId_idempotencyKey'] }
    mockPrisma.$transaction.mockRejectedValueOnce(p2002Error)
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })

    const result = await createBooking({ ...baseInput, startDateTime: enUnaSemana }, 'biz-1')

    expect(result.ok).toBe(true)
    expect(result.ok && result.data.id).toBe('booking-race')
    expect(result.ok && result.data.pushMode).toBe('guest')
    expect(result.ok && result.data.pushGrant).toEqual(expect.any(String))
  })

  it('recovers a P2002 booking with push disabled when ENCRYPTION_KEY is absent', async () => {
    vi.stubEnv('ENCRYPTION_KEY', '')
    const enUnaSemana = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    mockPrisma.booking.findUnique.mockResolvedValueOnce(null)
    const existingBooking = {
      id: 'booking-race-no-push',
      businessId: 'biz-1',
      serviceId: 'svc-1',
      status: BookingStatus.pending_payment,
      startDateTime: enUnaSemana,
      endDateTime: new Date(enUnaSemana.getTime() + 60 * 60 * 1000),
      professionalId: null,
      customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
      discountAmount: 0,
      holdExpiresAt: new Date(Date.now() + 10 * 60 * 1000),
    }
    mockPrisma.booking.findUnique.mockResolvedValueOnce(existingBooking)
    const p2002Error = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
      meta: { target: ['businessId_idempotencyKey'] },
    })
    mockPrisma.$transaction.mockRejectedValueOnce(p2002Error)
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })

    const result = await createBooking({ ...baseInput, startDateTime: enUnaSemana }, 'biz-1')

    expect(result).toMatchObject({ ok: true, data: { id: 'booking-race-no-push', pushGrant: null } })
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
      cancellationCutoffHours: 24,
      cancellationPolicySnapshot: null,
      startDateTime: baseInput.startDateTime,
      endDateTime: new Date(baseInput.startDateTime.getTime() + 60 * 60 * 1000),
      service: { name: 'Manicure' },
      customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
    }
    mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
      const tx = {
        ...mockPrisma,
        booking: { ...mockPrisma.booking, create: vi.fn().mockResolvedValue(createdBooking) },
      }
      return fn(tx)
    })

    const result = await createBooking(inputWithoutKey, 'biz-1')

    expect(result).toMatchObject({ ok: true, data: createdBooking })
    expect(result.ok && result.data.pushGrant).toEqual(expect.any(String))
    expect(mockPrisma.booking.findUnique).not.toHaveBeenCalled()
  })
})

describe('createBooking acceptedTerms enforcement', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ENCRYPTION_KEY', 'bookings-terms-push-grant-key')
    vi.stubEnv('NEXT_PUBLIC_VAPID_PUBLIC_KEY', TEST_VAPID_PUBLIC_KEY)
    vi.stubEnv('VAPID_PRIVATE_KEY', TEST_VAPID_PRIVATE_KEY)
    vi.stubEnv('VAPID_SUBJECT', 'mailto:soporte@agendita.cl')
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('FROM_EMAIL', '')
    mockResolveOnline.mockResolvedValue({ available: true, provider: 'mercado_pago', isMock: false })
    mockPrisma.business.findUnique.mockResolvedValue({
      id: 'biz-1',
      timezone: 'America/Santiago',
      name: 'Test Business',
      whatsapp: '+56987654321',
      addressText: 'Test Address',
      currency: 'CLP',
      selfServiceCutoffHours: 24,
      cancellationReminderEnabled: true,
      cancellationPolicy: null,
      slug: 'test',
      subdomain: 'test',
      subscriptionStatus: 'trialing',
      manualHoldHours: 24,
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
    startDateTime: new Date('2027-05-20T14:00:00Z'),
    cancellationPolicyRevision: '27f95039ffe60460abd372196819b22618f17f170193f2612ebae2f0ed098a71',
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
      cancellationCutoffHours: 24,
      cancellationPolicySnapshot: null,
      startDateTime: baseInput.startDateTime,
      endDateTime: new Date(baseInput.startDateTime.getTime() + 60 * 60 * 1000),
      service: { name: 'Manicure' },
      customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null },
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

    expect(result).toMatchObject({ ok: true, data: createdBooking })
    expect(result.ok && result.data.pushGrant).toEqual(expect.any(String))
  })

  // Coordinación manual: con abono requerido pero sin checkout online ni
  // transferencia, la clienta no puede pagar en 15 minutos — el hold dura la
  // ventana configurada y la reserva queda marcada para el cron y el panel.
  describe('coordinación manual del abono', () => {
    function txConCreate() {
      const createSpy = vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'booking-manual',
        businessId: 'biz-1',
        customerId: 'cust-1',
        startDateTime: data.startDateTime,
        status: data.status,
        cancellationCutoffHours: 24,
        cancellationPolicySnapshot: null,
        depositRequired: data.depositRequired,
        depositPaid: data.depositPaid,
        service: { name: 'Manicure' },
        customer: { id: 'cust-1', name: 'Juan', phone: '+56912345678', email: null, userId: null },
        professional: null,
      }))
      mockPrisma.customer.findFirst.mockResolvedValue(null)
      mockPrisma.customer.create.mockResolvedValue({ id: 'cust-1' })
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({ ...mockPrisma, booking: { ...mockPrisma.booking, create: createSpy } }),
      )
      return createSpy
    }

    it('sin pago online: hold = manualHoldHours y paymentMethod manual', async () => {
      mockResolveOnline.mockResolvedValue({ available: false, provider: null, isMock: false, reason: 'coordina' })
      mockPrisma.business.findUnique.mockResolvedValue({
        id: 'biz-1', timezone: 'America/Santiago', name: 'Test Business',
        whatsapp: null, addressText: null, currency: 'CLP', cancellationPolicy: null,
        selfServiceCutoffHours: 24,
        slug: 'test', subdomain: 'test', subscriptionStatus: 'trialing',
        manualHoldHours: 48,
      })
      const createSpy = txConCreate()
      const antes = Date.now()

      const result = await createBooking({ ...baseInput, acceptedTerms: true }, 'biz-1')

      expect(result.ok).toBe(true)
      const data = createSpy.mock.calls[0][0].data
      expect(data.paymentMethod).toBe('manual')
      const horas = (data.holdExpiresAt.getTime() - antes) / 3_600_000
      expect(horas).toBeGreaterThan(47.9)
      expect(horas).toBeLessThan(48.1)
    })

    it('con checkout online disponible: hold corto y sin marcador', async () => {
      const createSpy = txConCreate()
      const antes = Date.now()

      const result = await createBooking({ ...baseInput, acceptedTerms: true }, 'biz-1')

      expect(result.ok).toBe(true)
      const data = createSpy.mock.calls[0][0].data
      expect(data.paymentMethod).toBeNull()
      const minutos = (data.holdExpiresAt.getTime() - antes) / 60_000
      expect(minutos).toBeGreaterThan(DEFAULT_HOLD_MINUTES - 1)
      expect(minutos).toBeLessThan(DEFAULT_HOLD_MINUTES + 1)
    })

    it('sin abono requerido ni siquiera consulta la disponibilidad', async () => {
      mockPrisma.service.findFirst.mockResolvedValue({
        id: 'svc-1', businessId: 'biz-1', isActive: true, durationMinutes: 60,
        price: 10000, depositAmount: 0, modalities: ['on_site'],
      })
      txConCreate()

      const result = await createBooking({ ...baseInput, acceptedTerms: true }, 'biz-1')

      expect(result.ok).toBe(true)
      expect(mockResolveOnline).not.toHaveBeenCalled()
    })
  })
})
