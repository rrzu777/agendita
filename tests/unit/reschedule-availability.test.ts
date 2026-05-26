import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRequireBusinessRole = vi.fn()
const mockGenerateSlots = vi.fn()
const mockAssertSlotIsAvailable = vi.fn()

const mockPrisma = {
  booking: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  availabilityRule: { findMany: vi.fn() },
  timeBlock: { findMany: vi.fn() },
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: (...args: unknown[]) => mockRequireBusinessRole(...args),
  requireBusiness: vi.fn(),
  ForbiddenError: class extends Error {},
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

vi.mock('@/lib/availability/validation', () => ({
  assertSlotIsAvailable: (...args: unknown[]) => mockAssertSlotIsAvailable(...args),
}))

vi.mock('@/lib/notifications', () => ({
  sendBookingCancelledNotification: vi.fn(),
  sendNotificationSafely: vi.fn().mockResolvedValue({ success: true }),
}))

const { getAvailableSlotsForReschedule } = await import('@/server/actions/availability')
const { rescheduleBooking } = await import('@/server/actions/bookings')

const businessId = 'biz-1'
const booking = {
  id: 'booking-1',
  businessId,
  serviceId: 'svc-1',
  status: 'confirmed',
  startDateTime: new Date('2026-06-15T14:00:00Z'),
  endDateTime: new Date('2026-06-15T15:00:00Z'),
  service: { id: 'svc-1', durationMinutes: 60, name: 'Manicure', isActive: true },
  business: { timezone: 'America/Santiago', bookingWindowDays: 90 },
}

describe('getAvailableSlotsForReschedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusinessRole.mockResolvedValue({ businessId, business: { timezone: 'America/Santiago' } })
    mockPrisma.booking.findFirst.mockResolvedValue(booking)
    mockPrisma.availabilityRule.findMany.mockResolvedValue([{ dayOfWeek: 1, startTime: '09:00', endTime: '18:00', isActive: true }])
    mockPrisma.timeBlock.findMany.mockResolvedValue([])
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
    const slots = await getAvailableSlotsForReschedule('booking-1', new Date('2026-06-15T00:00:00Z'))

    expect(slots[0].start).toEqual(new Date('2026-06-15T14:00:00Z'))
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
      [block],
      [busyBooking],
      expect.objectContaining({ timezone: 'America/Santiago', bookingWindowDays: 90 }),
    )
  })

  it('rejects cross-tenant bookingId', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue(null)

    await expect(getAvailableSlotsForReschedule('booking-other', new Date('2026-06-15T00:00:00Z')))
      .rejects.toThrow(/Reserva no encontrada/)
  })

  it('rejects terminal statuses', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({ ...booking, status: 'completed' })

    await expect(getAvailableSlotsForReschedule('booking-1', new Date('2026-06-15T00:00:00Z')))
      .rejects.toThrow(/No se puede reprogramar/)
  })

  it('rejects inactive services to match final availability validation', async () => {
    mockPrisma.booking.findFirst.mockResolvedValue({ ...booking, service: { ...booking.service, isActive: false } })

    await expect(getAvailableSlotsForReschedule('booking-1', new Date('2026-06-15T00:00:00Z')))
      .rejects.toThrow(/Servicio no disponible/)
  })

  it('respects TimeBlocks by passing them into slot generation', async () => {
    const block = { startDateTime: new Date('2026-06-15T14:00:00Z'), endDateTime: new Date('2026-06-15T15:00:00Z') }
    mockPrisma.timeBlock.findMany.mockResolvedValue([block])

    await getAvailableSlotsForReschedule('booking-1', new Date('2026-06-15T00:00:00Z'))

    expect(mockGenerateSlots.mock.calls[0][3]).toEqual([block])
  })
})

describe('rescheduleBooking terminal states and availability', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequireBusinessRole.mockResolvedValue({ businessId, business: { timezone: 'America/Santiago' } })
    mockPrisma.booking.findFirst.mockResolvedValue(booking)
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })
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

  it('fails when target slot is occupied at confirmation time', async () => {
    mockAssertSlotIsAvailable.mockRejectedValue(new Error('Ese horario ya no está disponible. Por favor selecciona otro.'))

    await expect(rescheduleBooking('booking-1', new Date('2026-06-16T14:00:00Z')))
      .rejects.toThrow(/horario ya no está disponible/)
  })

  it('does not update if booking became terminal during the transaction', async () => {
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 0 })

    await expect(rescheduleBooking('booking-1', new Date('2026-06-16T14:00:00Z')))
      .rejects.toThrow(/No se puede reprogramar/)
  })

  it('does not allow completed, cancelled, no_show or expired bookings', async () => {
    for (const status of ['completed', 'cancelled', 'no_show', 'expired']) {
      mockPrisma.booking.findFirst.mockResolvedValueOnce({ ...booking, status })
      await expect(rescheduleBooking('booking-1', new Date('2026-06-16T14:00:00Z')))
        .rejects.toThrow(/No se puede reprogramar/)
    }
  })
})
