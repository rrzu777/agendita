import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Templates ──────────────────────────────────────────────────────────────

import {
  bookingConfirmationCustomerHtml,
  bookingConfirmationCustomerText,
  newBookingBusinessHtml,
  newBookingBusinessText,
  bookingCancelledCustomerHtml,
  bookingCancelledCustomerText,
  reviewRequestHtml,
  reviewRequestText,
} from '@/lib/notifications/templates'

const sampleBookingData = {
  businessName: 'Nails by Ana',
  businessReplyToEmail: 'owner@nails.com',
  businessWhatsapp: '+56912345678',
  businessAddress: 'Av. Siempre Viva 742, Santiago',
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  businessCancellationPolicy: 'Cancela con 24h de anticipación.',
  customerName: 'Maria',
  customerEmail: 'maria@example.com',
  customerPhone: '+56987654321',
  serviceName: 'Manicure semipermanente',
  startDateTime: new Date('2026-06-15T18:00:00Z'),
  totalPrice: 25000,
  depositRequired: 5000,
  depositPaid: 5000,
  remainingBalance: 20000,
  reviewLink: 'https://agendita.app/review/booking-1?token=abc',
}

const sampleBusinessData = {
  businessName: 'Nails by Ana',
  customerName: 'Maria',
  customerPhone: '+56987654321',
  customerEmail: 'maria@example.com',
  serviceName: 'Manicure semipermanente',
  startDateTime: new Date('2026-06-15T18:00:00Z'),
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  depositRequired: 5000,
  remainingBalance: 20000,
  dashboardLink: 'https://nailsbyana.agendita.app/dashboard/bookings',
}

const sampleCancellationData = {
  businessName: 'Nails by Ana',
  businessReplyToEmail: 'owner@nails.com',
  customerName: 'Maria',
  customerEmail: 'maria@example.com',
  serviceName: 'Manicure semipermanente',
  startDateTime: new Date('2026-06-15T18:00:00Z'),
  businessTimezone: 'America/Santiago',
}

const sampleReviewData = {
  businessName: 'Nails by Ana',
  businessReplyToEmail: 'owner@nails.com',
  customerName: 'Maria',
  customerEmail: 'maria@example.com',
  serviceName: 'Manicure semipermanente',
  reviewLink: 'https://agendita.app/review/booking-1?token=abc',
  startDateTime: new Date('2026-06-15T18:00:00Z'),
  businessTimezone: 'America/Santiago',
}

describe('templates: bookingConfirmationCustomerHtml', () => {
  it('contains customer name', () => {
    const html = bookingConfirmationCustomerHtml(sampleBookingData)
    expect(html).toContain('Maria')
  })

  it('contains service name', () => {
    const html = bookingConfirmationCustomerHtml(sampleBookingData)
    expect(html).toContain('Manicure semipermanente')
  })

  it('contains address', () => {
    const html = bookingConfirmationCustomerHtml(sampleBookingData)
    expect(html).toContain('Av. Siempre Viva 742')
  })

  it('contains price info', () => {
    const html = bookingConfirmationCustomerHtml(sampleBookingData)
    expect(html).toContain('$25.000')
  })

  it('contains cancellation policy', () => {
    const html = bookingConfirmationCustomerHtml(sampleBookingData)
    expect(html).toContain('Cancela con 24h de anticipación')
  })

  it('contains review link', () => {
    const html = bookingConfirmationCustomerHtml(sampleBookingData)
    expect(html).toContain('https://agendita.app/review/booking-1?token=abc')
  })

  it('contains whatsapp link', () => {
    const html = bookingConfirmationCustomerHtml(sampleBookingData)
    expect(html).toContain('wa.me/56912345678')
  })

  it('omits address when null', () => {
    const html = bookingConfirmationCustomerHtml({
      ...sampleBookingData,
      businessAddress: null,
    })
    expect(html).not.toContain('Av. Siempre Viva')
  })

  it('omits cancellation policy when null', () => {
    const html = bookingConfirmationCustomerHtml({
      ...sampleBookingData,
      businessCancellationPolicy: null,
    })
    expect(html).not.toContain('anticipación')
  })

  it('omits review link when undefined', () => {
    const html = bookingConfirmationCustomerHtml({
      ...sampleBookingData,
      reviewLink: undefined,
    })
    expect(html).not.toContain('Dejar una reseña')
  })

  it('omits whatsapp when null', () => {
    const html = bookingConfirmationCustomerHtml({
      ...sampleBookingData,
      businessWhatsapp: null,
    })
    expect(html).not.toContain('wa.me')
  })

  it('incluye el link de Mi tarjeta cuando se provee', () => {
    const html = bookingConfirmationCustomerHtml({ ...sampleBookingData, loyaltyCardLink: 'https://x.test/tarjeta/abc' })
    expect(html).toContain('/tarjeta/abc')
    expect(html).toContain('tarjeta de puntos')
  })

  it('omite la sección si no hay link', () => {
    const html = bookingConfirmationCustomerHtml({ ...sampleBookingData, loyaltyCardLink: undefined })
    expect(html).not.toContain('tarjeta de puntos')
  })
})

