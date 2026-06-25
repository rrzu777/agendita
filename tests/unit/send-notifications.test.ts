import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus } from '@prisma/client'

// ── Mock external dependencies ───────────────────────────────────────────────

vi.mock('@/lib/db', () => {
  const mockBooking = {
    id: 'booking-1',
    businessId: 'biz-1',
    customerId: 'cust-1',
    status: BookingStatus.confirmed,
    startDateTime: new Date('2026-06-15T18:00:00Z'),
    totalPrice: 25000,
    depositRequired: 5000,
    depositPaid: 5000,
    remainingBalance: 20000,
    service: { name: 'Manicure semipermanente' },
    customer: { name: 'Maria', phone: '+56987654321', email: 'maria@example.com' },
    business: {
      name: 'Nails by Ana',
      timezone: 'America/Santiago',
      whatsapp: '+56912345678',
      addressText: 'Av. Siempre Viva 742',
      currency: 'CLP',
      cancellationPolicy: 'Cancela con 24h.',
    },
  }
  return {
    prisma: {
      booking: {
        findFirst: vi.fn().mockResolvedValue(mockBooking),
      },
      payment: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'pay-1',
          bookingId: 'booking-1',
          businessId: 'biz-1',
          amount: 5000,
          currency: 'CLP',
          status: 'approved',
          booking: {
            startDateTime: new Date('2026-06-15T18:00:00Z'),
            service: { name: 'Manicure semipermanente' },
            customer: { name: 'Maria', email: 'maria@example.com' },
            business: { name: 'Nails by Ana', timezone: 'America/Santiago', currency: 'CLP' },
          },
        }),
      },
    },
  }
})

vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

// ── Mock Resend fetch (test API, not the SDK, to test actual HTTP call) ──────

const mockFetch = vi.fn()
vi.stubEnv('RESEND_API_KEY', 're_test_123')
vi.stubEnv('FROM_EMAIL', 'hola@agendita.com')

vi.stubEnv('NEXT_PUBLIC_APP_DOMAIN', 'localhost:3000')

// ── Mock resend SDK ───────────────────────────────────────────────────────────

const mockResendSend = vi.fn()
vi.mock('resend', () => ({
  Resend: vi.fn(function (this: { emails: { send: typeof mockResendSend } }) {
    this.emails = { send: mockResendSend }
  }),
}))

// ── Import after mocks ────────────────────────────────────────────────────────

const {
  sendBookingConfirmedNotification,
  sendBookingReminderNotification,
  sendBookingCancelledNotificationById,
  sendPaymentReceivedNotification,
  sendNotificationSafely,
} = await import('@/lib/notifications/email-provider')

// ── Test data ─────────────────────────────────────────────────────────────────

const confirmedBooking = {
  id: 'booking-1',
  businessId: 'biz-1',
  customerId: 'cust-1',
  status: BookingStatus.confirmed,
  startDateTime: new Date('2026-06-15T18:00:00Z'),
  totalPrice: 25000,
  depositRequired: 5000,
  depositPaid: 5000,
  remainingBalance: 20000,
  service: { name: 'Manicure semipermanente' },
  customer: { name: 'Maria', phone: '+56987654321', email: 'maria@example.com' },
  business: {
    name: 'Nails by Ana',
    timezone: 'America/Santiago',
    whatsapp: '+56912345678',
    addressText: 'Av. Siempre Viva 742',
    currency: 'CLP',
    cancellationPolicy: 'Cancela con 24h.',
  },
}

const paymentData = {
  id: 'pay-1',
  bookingId: 'booking-1',
  businessId: 'biz-1',
  amount: 5000,
  currency: 'CLP',
  status: 'approved',
  booking: {
    startDateTime: new Date('2026-06-15T18:00:00Z'),
    service: { name: 'Manicure semipermanente' },
    customer: { name: 'Maria', email: 'maria@example.com' },
    business: { name: 'Nails by Ana', timezone: 'America/Santiago', currency: 'CLP' },
  },
}

describe('sendBookingConfirmedNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResendSend.mockReset()
  })

  it('calls Resend with correct template data', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'msg_123' }, error: null })

    const result = await sendBookingConfirmedNotification('booking-1', 'biz-1')

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'hola@agendita.com',
        to: ['maria@example.com'],
        subject: expect.stringContaining('Nails by Ana'),
      }),
    )
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg_123')
  })

  it('includes customer name, service, and booking details in email', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'msg_456' }, error: null })

    await sendBookingConfirmedNotification('booking-1', 'biz-1')

    const call = mockResendSend.mock.calls[0][0]
    expect(call.html).toContain('Maria')
    expect(call.html).toContain('Manicure semipermanente')
    expect(call.text).toContain('Maria')
    expect(call.text).toContain('Manicure semipermanente')
  })

  it('returns graceful result when booking is not found', async () => {
    const { prisma } = await import('@/lib/db')
    ;(prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const result = await sendBookingConfirmedNotification('nonexistent', 'biz-1')

    expect(result.success).toBe(false)
    expect(result.skipped).toBe('Cliente sin email o booking no encontrado')
  })

  it('returns graceful result when Resend API throws', async () => {
    mockResendSend.mockRejectedValue(new Error('Network error'))

    const result = await sendBookingConfirmedNotification('booking-1', 'biz-1')

    expect(result.success).toBe(false)
    expect(result.error).toBe('Network error')
  })

  it('does not throw when Resend fails', async () => {
    mockResendSend.mockRejectedValue(new Error('API down'))

    await expect(
      sendBookingConfirmedNotification('booking-1', 'biz-1'),
    ).resolves.toBeDefined()
  })
})

