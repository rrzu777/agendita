import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus } from '@prisma/client'

const mockPrisma = {
  booking: {
    findMany: vi.fn(),
    updateMany: vi.fn(),
  },
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrisma,
}))

const mockSendReminderEmail = vi.fn()
vi.mock('@/lib/notifications', () => ({
  sendReminderEmail: mockSendReminderEmail,
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  },
}))

const { sendReminders } = await import('@/lib/cron/send-reminders')

function makeBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    businessId: 'biz-1',
    totalPrice: 10000,
    remainingBalance: 5000,
    depositPaid: 5000,
    startDateTime: new Date('2026-05-21T14:00:00Z'),
    status: BookingStatus.confirmed,
    service: { name: 'Manicure' },
    customer: { name: 'Ana', phone: '+56912345678', email: 'ana@test.com' },
    business: {
      id: 'biz-1',
      name: 'Mimos Nails',
      timezone: 'America/Santiago',
      whatsapp: '+56987654321',
      addressText: 'Providencia',
      currency: 'CLP',
      slug: 'mimosnails',
      subdomain: 'mimosnails',
    },
    ...overrides,
  }
}

describe('sendReminders', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockSendReminderEmail.mockResolvedValue({ success: true })
    // Default: the atomic claim succeeds (this worker won the reminderSentAt CAS).
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 1 })
  })

  it('sends reminder and atomically claims reminderSentAt before sending', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([makeBooking()])

    const now = new Date('2026-05-20T12:00:00Z')
    const result = await sendReminders(now)

    expect(result.sent).toBe(1)
    expect(result.errors).toBe(0)
    expect(mockSendReminderEmail).toHaveBeenCalledTimes(1)
    // Claim is a conditional updateMany guarded on reminderSentAt: null (CAS).
    expect(mockPrisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', reminderSentAt: null },
      data: { reminderSentAt: expect.any(Date) },
    })
  })

  it('skips a booking already claimed by a concurrent run (claim count 0)', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([makeBooking()])
    mockPrisma.booking.updateMany.mockResolvedValue({ count: 0 })

    const now = new Date('2026-05-20T12:00:00Z')
    const result = await sendReminders(now)

    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    expect(mockSendReminderEmail).not.toHaveBeenCalled()
  })

  it('skips bookings with no customer email', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([
      makeBooking({ customer: { name: 'Ana', phone: '+56912345678', email: null } }),
    ])

    const now = new Date('2026-05-20T12:00:00Z')
    const result = await sendReminders(now)

    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    expect(mockSendReminderEmail).not.toHaveBeenCalled()
  })

  it('does not send if reminderSentAt already set', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([])

    const now = new Date('2026-05-20T12:00:00Z')
    const result = await sendReminders(now)

    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(0)
    expect(mockSendReminderEmail).not.toHaveBeenCalled()
  })

  it('only queries confirmed bookings', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([])

    const now = new Date('2026-05-20T12:00:00Z')
    await sendReminders(now)

    const queryArgs = mockPrisma.booking.findMany.mock.calls[0][0]
    expect(queryArgs.where.status).toBe(BookingStatus.confirmed)
    expect(queryArgs.where.reminderSentAt).toBe(null)
  })

  it('window is ~24h ahead', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([])

    const now = new Date('2026-05-20T12:00:00Z')
    await sendReminders(now)

    const queryArgs = mockPrisma.booking.findMany.mock.calls[0][0]
    const gte = queryArgs.where.startDateTime.gte
    const lte = queryArgs.where.startDateTime.lte

    // 23h ahead
    const expectedGte = new Date(now.getTime() + 23 * 60 * 60 * 1000)
    // 25h ahead
    const expectedLte = new Date(now.getTime() + 25 * 60 * 60 * 1000)

    expect(gte.getTime()).toBe(expectedGte.getTime())
    expect(lte.getTime()).toBe(expectedLte.getTime())
  })

  it('releases the claim (resets reminderSentAt to null) if email throws', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([makeBooking()])
    mockSendReminderEmail.mockRejectedValue(new Error('Boom'))

    const now = new Date('2026-05-20T12:00:00Z')
    const result = await sendReminders(now)

    expect(result.errors).toBe(1)
    expect(result.sent).toBe(0)
    // The claim is released so a later run can retry.
    expect(mockPrisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', reminderSentAt: now },
      data: { reminderSentAt: null },
    })
  })

  it('releases the claim if email result.success is false', async () => {
    mockPrisma.booking.findMany.mockResolvedValue([makeBooking()])
    mockSendReminderEmail.mockResolvedValue({ success: false, skipped: 'no key' })

    const now = new Date('2026-05-20T12:00:00Z')
    const result = await sendReminders(now)

    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    expect(mockPrisma.booking.updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', reminderSentAt: now },
      data: { reminderSentAt: null },
    })
  })
})
