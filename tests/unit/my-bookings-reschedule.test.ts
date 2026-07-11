import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser, mockCheckRateLimit, mockFindFirstBooking, mockTx,
  mockRescheduleBookingInTx, mockSendNotificationSafely, mockSendMultiNotificationSafely,
  mockSendBookingRescheduledNotification, mockSendOwnerBookingChangedNotification,
  mockGetBusinessReplyToEmail, mockRevalidatePath, mockRevalidateBusinessPublicPaths,
  mockComputeRescheduleSlots,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFindFirstBooking: vi.fn(),
  mockTx: vi.fn(),
  mockRescheduleBookingInTx: vi.fn(),
  mockSendNotificationSafely: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  mockSendMultiNotificationSafely: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  mockSendBookingRescheduledNotification: vi.fn(),
  mockSendOwnerBookingChangedNotification: vi.fn(),
  mockGetBusinessReplyToEmail: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockRevalidateBusinessPublicPaths: vi.fn(),
  mockComputeRescheduleSlots: vi.fn(),
}))

vi.mock('@/lib/auth/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/server')>()
  return { ...mod, requireUser: mockRequireUser }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    booking: { findFirst: mockFindFirstBooking },
    $transaction: mockTx,
  },
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }))
vi.mock('@/lib/bookings/mutate', () => ({ rescheduleBookingInTx: mockRescheduleBookingInTx }))
vi.mock('@/lib/availability/reschedule-slots', () => ({ computeRescheduleSlots: mockComputeRescheduleSlots }))
vi.mock('@/lib/notifications', () => ({
  sendNotificationSafely: mockSendNotificationSafely,
  sendMultiNotificationSafely: mockSendMultiNotificationSafely,
  sendBookingRescheduledNotification: mockSendBookingRescheduledNotification,
  sendOwnerBookingChangedNotification: mockSendOwnerBookingChangedNotification,
  getBusinessReplyToEmail: mockGetBusinessReplyToEmail,
}))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: mockRevalidateBusinessPublicPaths }))
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

const NOW = new Date('2026-07-11T12:00:00Z')

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    internalNotes: null,
    bookingNumber: 4738,
    startDateTime: new Date(NOW.getTime() + 48 * 3_600_000),
    status: 'confirmed',
    service: { name: 'Manicure', durationMinutes: 60 },
    customer: { name: 'Maria', email: 'maria@example.com', phone: '+56911111111' },
    business: {
      id: 'b1', name: 'Nails by Ana', slug: 'nailsbyana', timezone: 'America/Santiago',
      isActive: true, selfServiceCutoffHours: 24, bookingWindowDays: 90,
      whatsapp: '+56922222222', addressText: 'Calle Falsa 123',
    },
    ...overrides,
  }
}