describe('templates: bookingConfirmationCustomerText', () => {
  it('contains key data', () => {
    const text = bookingConfirmationCustomerText(sampleBookingData)
    expect(text).toContain('Maria')
    expect(text).toContain('Manicure semipermanente')
    expect(text).toContain('$25.000')
    expect(text).toContain('Saldo pendiente')
  })
})

describe('templates: newBookingBusinessHtml', () => {
  it('contains customer name, phone, and service', () => {
    const html = newBookingBusinessHtml(sampleBusinessData)
    expect(html).toContain('Maria')
    expect(html).toContain('+56987654321')
    expect(html).toContain('Manicure semipermanente')
  })

  it('contains dashboard link', () => {
    const html = newBookingBusinessHtml(sampleBusinessData)
    expect(html).toContain('dashboard/bookings')
  })

  it('contains customer email when present', () => {
    const html = newBookingBusinessHtml(sampleBusinessData)
    expect(html).toContain('maria@example.com')
  })

  it('omits customer email row when null', () => {
    const html = newBookingBusinessHtml({
      ...sampleBusinessData,
      customerEmail: null,
    })
    expect(html).not.toContain('maria@example.com')
  })
})

describe('templates: newBookingBusinessText', () => {
  it('contains key data in text', () => {
    const text = newBookingBusinessText(sampleBusinessData)
    expect(text).toContain('Maria')
    expect(text).toContain('Manicure semipermanente')
    expect(text).toContain('dashboard/bookings')
  })
})

describe('templates: bookingCancelledCustomerHtml', () => {
  it('contains customer name and service', () => {
    const html = bookingCancelledCustomerHtml(sampleCancellationData)
    expect(html).toContain('Maria')
    expect(html).toContain('Manicure semipermanente')
    expect(html).toContain('cancelada')
  })
})

describe('templates: bookingCancelledCustomerText', () => {
  it('contains key data', () => {
    const text = bookingCancelledCustomerText(sampleCancellationData)
    expect(text).toContain('Maria')
    expect(text).toContain('cancelada')
  })
})

describe('templates: reviewRequestHtml', () => {
  it('contains review link', () => {
    const html = reviewRequestHtml(sampleReviewData)
    expect(html).toContain('https://agendita.app/review/booking-1?token=abc')
  })

  it('contains customer and service name', () => {
    const html = reviewRequestHtml(sampleReviewData)
    expect(html).toContain('Maria')
    expect(html).toContain('Manicure semipermanente')
  })
})

describe('templates: reviewRequestText', () => {
  it('contains review link', () => {
    const text = reviewRequestText(sampleReviewData)
    expect(text).toContain('https://agendita.app/review/booking-1?token=abc')
  })
})

// ── HTML Escape ─────────────────────────────────────────────────────────────

