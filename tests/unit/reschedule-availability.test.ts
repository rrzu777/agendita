import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ForbiddenError } from '../helpers/auth-errors'
import { UserError } from '@/lib/actions/result'

const mockRequireBusinessRole = vi.fn()
const mockGenerateSlots = vi.fn()
const mockAssertSlotIsAvailable = vi.fn()
const mockSendBookingRescheduledNotification = vi.fn()
const mockSendNotificationSafely = vi.fn()

const mockPrisma = {
  booking: {
    findFirst: vi.fn(),
    // La relectura para el .ics del nuevo horario; null = el mail sale sin evento.
    findUnique: vi.fn().mockResolvedValue(null),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  availabilityRule: { findMany: vi.fn() },
  timeBlock: { findMany: vi.fn() },
  timeBlockSeries: { findMany: vi.fn() },
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: (...args: unknown[]) => mockRequireBusinessRole(...args),
  requireBusiness: vi.fn(),
  ForbiddenError,
}))

vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ success: true }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/server/actions/revalidate-business', () => ({
  revalidateBusinessPublicPaths: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/availability/slots', () => ({
  generateSlots: (...args: unknown[]) => mockGenerateSlots(...args),
}))

// Spread del módulo real y sólo el assert mockeado (mismo patrón que
// bookings-idempotency): `SLOT_UNAVAILABLE_MESSAGE` es el mensaje que la action
// le pone al rechazo del EXCLUDE, así que tiene que salir del módulo — una copia
// del texto acá dejaría el test verde aunque la traducción no existiera.
vi.mock('@/lib/availability/validation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/availability/validation')>()),
  assertSlotIsAvailable: (...args: unknown[]) => mockAssertSlotIsAvailable(...args),
}))

vi.mock('@/lib/notifications', () => ({
  getBusinessReplyToEmail: vi.fn().mockResolvedValue('owner@example.com'),
  sendBookingCancelledNotification: vi.fn(),
  sendBookingRescheduledNotification: (...args: unknown[]) => mockSendBookingRescheduledNotification(...args),
  sendNotificationSafely: (...args: unknown[]) => mockSendNotificationSafely(...args),
}))

const { getAvailableSlotsForReschedule } = await import('@/server/actions/availability')
const { rescheduleBooking } = await import('@/server/actions/bookings')
const { SLOT_UNAVAILABLE_MESSAGE } = await import('@/lib/availability/validation')
// Del módulo real, mismo criterio: comparar contra el mensaje que la action usa
// de verdad y no contra una copia del texto que puede quedar vieja.
const { rescheduleBlockedReason } = await import('@/lib/bookings/hold')

const businessId = 'biz-1'
const booking = {
  id: 'booking-1',
  businessId,
  serviceId: 'svc-1',
  status: 'confirmed',
  startDateTime: new Date('2026-06-15T14:00:00Z'),
  endDateTime: new Date('2026-06-15T15:00:00Z'),
  // Reprogramar conserva a quien atendía; `null` = sin persona, el horario del
  // negocio. Sin este campo el alcance quedaba "de una persona sin id", que en un
  // `where` de Prisma no filtra nada.
  professionalId: null,
  // Los dos que mira el guard del plazo. Una confirmada no tiene plazo que
  // pueda estar vencido; el caso condenado los pisa abajo.
  paymentStatus: 'deposit_paid',
  holdExpiresAt: null,
  service: { id: 'svc-1', durationMinutes: 60, name: 'Manicure', isActive: true },
  customer: { name: 'Maria', email: 'maria@example.com', phone: '+56912345678' },
  bookingNumber: 42,
  business: { timezone: 'America/Santiago', bookingWindowDays: 90 },
}

describe('getAvailableSlotsForReschedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusinessRole.mockResolvedValue({ businessId, business: { timezone: 'America/Santiago' } })
    mockPrisma.booking.findFirst.mockResolvedValue(booking)
    mockPrisma.availabilityRule.findMany.mockResolvedValue([{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }])
    mockPrisma.timeBlock.findMany.mockResolvedValue([])
    mockPrisma.timeBlockSeries.findMany.mockResolvedValue([])
    mockPrisma.booking.findMany.mockResolvedValue([])
    mockGenerateSlots.mockReturnValue([
      { start: new Date('2026-06-15T14:00:00Z'), end: new Date('2026-06-15T15:00:00Z') },
    ])
  })

  it('uses owner/admin auth and validates booking belongs to business', async () => {
    await getAvailableSlotsForReschedule('booking-1', new Date('2026-06-15T00:00:00Z'))

    expect(mockRequireBusinessRole).toHaveBeenCalledWith(['owner', 'admin'])
    expect(mockPrisma.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'booking-1', businessId },
    }))
  })

  it('excludes the current booking so the current slot can appear', async () => {
    const result = await getAvailableSlotsForReschedule('booking-1', new Date('2026-06-15T00:00:00Z'))

    if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
    expect(result.data[0].start).toEqual(new Date('2026-06-15T14:00:00Z'))
    expect(mockPrisma.booking.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { not: 'booking-1' } }),
    }))
  })

  it('passes existing bookings and time blocks to generateSlots', async () => {
    const busyBooking = { id: 'booking-2', startDateTime: new Date('2026-06-15T15:00:00Z'), endDateTime: new Date('2026-06-15T16:00:00Z'), status: 'confirmed' }
    const block = { startDateTime: new Date('2026-06-15T17:00:00Z'), endDateTime: new Date('2026-06-15T18:00:00Z') }
    mockPrisma.booking.findMany.mockResolvedValue([busyBooking])
    mockPrisma.timeBlock.findMany.mockResolvedValue([block])

    await getAvailableSlotsForReschedule('booking-1', new Date('2026-06-15T00:00:00Z'))

    expect(mockGenerateSlots).toHaveBeenCalledWith(
      expect.any(Date),
      60,
      expect.any(Array),
      [expect.objectContaining({ startDateTime: block.startDateTime, endDateTime: block.endDateTime })],
      [busyBooking],
      expect.objectContaining({ timezone: 'America/Santiago', bookingWindowDays: 90 }),
    )
  })

  it('rejects cross-tenant bookingId', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(null)

    const result = await getAvailableSlotsForReschedule('booking-other', new Date('2026-06-15T00:00:00Z'))
    expect(result).toEqual({ ok: false, error: 'Reserva no encontrada' })
  })

  it('rejects terminal statuses', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({ ...booking, status: 'completed' })

    const result = await getAvailableSlotsForReschedule('booking-1', new Date('2026-06-15T00:00:00Z'))
    expect(result).toEqual({ ok: false, error: 'No se puede reprogramar una reserva en este estado' })
  })

  it('rejects inactive services to match final availability validation', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({ ...booking, service: { ...booking.service, isActive: false } })

    const result = await getAvailableSlotsForReschedule('booking-1', new Date('2026-06-15T00:00:00Z'))
    expect(result).toEqual({ ok: false, error: 'Servicio no disponible' })
  })

  it('respects TimeBlocks by passing them into slot generation', async () => {
    const block = { startDateTime: new Date('2026-06-15T14:00:00Z'), endDateTime: new Date('2026-06-15T15:00:00Z') }
    mockPrisma.timeBlock.findMany.mockResolvedValue([block])

    await getAvailableSlotsForReschedule('booking-1', new Date('2026-06-15T00:00:00Z'))

    expect(mockGenerateSlots.mock.calls[0][3]).toEqual([
      expect.objectContaining({ startDateTime: block.startDateTime, endDateTime: block.endDateTime }),
    ])
  })
})

