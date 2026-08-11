import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRequireUser, mockCheckRateLimit, mockFindFirstBooking, mockFindUniqueBooking, mockTx,
  mockCancelBookingInTx, mockSendNotificationSafely, mockSendMultiNotificationSafely,
  mockSendBookingCancelledNotification, mockSendOwnerBookingChangedNotification,
  mockGetBusinessReplyToEmail, mockRevalidatePath, mockRevalidateBusinessPublicPaths,
} = vi.hoisted(() => ({
  mockRequireUser: vi.fn(),
  mockCheckRateLimit: vi.fn(),
  mockFindFirstBooking: vi.fn(),
  mockFindUniqueBooking: vi.fn(),
  mockTx: vi.fn(),
  mockCancelBookingInTx: vi.fn(),
  mockSendNotificationSafely: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  mockSendMultiNotificationSafely: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
  mockSendBookingCancelledNotification: vi.fn(),
  mockSendOwnerBookingChangedNotification: vi.fn(),
  mockGetBusinessReplyToEmail: vi.fn(),
  mockRevalidatePath: vi.fn(),
  mockRevalidateBusinessPublicPaths: vi.fn(),
}))

vi.mock('@/lib/auth/server', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/auth/server')>()
  return { ...mod, requireUser: mockRequireUser }
})
vi.mock('@/lib/db', () => ({
  prisma: {
    // findUnique: la relee loadBookingCancelNotice para armar el .ics de
    // cancelación; null = reserva sin evento que borrar (camino simple).
    booking: { findFirst: mockFindFirstBooking, findUnique: mockFindUniqueBooking },
    $transaction: mockTx,
  },
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: mockCheckRateLimit }))
vi.mock('@/lib/bookings/mutate', () => ({ cancelBookingInTx: mockCancelBookingInTx }))
vi.mock('@/lib/notifications', () => ({
  sendNotificationSafely: mockSendNotificationSafely,
  sendMultiNotificationSafely: mockSendMultiNotificationSafely,
  sendBookingCancelledNotification: mockSendBookingCancelledNotification,
  sendOwnerBookingChangedNotification: mockSendOwnerBookingChangedNotification,
  getBusinessReplyToEmail: mockGetBusinessReplyToEmail,
}))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: mockRevalidateBusinessPublicPaths }))
vi.mock('next/cache', () => ({ revalidatePath: mockRevalidatePath }))

function makeBooking(overrides: Record<string, unknown> = {}) {
  const now = new Date('2026-07-11T12:00:00Z')
  return {
    id: 'bk-1',
    internalNotes: null,
    bookingNumber: 4738,
    startDateTime: new Date(now.getTime() + 48 * 3_600_000),
    status: 'confirmed',
    cancellationCutoffHours: 24,
    cancellationPolicySnapshot: null,
    service: { name: 'Manicure' },
    customer: { name: 'Maria', email: 'maria@example.com' },
    business: {
      id: 'b1', name: 'Nails by Ana', slug: 'nailsbyana',
      timezone: 'America/Santiago', selfServiceCutoffHours: 24,
    },
    ...overrides,
  }
}