describe('templates: HTML escape', () => {
  it('escapes <script> in customerName', () => {
    const xssData = {
      ...sampleBookingData,
      customerName: '<script>alert("xss")</script>',
    }
    const html = bookingConfirmationCustomerHtml(xssData)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&quot;xss&quot;')
  })

  it('escapes <b> tag in serviceName', () => {
    const data = { ...sampleBookingData, serviceName: '<b>bold</b>' }
    const html = bookingConfirmationCustomerHtml(data)
    expect(html).not.toContain('<b>')
    expect(html).toContain('&lt;b&gt;bold&lt;/b&gt;')
  })

  it('escapes HTML in businessCancellationPolicy', () => {
    const data = { ...sampleBookingData, businessCancellationPolicy: '<a onclick="hack()">cancel</a>' }
    const html = bookingConfirmationCustomerHtml(data)
    expect(html).not.toContain('<a onclick')
    expect(html).toContain('&lt;a onclick')
  })

  it('escapes HTML in businessAddress', () => {
    const data = { ...sampleBookingData, businessAddress: '<img src=x onerror=alert(1)>' }
    const html = bookingConfirmationCustomerHtml(data)
    expect(html).not.toContain('<img')
    expect(html).toContain('&lt;img')
  })

  it('escapes businessName in footer', () => {
    const data = { ...sampleBookingData, businessName: 'Nails & More<>"' }
    const html = bookingConfirmationCustomerHtml(data)
    expect(html).toContain('Nails &amp; More&lt;&gt;&quot;')
  })

  it('escapes customerName in newBookingBusinessHtml', () => {
    const data = { ...sampleBusinessData, customerName: '<script>xss</script>' }
    const html = newBookingBusinessHtml(data)
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;xss&lt;/script&gt;')
  })

  it('escaping does not break URL in href attributes', () => {
    const data = sampleBookingData
    const html = bookingConfirmationCustomerHtml(data)
    expect(html).toContain('href="https://agendita.app/review/booking-1?token=abc"')
  })

  it('escaping does not break dashboard link in business email', () => {
    const data = sampleBusinessData
    const html = newBookingBusinessHtml(data)
    expect(html).toContain('href="https://nailsbyana.agendita.app/dashboard/bookings"')
  })
})

// ── WhatsApp ───────────────────────────────────────────────────────────────

import {
  buildWhatsappUrl,
  buildBookingConfirmationWhatsappMessage,
  buildReviewRequestWhatsappMessage,
  buildWhatsappBookingSummaryText,
} from '@/lib/notifications/whatsapp'

const sampleWhatsappData = {
  customerName: 'Maria',
  customerPhone: '+56987654321',
  serviceName: 'Manicure semipermanente',
  startDateTime: new Date('2026-06-15T18:00:00Z'),
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  totalPrice: 25000,
  depositPaid: 5000,
  remainingBalance: 20000,
  businessAddress: 'Av. Siempre Viva 742, Santiago',
}

describe('whatsapp: buildWhatsappUrl', () => {
  it('normalizes phone by removing +', () => {
    const url = buildWhatsappUrl('+56912345678', 'Hola')
    expect(url).toContain('wa.me/56912345678')
  })

  it('removes non-digit characters', () => {
    const url = buildWhatsappUrl('+56 9 1234-5678', 'Hola')
    expect(url).toContain('wa.me/56912345678')
  })

  it('encodes message', () => {
    const url = buildWhatsappUrl('+56912345678', 'Hola, ¿cómo estás?')
    expect(url).toContain('text=')
    expect(url).toContain('Hola')
    expect(url).not.toContain('¿')
  })

  it('returns valid wa.me URL', () => {
    const url = buildWhatsappUrl('+56912345678', 'Test message')
    expect(url).toBe('https://wa.me/56912345678?text=Test%20message')
  })
})

describe('whatsapp: buildBookingConfirmationWhatsappMessage', () => {
  it('contains service, date, and price', () => {
    const message = buildBookingConfirmationWhatsappMessage(sampleWhatsappData)
    expect(message).toContain('Maria')
    expect(message).toContain('Manicure semipermanente')
    expect(message).toContain('$25.000')
  })

  it('contains address when present', () => {
    const message = buildBookingConfirmationWhatsappMessage(sampleWhatsappData)
    expect(message).toContain('Av. Siempre Viva 742')
  })
})

