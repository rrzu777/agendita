import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockResendSend = vi.fn()
const MockResend = vi.fn(function (this: Record<string, unknown>) {
  this.emails = { send: mockResendSend }
}) as unknown as { new (...args: unknown[]): { emails: { send: typeof mockResendSend } } } & { mock: typeof vi.fn }

vi.mock('resend', () => ({
  Resend: MockResend,
}))

const mockPrismaForEmail = {
  businessUser: {
    findMany: vi.fn(),
  },
}

vi.mock('@/lib/db', () => ({
  prisma: mockPrismaForEmail,
}))

vi.mock('@/lib/business/urls', () => ({
  getBusinessPublicUrl: vi.fn().mockReturnValue('https://nailsbyana.agendita.app'),
  getAppUrl: vi.fn().mockReturnValue('https://agendita.app'),
}))

const { sendOwnerBookingChangedNotification } = await import('@/lib/notifications/email-provider')

const baseData = {
  businessId: 'biz-1',
  businessName: 'Nails by Ana',
  businessTimezone: 'America/Santiago',
  customerName: 'Maria',
  serviceName: 'Manicure semipermanente',
  bookingNumber: 4738 as number | null,
  startDateTime: new Date('2026-08-01T15:00:00Z'),
}

describe('email-provider: sendOwnerBookingChangedNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('skips when no owners/admins have email', async () => {
    mockPrismaForEmail.businessUser.findMany.mockResolvedValue([])

    const results = await sendOwnerBookingChangedNotification({
      ...baseData,
      change: { kind: 'cancelled' },
    })

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].skipped).toContain('No hay owners/admins con email')
  })

  it('sends to all owners/admins for a cancellation, with "canceló" subject and #number', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: { id: 'msg_ok' }, error: null })

    mockPrismaForEmail.businessUser.findMany.mockResolvedValue([
      { user: { email: 'owner@nails.com', name: 'Ana' } },
      { user: { email: 'admin@nails.com', name: 'Luisa' } },
    ])

    const results = await sendOwnerBookingChangedNotification({
      ...baseData,
      change: { kind: 'cancelled' },
    })

    expect(mockResendSend).toHaveBeenCalledTimes(2)
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['owner@nails.com'],
        subject: expect.stringContaining('canceló'),
      }),
    )
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['admin@nails.com'],
        subject: expect.stringContaining('canceló'),
      }),
    )
    expect(mockResendSend.mock.calls[0][0].subject).toContain('Maria')
    expect(mockResendSend.mock.calls[0][0].html).toContain('Manicure semipermanente')
    expect(mockResendSend.mock.calls[0][0].html).toContain('#4738')
    expect(results.every((r) => r.success)).toBe(true)
  })

  it('sends "reprogramó" subject and includes both previous and new datetimes for a reschedule', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: { id: 'msg_ok' }, error: null })

    mockPrismaForEmail.businessUser.findMany.mockResolvedValue([
      { user: { email: 'owner@nails.com', name: 'Ana' } },
    ])

    const previousStartDateTime = new Date('2026-08-01T15:00:00Z')
    const newStartDateTime = new Date('2026-08-03T18:30:00Z')

    await sendOwnerBookingChangedNotification({
      ...baseData,
      startDateTime: previousStartDateTime,
      change: { kind: 'rescheduled', previousStartDateTime, newStartDateTime },
    })

    const call = mockResendSend.mock.calls[0][0]
    expect(call.subject).toContain('reprogramó')
    expect(call.subject).toContain('Maria')
    // 1 de agosto (previous) and 3 de agosto (new) should both appear in the body.
    expect(call.html).toContain('1 de agosto')
    expect(call.html).toContain('3 de agosto')
    expect(call.text).toContain('1 de agosto')
    expect(call.text).toContain('3 de agosto')
  })

  it('omits the booking number row when bookingNumber is null', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: { id: 'msg_ok' }, error: null })

    mockPrismaForEmail.businessUser.findMany.mockResolvedValue([
      { user: { email: 'owner@nails.com', name: 'Ana' } },
    ])

    await sendOwnerBookingChangedNotification({
      ...baseData,
      bookingNumber: null,
      change: { kind: 'cancelled' },
    })

    const call = mockResendSend.mock.calls[0][0]
    expect(call.html).not.toContain('Reserva</td>')
  })

  it('escapes HTML in customerName and serviceName', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: { id: 'msg_ok' }, error: null })

    mockPrismaForEmail.businessUser.findMany.mockResolvedValue([
      { user: { email: 'owner@nails.com', name: 'Ana' } },
    ])

    await sendOwnerBookingChangedNotification({
      ...baseData,
      customerName: '<script>alert(1)</script>',
      change: { kind: 'cancelled' },
    })

    const call = mockResendSend.mock.calls[0][0]
    expect(call.html).not.toContain('<script>')
  })
})