describe('sendBookingReminderNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResendSend.mockReset()
  })

  it('calls Resend with reminder template', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'msg_reminder_1' }, error: null })

    const result = await sendBookingReminderNotification('booking-1', 'biz-1')

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'hola@agendita.com',
        to: ['maria@example.com'],
        subject: expect.stringContaining('Recordatorio'),
      }),
    )
    expect(result.success).toBe(true)
  })

  it('skips gracefully when booking not found', async () => {
    const { prisma } = await import('@/lib/db')
    ;(prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const result = await sendBookingReminderNotification('nonexistent', 'biz-1')

    expect(result.success).toBe(false)
    expect(result.skipped).toBe('Booking not found or customer has no email')
  })
})

describe('sendBookingCancelledNotificationById', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResendSend.mockReset()
  })

  it('calls Resend with cancellation template', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'msg_cancel_1' }, error: null })

    const result = await sendBookingCancelledNotificationById('booking-1', 'biz-1')

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'hola@agendita.com',
        to: ['maria@example.com'],
        subject: expect.stringContaining('cancelada'),
      }),
    )
    expect(result.success).toBe(true)
  })

  it('skips gracefully when booking not found', async () => {
    const { prisma } = await import('@/lib/db')
    ;(prisma.booking.findFirst as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const result = await sendBookingCancelledNotificationById('nonexistent', 'biz-1')

    expect(result.success).toBe(false)
    expect(result.skipped).toBe('Booking not found or customer has no email')
  })
})

describe('sendPaymentReceivedNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockResendSend.mockReset()
  })

  it('calls Resend with payment received template', async () => {
    mockResendSend.mockResolvedValue({ data: { id: 'msg_pay_1' }, error: null })

    const result = await sendPaymentReceivedNotification('pay-1', 'biz-1')

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'hola@agendita.com',
        to: ['maria@example.com'],
        subject: expect.stringContaining('Abono recibido'),
      }),
    )
    expect(result.success).toBe(true)
  })

  it('skips gracefully when payment not found', async () => {
    const { prisma } = await import('@/lib/db')
    ;(prisma.payment.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null)

    const result = await sendPaymentReceivedNotification('nonexistent', 'biz-1')

    expect(result.success).toBe(false)
    expect(result.skipped).toBe('Payment not found')
  })

  it('skips gracefully when customer has no email', async () => {
    const { prisma } = await import('@/lib/db')
    ;(prisma.payment.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ...paymentData,
      booking: { ...paymentData.booking, customer: { ...paymentData.booking.customer, email: null } },
    })

    const result = await sendPaymentReceivedNotification('pay-1', 'biz-1')

    expect(result.success).toBe(false)
    expect(result.skipped).toBe('Customer has no email')
  })
})

describe('sendNotificationSafely wrapper', () => {
  it('returns result when inner function succeeds', async () => {
    const result = await sendNotificationSafely('test', async () => ({
      success: true,
      messageId: 'msg-ok',
    }))
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-ok')
  })

  it('returns error result when inner function throws', async () => {
    const result = await sendNotificationSafely('test-fail', async () => {
      throw new Error('Boom')
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Boom')
  })

  it('never throws — always returns EmailResult', async () => {
    await expect(
      sendNotificationSafely('never-throws', async () => {
        throw new Error('Should not propagate')
      }),
    ).resolves.toMatchObject({ success: false })
  })
})

describe('email provider: missing env', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('skips when RESEND_API_KEY is not set', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('FROM_EMAIL', 'hola@agendita.com')

    const { sendBookingConfirmedNotification: fn } = await import('@/lib/notifications/email-provider')
    const result = await fn('booking-1', 'biz-1')

    expect(result.success).toBe(false)
    expect(result.skipped).toBe('RESEND_API_KEY no configurada')
  })

  it('skips when FROM_EMAIL is not set', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', '')

    const { sendBookingConfirmedNotification: fn } = await import('@/lib/notifications/email-provider')
    const result = await fn('booking-1', 'biz-1')

    expect(result.success).toBe(false)
    expect(result.skipped).toBe('FROM_EMAIL no configurado')
  })
})