describe('whatsapp: buildReviewRequestWhatsappMessage', () => {
  it('contains review link and customer name', () => {
    const message = buildReviewRequestWhatsappMessage({
      customerName: 'Maria',
      serviceName: 'Manicure semipermanente',
      reviewLink: 'https://agendita.app/review/booking-1?token=abc',
    })
    expect(message).toContain('Maria')
    expect(message).toContain('https://agendita.app/review/booking-1?token=abc')
  })
})

describe('whatsapp: buildWhatsappBookingSummaryText', () => {
  it('contains phone and service', () => {
    const text = buildWhatsappBookingSummaryText(sampleWhatsappData)
    expect(text).toContain('+56987654321')
    expect(text).toContain('Manicure semipermanente')
  })
})

// ── Email provider ─────────────────────────────────────────────────────────

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
}))

const {
  sendBookingConfirmationToCustomer,
  sendNewBookingNotificationToBusiness,
  sendBookingCancelledNotification,
  sendReviewRequestNotification,
  sendNotificationSafely,
  sendMultiNotificationSafely,
} = await import('@/lib/notifications/email-provider')

describe('email-provider: sendBookingConfirmationToCustomer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('skips when customer has no email', async () => {
    const result = await sendBookingConfirmationToCustomer({
      ...sampleBookingData,
      customerEmail: null,
    })
    expect(result.success).toBe(false)
    expect(result.skipped).toBe('Cliente sin email')
  })

  it('skips when RESEND_API_KEY is not set', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('FROM_EMAIL', '')

    const result = await sendBookingConfirmationToCustomer(sampleBookingData)
    expect(result.success).toBe(false)
    expect(result.skipped).toBe('RESEND_API_KEY no configurada')
  })

  it('skips when FROM_EMAIL is not set', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', '')

    const result = await sendBookingConfirmationToCustomer(sampleBookingData)
    expect(result.success).toBe(false)
    expect(result.skipped).toBe('FROM_EMAIL no configurado')
  })

  it('sends email when env and email are configured', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: { id: 'msg_123' }, error: null })

    const result = await sendBookingConfirmationToCustomer(sampleBookingData)

    expect(MockResend).toHaveBeenCalledWith('re_test_123')
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Agendita <no-reply@agendita.cl>',
        to: ['maria@example.com'],
        replyTo: 'owner@nails.com',
        subject: 'Reserva confirmada - Nails by Ana',
      })
    )
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg_123')
  })

  it('returns error when Resend fails', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: null, error: { message: 'Rate limited' } })

    const result = await sendBookingConfirmationToCustomer(sampleBookingData)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Rate limited')
  })

  it('handles thrown errors gracefully', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockRejectedValue(new Error('Network error'))

    const result = await sendBookingConfirmationToCustomer(sampleBookingData)
    expect(result.success).toBe(false)
    expect(result.error).toBe('Network error')
  })
})

describe('email-provider: sendNewBookingNotificationToBusiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('skips when no owners/admins have email', async () => {
    mockPrismaForEmail.businessUser.findMany.mockResolvedValue([])

    const results = await sendNewBookingNotificationToBusiness('biz-1', sampleBusinessData)
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].skipped).toContain('No hay owners/admins con email')
  })

  it('sends to owner and admin users', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: { id: 'msg_ok' }, error: null })

    mockPrismaForEmail.businessUser.findMany.mockResolvedValue([
      { user: { email: 'owner@nails.com', name: 'Ana' } },
      { user: { email: 'admin@nails.com', name: 'Luisa' } },
    ])

    const results = await sendNewBookingNotificationToBusiness('biz-1', sampleBusinessData)

    expect(mockResendSend).toHaveBeenCalledTimes(2)
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['owner@nails.com'],
        replyTo: 'maria@example.com',
        subject: 'Nueva reserva - Maria',
      })
    )
    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['admin@nails.com'],
        replyTo: 'maria@example.com',
        subject: 'Nueva reserva - Maria',
      })
    )
    expect(results).toHaveLength(2)
    expect(results.every((r) => r.success)).toBe(true)
  })

  it('filters out users without email', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: { id: 'msg_ok' }, error: null })

    mockPrismaForEmail.businessUser.findMany.mockResolvedValue([
      { user: { email: 'owner@nails.com', name: 'Ana' } },
      { user: { email: '', name: 'Sin email' } },
    ])

    const results = await sendNewBookingNotificationToBusiness('biz-1', sampleBusinessData)
    expect(mockResendSend).toHaveBeenCalledTimes(1)
    expect(results).toHaveLength(1)
  })

  it('filters out staff role', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: { id: 'msg_ok' }, error: null })

    await sendNewBookingNotificationToBusiness('biz-1', sampleBusinessData)

    expect(mockPrismaForEmail.businessUser.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          role: { in: ['owner', 'admin'] },
        }),
      })
    )
  })
})