describe('rescheduleMyBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockRequireUser.mockResolvedValue({ id: 'u1' })
    mockCheckRateLimit.mockResolvedValue({ success: true })
    mockTx.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({}))
    mockGetBusinessReplyToEmail.mockResolvedValue('reply@nailsbyana.cl')
  })

  it('feliz: reprograma, notifica dueña y clienta, revalida todo, sin leadTimeMinutes', async () => {
    const booking = makeBooking()
    mockFindFirstBooking.mockResolvedValue(booking)
    const newStart = new Date(NOW.getTime() + 72 * 3_600_000)

    const { rescheduleMyBooking } = await import('@/server/actions/my-bookings')
    const result = await rescheduleMyBooking('bk-1', newStart)

    expect(result).toEqual({ rescheduled: true })
    expect(mockRescheduleBookingInTx).toHaveBeenCalledTimes(1)
    const [, arg] = mockRescheduleBookingInTx.mock.calls[0]
    expect(arg).not.toHaveProperty('leadTimeMinutes')
    expect(arg.newStartDateTime).toBe(newStart)
    expect(arg.durationMinutes).toBe(60)
    expect(arg.timezone).toBe('America/Santiago')

    expect(mockSendOwnerBookingChangedNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        businessId: 'b1',
        change: {
          kind: 'rescheduled',
          previousStartDateTime: booking.startDateTime,
          newStartDateTime: newStart,
        },
      }),
    )
    expect(mockSendBookingRescheduledNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'maria@example.com',
        previousStartDateTime: booking.startDateTime,
        newStartDateTime: newStart,
      }),
    )
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/bookings')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/mi/nailsbyana')
    expect(mockRevalidateBusinessPublicPaths).toHaveBeenCalledWith('b1')
  })

  it('ventana sobre horario ACTUAL: rechaza aunque el nuevo slot esté lejos', async () => {
    const booking = makeBooking({ startDateTime: new Date(NOW.getTime() + 2 * 3_600_000) })
    mockFindFirstBooking.mockResolvedValue(booking)
    const newStart = new Date(NOW.getTime() + 200 * 3_600_000)

    const { rescheduleMyBooking } = await import('@/server/actions/my-bookings')
    await expect(rescheduleMyBooking('bk-1', newStart)).rejects.toThrow(/reprogramar/)
    expect(mockRescheduleBookingInTx).not.toHaveBeenCalled()
  })

  it('nuevo slot fuera de bookingWindowDays: rechaza', async () => {
    const booking = makeBooking({ business: { ...makeBooking().business, bookingWindowDays: 90 } })
    mockFindFirstBooking.mockResolvedValue(booking)
    const newStart = new Date(NOW.getTime() + 120 * 24 * 3_600_000)

    const { rescheduleMyBooking } = await import('@/server/actions/my-bookings')
    await expect(rescheduleMyBooking('bk-1', newStart)).rejects.toThrow(/fuera del período de reservas/)
    expect(mockRescheduleBookingInTx).not.toHaveBeenCalled()
  })

  it('negocio suspendido: rechaza', async () => {
    const booking = makeBooking({ business: { ...makeBooking().business, isActive: false } })
    mockFindFirstBooking.mockResolvedValue(booking)
    const newStart = new Date(NOW.getTime() + 72 * 3_600_000)

    const { rescheduleMyBooking } = await import('@/server/actions/my-bookings')
    await expect(rescheduleMyBooking('bk-1', newStart)).rejects.toThrow(/no está aceptando reservas/)
    expect(mockRescheduleBookingInTx).not.toHaveBeenCalled()
  })

  it('ownership ajeno: booking no encontrado', async () => {
    mockFindFirstBooking.mockResolvedValue(null)

    const { rescheduleMyBooking } = await import('@/server/actions/my-bookings')
    await expect(rescheduleMyBooking('bk-1', new Date())).rejects.toThrow('Reserva no encontrada')
    expect(mockRescheduleBookingInTx).not.toHaveBeenCalled()
  })
})

describe('getMyRescheduleSlots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    mockRequireUser.mockResolvedValue({ id: 'u1' })
    mockCheckRateLimit.mockResolvedValue({ success: true })
  })

  it('ownership OK: delega a computeRescheduleSlots y retorna su valor', async () => {
    const booking = {
      id: 'bk-1', businessId: 'b1',
      service: { id: 's1', durationMinutes: 60, isActive: true },
      business: { timezone: 'America/Santiago', bookingWindowDays: 90, slotStepMinutes: 30 },
    }
    mockFindFirstBooking.mockResolvedValue(booking)
    const slots = [{ time: '10:00', available: true }]
    mockComputeRescheduleSlots.mockResolvedValue(slots)

    const { getMyRescheduleSlots } = await import('@/server/actions/my-bookings')
    const date = new Date('2026-07-15T00:00:00Z')
    const result = await getMyRescheduleSlots('bk-1', date)

    expect(result).toBe(slots)
    expect(mockComputeRescheduleSlots).toHaveBeenCalledWith(booking, date)
  })

  it('ownership ajeno: booking no encontrado', async () => {
    mockFindFirstBooking.mockResolvedValue(null)
    const { getMyRescheduleSlots } = await import('@/server/actions/my-bookings')
    await expect(getMyRescheduleSlots('bk-1', new Date())).rejects.toThrow('Reserva no encontrada')
  })

  it('servicio inactivo: rechaza', async () => {
    mockFindFirstBooking.mockResolvedValue({
      id: 'bk-1', businessId: 'b1',
      service: { id: 's1', durationMinutes: 60, isActive: false },
      business: { timezone: 'America/Santiago', bookingWindowDays: 90, slotStepMinutes: 30 },
    })
    const { getMyRescheduleSlots } = await import('@/server/actions/my-bookings')
    await expect(getMyRescheduleSlots('bk-1', new Date())).rejects.toThrow('Servicio no disponible')
    expect(mockComputeRescheduleSlots).not.toHaveBeenCalled()
  })
})