describe('rescheduleBooking terminal states and availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusinessRole.mockResolvedValue({
      businessId,
      business: {
        name: 'Nails by Ana',
        timezone: 'America/Santiago',
        whatsapp: '+56911111111',
        addressText: 'Av. Principal 123',
      },
    })
    mockPrisma.booking.findFirst.mockResolvedValue(booking)
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })
    mockSendNotificationSafely.mockImplementation(async (_label, fn) => fn())
    mockSendBookingRescheduledNotification.mockResolvedValue({ success: true })
    mockPrisma.$transaction.mockImplementation(async (fn) => fn({
      booking: { updateMany: mockPrisma.booking.updateMany },
    }))
    mockAssertSlotIsAvailable.mockResolvedValue(undefined)
  })

  it('revalidates availability at confirmation time with excludeBookingId', async () => {
    const newStart = new Date('2026-06-16T14:00:00Z')

    await rescheduleBooking('booking-1', newStart)

    expect(mockAssertSlotIsAvailable).toHaveBeenCalledWith(expect.objectContaining({
      businessId,
      serviceId: 'svc-1',
      excludeBookingId: 'booking-1',
    }))
  })

  it('notifies the customer by email after the booking is rescheduled', async () => {
    const newStart = new Date('2026-06-16T14:00:00Z')

    await rescheduleBooking('booking-1', newStart)

    expect(mockSendBookingRescheduledNotification).toHaveBeenCalledWith(expect.objectContaining({
      businessName: 'Nails by Ana',
      businessReplyToEmail: 'owner@example.com',
      businessWhatsapp: '+56911111111',
      businessAddress: 'Av. Principal 123',
      businessTimezone: 'America/Santiago',
      customerName: 'Maria',
      customerEmail: 'maria@example.com',
      customerPhone: '+56912345678',
      serviceName: 'Manicure',
      previousStartDateTime: new Date('2026-06-15T14:00:00Z'),
      newStartDateTime: newStart,
      bookingNumber: 42,
    }))
  })

  // El include se asserta directo (con Prisma mockeado, mirar el email no
  // prueba que la consulta haya pedido la relación); reprogramar conserva a la
  // persona, así que el nombre leído antes de la tx es el que atiende.
  it('pide a la persona en la consulta y el email dice quién atiende', async () => {
    mockPrisma.booking.findFirst.mockResolvedValueOnce({
      ...booking,
      professional: { name: 'Juan Pérez' },
    })

    await rescheduleBooking('booking-1', new Date('2026-06-16T14:00:00Z'))

    expect(mockPrisma.booking.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      include: expect.objectContaining({ professional: { select: { name: true } } }),
    }))
    expect(mockSendBookingRescheduledNotification).toHaveBeenCalledWith(
      expect.objectContaining({ professionalName: 'Juan Pérez' }),
    )
  })

  it('fails when target slot is occupied at confirmation time', async () => {
    // UserError: refleja el throw real de assertSlotIsAvailable (validation.ts,
    // ya migrado) — un Error plano acá se volvería el mensaje genérico del wrapper.
    mockAssertSlotIsAvailable.mockRejectedValue(new UserError('Ese horario ya no está disponible. Por favor selecciona otro.'))

    const result = await rescheduleBooking('booking-1', new Date('2026-06-16T14:00:00Z'))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/horario ya no está disponible/)
  })

  // El chequeo de arriba y el EXCLUDE de la base son dos predicados distintos
  // sobre la misma pregunta; cuando difieren gana la base. Sin traducir su
  // rechazo, la dueña lee el genérico "Ocurrió un error inesperado" sobre un
  // horario que la pantalla le seguía ofreciendo.
  it('el rechazo del EXCLUDE (23P01) sale con el mismo mensaje que el chequeo de solape', async () => {
    mockPrisma.booking.updateMany.mockRejectedValue(
      new Error('conflicting key value violates exclusion constraint "Booking_no_overlap"'),
    )

    const result = await rescheduleBooking('booking-1', new Date('2026-06-16T14:00:00Z'))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBe(SLOT_UNAVAILABLE_MESSAGE)
  })

  it('does not update if booking became terminal during the transaction', async () => {
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 0 })

    const result = await rescheduleBooking('booking-1', new Date('2026-06-16T14:00:00Z'))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/No se puede reprogramar/)
  })

  it('does not allow completed, cancelled, no_show or expired bookings', async () => {
    for (const status of ['completed', 'cancelled', 'no_show', 'expired']) {
      mockPrisma.booking.findFirst.mockResolvedValueOnce({ ...booking, status })
      const result = await rescheduleBooking('booking-1', new Date('2026-06-16T14:00:00Z'))
      expect(result.ok).toBe(false)
      expect(!result.ok && result.error).toMatch(/No se puede reprogramar/)
    }
  })

  // `expired` ya estaba cubierto arriba; el que faltaba es el ANTERIOR: la
  // reserva que el cron todavía no asentó. Se veía viva, se dejaba mover, y el
  // sweep la mataba dentro de la hora con la dueña convencida de haberla salvado.
  it('no reprograma un plazo vencido que el cron todavía no barrió, y nombra Revivir', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({
      ...booking,
      status: 'pending_payment',
      paymentStatus: 'unpaid',
      holdExpiresAt: new Date('2026-06-15T10:00:00Z'),
    })

    const result = await rescheduleBooking('booking-1', new Date('2026-06-16T14:00:00Z'))

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBe(
      rescheduleBlockedReason(
        {
          status: 'pending_payment',
          paymentStatus: 'unpaid',
          holdExpiresAt: new Date('2026-06-15T10:00:00Z'),
          approvalExpiresAt: null,
        },
        'owner',
        new Date(),
      ),
    )
    // La salida tiene que estar escrita: un "no" sin salida es una app rota.
    expect(!result.ok && result.error).toMatch(/Revivir/)
    expect(mockPrisma.booking.updateMany).not.toHaveBeenCalled()
  })
})