describe('email-provider: sendBookingCancelledNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('skips when customer has no email', async () => {
    const result = await sendBookingCancelledNotification({
      ...sampleCancellationData,
      customerEmail: null,
    })
    expect(result.success).toBe(false)
    expect(result.skipped).toBe('Cliente sin email')
  })

  it('sends cancellation email', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: { id: 'msg_456' }, error: null })

    const result = await sendBookingCancelledNotification(sampleCancellationData)

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['maria@example.com'],
        replyTo: 'owner@nails.com',
        subject: 'Reserva cancelada - Nails by Ana',
      })
    )
    expect(result.success).toBe(true)
  })
})

describe('email-provider: sendReviewRequestNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('skips when customer has no email', async () => {
    const result = await sendReviewRequestNotification({
      ...sampleReviewData,
      customerEmail: null,
    })
    expect(result.success).toBe(false)
    expect(result.skipped).toBe('Cliente sin email')
  })

  it('sends review request email', async () => {
    vi.stubEnv('RESEND_API_KEY', 're_test_123')
    vi.stubEnv('FROM_EMAIL', 'Agendita <no-reply@agendita.cl>')
    mockResendSend.mockResolvedValue({ data: { id: 'msg_789' }, error: null })

    const result = await sendReviewRequestNotification(sampleReviewData)

    expect(mockResendSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: ['maria@example.com'],
        replyTo: 'owner@nails.com',
        subject: '¿Cómo te fue? - Nails by Ana',
      })
    )
    expect(result.success).toBe(true)
  })
})

// ── Safe wrappers ──────────────────────────────────────────────────────────

describe('email-provider: sendNotificationSafely', () => {
  it('returns result when fn succeeds', async () => {
    const result = await sendNotificationSafely('test', async () => ({
      success: true,
      messageId: 'msg-1',
    }))
    expect(result.success).toBe(true)
    expect(result.messageId).toBe('msg-1')
  })

  it('returns error result when fn throws', async () => {
    const result = await sendNotificationSafely('test-fail', async () => {
      throw new Error('Boom')
    })
    expect(result.success).toBe(false)
    expect(result.error).toBe('Boom')
  })

  it('never throws', async () => {
    await expect(
      sendNotificationSafely('never-throws', async () => {
        throw new Error('Should not propagate')
      }),
    ).resolves.toBeDefined()
  })
})

describe('email-provider: sendMultiNotificationSafely', () => {
  it('returns results array when fn succeeds', async () => {
    const results = await sendMultiNotificationSafely('multi', async () => [
      { success: true, messageId: 'a' },
      { success: true, messageId: 'b' },
    ])
    expect(results).toHaveLength(2)
    expect(results[0].messageId).toBe('a')
  })

  it('returns error array when fn throws', async () => {
    const results = await sendMultiNotificationSafely('multi-fail', async () => {
      throw new Error('Boom multi')
    })
    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(false)
    expect(results[0].error).toBe('Boom multi')
  })

  it('never throws', async () => {
    await expect(
      sendMultiNotificationSafely('never-multi', async () => {
        throw new Error('Should not propagate')
      }),
    ).resolves.toBeDefined()
  })
})