describe('cancelMyBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Congelar SOLO Date (no los timers, para no colgar los await) al mismo
    // instante que usa makeBooking; si no, canSelfManage usa el reloj real y el
    // test de "dentro de ventana" falla por date-drift al correr días después.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-07-11T12:00:00Z'))
    mockRequireUser.mockResolvedValue({ id: 'u1' })
    mockCheckRateLimit.mockResolvedValue({ success: true })
    mockFindUniqueBooking.mockResolvedValue(null)
    mockTx.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({}))
    mockGetBusinessReplyToEmail.mockResolvedValue(null)
    mockSendBookingCancelledNotification.mockResolvedValue({ success: true })
    mockSendOwnerBookingChangedNotification.mockResolvedValue([{ success: true }])
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('feliz: cancela una reserva propia dentro de la ventana', async () => {
    mockFindFirstBooking.mockResolvedValue(makeBooking())
    const { cancelMyBooking } = await import('@/server/actions/my-bookings')

    const result = await cancelMyBooking('bk-1')

    expect(result).toEqual({ ok: true, data: { cancelled: true } })
    expect(mockCancelBookingInTx).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ id: 'bk-1' }),
      expect.objectContaining({ reason: expect.any(String) }),
    )
    expect(mockSendMultiNotificationSafely).toHaveBeenCalled()
    expect(mockSendOwnerBookingChangedNotification).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 'b1', change: { kind: 'cancelled' } }),
    )
    expect(mockSendNotificationSafely).toHaveBeenCalled()
    expect(mockSendBookingCancelledNotification).toHaveBeenCalledWith(
      expect.objectContaining({ customerEmail: 'maria@example.com' }),
    )
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/bookings')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/dashboard/calendar')
    expect(mockRevalidatePath).toHaveBeenCalledWith('/mi/nailsbyana')
    expect(mockRevalidateBusinessPublicPaths).toHaveBeenCalledWith('b1')
  })

  // El select se asserta directo: con Prisma mockeado, mirar el aviso de
  // salida no prueba que la consulta haya pedido la relación.
  it('el aviso a la dueña dice a quién se le libera la hora', async () => {
    mockFindFirstBooking.mockResolvedValue(makeBooking({ professional: { name: 'Juan Pérez' } }))
    const { cancelMyBooking } = await import('@/server/actions/my-bookings')

    await cancelMyBooking('bk-1')

    expect(mockFindFirstBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          cancellationCutoffHours: true,
          cancellationPolicySnapshot: true,
          professional: { select: { name: true } },
        }),
      }),
    )
    expect(mockSendOwnerBookingChangedNotification).toHaveBeenCalledWith(
      expect.objectContaining({ professionalName: 'Juan Pérez' }),
    )
  })

  it('ownership ajeno: findFirst no encuentra reserva de otro usuario', async () => {
    mockFindFirstBooking.mockResolvedValue(null)
    const { cancelMyBooking } = await import('@/server/actions/my-bookings')

    const result = await cancelMyBooking('bk-ajena')

    expect(result).toEqual({ ok: false, error: 'Reserva no encontrada' })
    expect(mockTx).not.toHaveBeenCalled()
    expect(mockCancelBookingInTx).not.toHaveBeenCalled()
  })

  it('fuera de ventana: rechaza cancelación dentro del cutoff', async () => {
    const now = new Date('2026-07-11T12:00:00Z')
    mockFindFirstBooking.mockResolvedValue(
      makeBooking({ startDateTime: new Date(now.getTime() + 2 * 3_600_000) }),
    )
    const { cancelMyBooking } = await import('@/server/actions/my-bookings')

    const result = await cancelMyBooking('bk-1')

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/hasta 24 horas/)
    expect(mockCancelBookingInTx).not.toHaveBeenCalled()
  })

  it('el snapshot de cutoff manda aunque el negocio lo haya cambiado', async () => {
    const now = new Date('2026-07-11T12:00:00Z')
    mockFindFirstBooking.mockResolvedValue(
      makeBooking({
        startDateTime: new Date(now.getTime() + 2 * 3_600_000),
        cancellationCutoffHours: 1,
      }),
    )
    const { cancelMyBooking } = await import('@/server/actions/my-bookings')

    const result = await cancelMyBooking('bk-1')

    expect(result).toEqual({ ok: true, data: { cancelled: true } })
  })

  it('una reserva legacy sin snapshot usa el cutoff actual del negocio', async () => {
    const now = new Date('2026-07-11T12:00:00Z')
    mockFindFirstBooking.mockResolvedValue(
      makeBooking({
        startDateTime: new Date(now.getTime() + 2 * 3_600_000),
        cancellationCutoffHours: null,
      }),
    )
    const { cancelMyBooking } = await import('@/server/actions/my-bookings')

    const result = await cancelMyBooking('bk-1')

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/hasta 24 horas/)
  })

  it('status no cancelable: el where excluye la reserva (findFirst → null)', async () => {
    mockFindFirstBooking.mockResolvedValue(null)
    const { cancelMyBooking } = await import('@/server/actions/my-bookings')

    const result = await cancelMyBooking('bk-completed')

    expect(result).toEqual({ ok: false, error: 'Reserva no encontrada' })
    expect(mockFindFirstBooking).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { in: ['pending_payment', 'pending_confirmation', 'confirmed'] },
        }),
      }),
    )
  })

  it('rate limit: rechaza sin consultar prisma', async () => {
    mockCheckRateLimit.mockResolvedValue({ success: false })
    const { cancelMyBooking } = await import('@/server/actions/my-bookings')

    const result = await cancelMyBooking('bk-1')

    expect(result.ok).toBe(false)
    expect(mockFindFirstBooking).not.toHaveBeenCalled()
  })
})
