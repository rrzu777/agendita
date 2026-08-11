import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

const mockMpFetch = vi.fn()
const mockGetValidBusinessAccessTokenForAccount = vi.fn()
vi.stubGlobal('fetch', mockMpFetch)
vi.mock('@/lib/payments/mercado-pago-oauth', () => ({
  getValidBusinessAccessTokenForAccount: (...args: unknown[]) => mockGetValidBusinessAccessTokenForAccount(...args),
}))

const mockPrisma = {
  payment: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
  },
  booking: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  ledgerEntry: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  $transaction: vi.fn(),
  paymentAccount: {
    findFirst: vi.fn(),
  },
  loyaltyConfig: {
    findUnique: vi.fn().mockResolvedValue(null),
  },
  loyaltyLedger: {
    findMany: vi.fn().mockResolvedValue([]),
  },
  promotionGrant: {
    findMany: vi.fn().mockResolvedValue([]),
  },
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/server/services/finance', () => ({
  applyApprovedPayment: vi.fn(),
}))

vi.mock('@/lib/bookings/payments', () => ({
  assertBookingPayable: vi.fn(),
}))

vi.mock('@/lib/bookings/notify-payment-not-confirmed', () => ({
  firePaymentNotConfirmedNotification: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  sendBookingConfirmedNotification: vi.fn(),
  sendNotificationSafely: vi.fn(),
  sendMultiNotificationSafely: vi.fn((_label: string, fn: () => unknown) => fn()),
  sendBookingUnexpectedPaymentToBusiness: vi.fn(),
}))

vi.mock('@/lib/payments/encryption', () => ({
  encryptSecret: vi.fn().mockReturnValue('encrypted-token'),
  decryptSecret: vi.fn().mockReturnValue('test-access-token'),
}))

vi.mock('@/lib/promotions/release', () => ({
  releaseRedemptionForBooking: vi.fn(),
}))

vi.mock('@/lib/loyalty/credit', () => ({
  reverseVisitPoints: vi.fn(),
}))

vi.mock('@/lib/loyalty/automatic', () => ({
  reverseAutoRewardsForBooking: vi.fn(),
}))

const originalEnv = { ...process.env }

function setEnv(vars: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(vars)) {
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = value
    }
  }
}

function createMpSignatureHeader(
  mpPaymentId: string,
  requestId: string | null,
  secret: string,
): string {
  const ts = String(Math.floor(Date.now() / 1000))
  const manifest = `id:${mpPaymentId};request-id:${requestId ?? ''};ts:${ts};`
  const v1 = createHmac('sha256', secret).update(manifest).digest('hex')
  return `ts=${ts},v1=${v1}`
}

function createRequestInit(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...overrides,
  }
}

const { applyApprovedPayment } = await import('@/server/services/finance')
const { firePaymentNotConfirmedNotification } = await import('@/lib/bookings/notify-payment-not-confirmed')
const { reverseVisitPoints } = await import('@/lib/loyalty/credit')
const { sendBookingUnexpectedPaymentToBusiness, sendBookingConfirmedNotification } = await import('@/lib/notifications')

describe('Mercado Pago webhook', () => {
  let POST: (req: Request) => Promise<Response>

  async function getHandlers() {
    const mod = await import('@/app/api/webhooks/mercado-pago/route')
    return mod
  }

  const baseMpPayment = {
    id: 'mp-pay-001',
    status: 'approved',
    status_detail: 'accredited',
    transaction_amount: 10000,
    currency_id: 'CLP',
    date_approved: '2024-01-15T10:30:00Z',
    date_created: '2024-01-15T10:25:00Z',
    external_reference: 'pay-local-001',
    collector_id: 12345,
    metadata: {
      bookingId: 'booking-1',
      businessId: 'biz-1',
      paymentType: 'deposit',
      localPaymentId: 'pay-local-001',
    },
  }

  const basePayment = {
    id: 'pay-local-001',
    bookingId: 'booking-1',
    businessId: 'biz-1',
    customerId: 'cust-1',
    provider: 'mercado_pago',
    providerEnvironment: 'sandbox',
    providerPaymentId: null,
    amount: 10000,
    currency: 'CLP',
    status: 'pending',
    paymentType: 'deposit',
    paymentMethod: null,
    booking: {
      id: 'booking-1',
      businessId: 'biz-1',
      status: 'pending_payment',
    },
  }

  beforeEach(async () => {
    setEnv({
      MERCADO_PAGO_ACCESS_TOKEN: 'test-access-token',
      MERCADO_PAGO_WEBHOOK_SECRET: 'test-webhook-secret',
      NODE_ENV: 'development',
    })
    vi.clearAllMocks()
    mockMpFetch.mockReset()
    mockGetValidBusinessAccessTokenForAccount.mockReset().mockResolvedValue('test-access-token')

    mockPrisma.paymentAccount.findFirst.mockReset().mockResolvedValue({
      id: 'pa-1',
      businessId: 'biz-1',
      provider: 'mercado_pago',
      environment: 'sandbox',
      status: 'connected',
      providerAccountId: '12345',
      accessTokenEncrypted: 'encrypted-test-token',
    })

    vi.resetModules()

    const handlers = await getHandlers()
    POST = handlers.POST as unknown as (req: Request) => Promise<Response>
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  function makeRequest(
    body: unknown,
    headers: Record<string, string> = {},
    localPaymentId?: string,
  ): Request {
    const url = new URL('https://example.com/api/webhooks/mercado-pago')
    const providerId = String((body as { data?: { id?: string } })?.data?.id ?? '')
    url.searchParams.set(
      'local_payment_id',
      localPaymentId ?? providerId.replace(/^mp-pay-/, 'pay-local-'),
    )
    return new Request(url, {
      method: 'POST',
      headers: createRequestInit(headers),
      body: JSON.stringify(body),
    })
  }

  describe('signature validation', () => {
    beforeEach(() => {
      mockPrisma.payment.findUnique.mockResolvedValue(basePayment)
    })

    it('accepts valid signature', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-001' } }
      const signature = createMpSignatureHeader('mp-pay-001', 'req-123', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(baseMpPayment),
      })

      mockPrisma.payment.findUnique.mockResolvedValue(basePayment)

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-123',
      })
      const res = await POST(req)
      expect(res.status).not.toBe(401)
    })

    it('rejects invalid signature', async () => {
      const body = { data: { id: 'mp-pay-001' } }

      const req = makeRequest(body, {
        'x-signature': 'ts=123,v1=bad-signature',
        'x-request-id': 'req-123',
      })
      const res = await POST(req)
      expect(res.status).toBe(401)
    })

    it('rejects missing signature in production', async () => {
      setEnv({ NODE_ENV: 'production', MERCADO_PAGO_WEBHOOK_SECRET: 'test-secret' })
      vi.resetModules()
      const handlers = await getHandlers()
      POST = handlers.POST as unknown as (req: Request) => Promise<Response>

      const body = { data: { id: 'mp-pay-001' } }
      const req = makeRequest(body)
      const res = await POST(req)
      expect(res.status).toBe(401)
    })

    it('requires MERCADO_PAGO_WEBHOOK_SECRET in production', async () => {
      setEnv({
        NODE_ENV: 'production',
        MERCADO_PAGO_WEBHOOK_SECRET: undefined,
        MERCADO_PAGO_ACCESS_TOKEN: 'test-token',
      })
      vi.resetModules()
      const handlers = await getHandlers()
      POST = handlers.POST as unknown as (req: Request) => Promise<Response>

      const body = { data: { id: 'mp-pay-001' } }
      const req = makeRequest(body)
      const res = await POST(req)
      expect(res.status).toBe(500)
    })

    it('validates signature with data.id from query params', async () => {
      const secret = 'test-webhook-secret'
      const signature = createMpSignatureHeader('mp-pay-qp', 'req-qp', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-qp',
            external_reference: 'pay-local-qp',
            metadata: {
              ...baseMpPayment.metadata,
              localPaymentId: 'pay-local-qp',
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        id: 'pay-local-qp',
      })

      ;(applyApprovedPayment as ReturnType<typeof vi.fn>).mockResolvedValue({
        booking: { id: 'booking-1', businessId: 'biz-1' },
        wasConfirmed: false,
      })
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ ...mockPrisma }))

      const url = new URL(
        'https://example.com/api/webhooks/mercado-pago?data.id=mp-pay-qp&local_payment_id=pay-local-qp',
      )
      const req = new Request(url, {
        method: 'POST',
        headers: createRequestInit({
          'x-signature': signature,
          'x-request-id': 'req-qp',
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    })

    it('rejects invalid signature with data.id from query params', async () => {
      const url = new URL(
        'https://example.com/api/webhooks/mercado-pago?data.id=mp-pay-bad&local_payment_id=pay-local-bad',
      )
      const req = new Request(url, {
        method: 'POST',
        headers: createRequestInit({
          'x-signature': 'ts=123,v1=bad-signature',
          'x-request-id': 'req-bad',
        }),
      })

      const res = await POST(req)
      expect(res.status).toBe(401)
    })

    it('validates signature using x-request-id header', async () => {
      const secret = 'test-webhook-secret'
      // Create signature with specific request-id
      const ts = String(Math.floor(Date.now() / 1000))
      const dataId = 'mp-pay-xrid'
      const requestId = 'req-specific-123'
      const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`
      const v1 = createHmac('sha256', secret).update(manifest).digest('hex')
      const signature = `ts=${ts},v1=${v1}`

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: dataId,
            external_reference: 'pay-local-xrid',
            metadata: {
              ...baseMpPayment.metadata,
              localPaymentId: 'pay-local-xrid',
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        id: 'pay-local-xrid',
      })

      ;(applyApprovedPayment as ReturnType<typeof vi.fn>).mockResolvedValue({
        booking: { id: 'booking-1', businessId: 'biz-1' },
        wasConfirmed: false,
      })
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ ...mockPrisma }))

      const body = { data: { id: dataId } }
      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': requestId,
      })

      const res = await POST(req)
      expect(res.status).toBe(200)
    })
  })

  describe('approved payment', () => {
    it('applies payment and confirms booking', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-001' } }
      const signature = createMpSignatureHeader('mp-pay-001', 'req-123', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(baseMpPayment),
      })

      mockPrisma.payment.findUnique.mockResolvedValue(basePayment)

      const applyResult = {
        booking: { id: 'booking-1', businessId: 'biz-1' },
        wasConfirmed: true,
      }
      ;(applyApprovedPayment as ReturnType<typeof vi.fn>).mockResolvedValue(applyResult)

      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        return fn({ ...mockPrisma })
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-123',
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.bookingId).toBe('booking-1')

      expect(applyApprovedPayment).toHaveBeenCalledTimes(1)
      expect(mockPrisma.paymentAccount.findFirst).toHaveBeenCalledWith({
        where: {
          businessId: 'biz-1',
          provider: 'mercado_pago',
          environment: 'sandbox',
          status: 'connected',
        },
      })
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-local-001' },
          data: expect.objectContaining({
            providerPaymentId: 'mp-pay-001',
          }),
        }),
      )
    })

    it('fails closed when an approved payment has no persisted environment', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-no-env' } }
      const signature = createMpSignatureHeader('mp-pay-no-env', 'req-no-env', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ ...baseMpPayment, id: 'mp-pay-no-env' }),
      })
      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        providerEnvironment: null,
      })

      const res = await POST(makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-no-env',
      }))

      expect(res.status).toBe(400)
      expect(mockPrisma.paymentAccount.findFirst).not.toHaveBeenCalled()
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })

    // El cobro ya ocurrió: si el webhook devuelve error, MP reintenta el mismo
    // evento para siempre y la plata nunca queda asentada. Por eso pide asentar
    // pase lo que pase con el estado de la reserva, y cuando vuelve un motivo lo
    // resuelve con un aviso a la dueña, no con un error.
    it('asienta el cobro aunque la reserva ya no esté vigente y avisa a la dueña', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-001' } }
      const signature = createMpSignatureHeader('mp-pay-001', 'req-123', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(baseMpPayment),
      })

      // La reserva la barrió el cron de holds mientras MP terminaba de aprobar.
      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        booking: { ...basePayment.booking, status: 'expired' },
      })

      // Imita al servicio de verdad: lanza salvo que el caller pida asentar de
      // todas formas. Sin eso este test pasaría igual aunque el webhook dejara de
      // mandar la bandera — con la bandera puesta da 200, sin ella da el 500 que
      // hacía reintentar a MP para siempre.
      ;(applyApprovedPayment as ReturnType<typeof vi.fn>).mockImplementation(
        async (input: { recordEvenIfNotPayable?: boolean }) => {
          if (!input.recordEvenIfNotPayable) throw new Error('No se puede procesar pago para esta reserva')
          return {
            booking: { id: 'booking-1', businessId: 'biz-1' },
            wasConfirmed: false,
            wasUnexpected: false,
            unconfirmedReason: { kind: 'booking_status', status: 'expired' },
          }
        },
      )

      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => {
        return fn({ ...mockPrisma })
      })

      const res = await POST(makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-123',
      }))

      expect(res.status).toBe(200)
      expect((await res.json()).success).toBe(true)

      // Sin este aviso la dueña no se enteraría nunca: pasa en un webhook.
      expect(firePaymentNotConfirmedNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          bookingId: 'booking-1',
          businessId: 'biz-1',
          reason: { kind: 'booking_status', status: 'expired' },
          amount: 10000,
        }),
      )
      // Y la clienta NO recibe una confirmación de una hora que no tiene.
      expect(sendBookingConfirmedNotification).not.toHaveBeenCalled()
    })

    it('returns 200 idempotent without side effects if already approved', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-001' } }
      const signature = createMpSignatureHeader('mp-pay-001', 'req-123', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(baseMpPayment),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        status: 'approved',
        providerPaymentId: 'mp-pay-001',
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-123',
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })

    it('avisa a la dueña cuando la plata entró sobre una reserva ya saldada', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-001' } }
      const signature = createMpSignatureHeader('mp-pay-001', 'req-123', secret)

      mockMpFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(baseMpPayment) })
      mockPrisma.payment.findUnique.mockResolvedValue(basePayment)
      ;(applyApprovedPayment as ReturnType<typeof vi.fn>).mockResolvedValue({
        booking: { id: 'booking-1', businessId: 'biz-1' },
        wasConfirmed: false,
        wasUnexpected: true,
      })
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ ...mockPrisma }))
      mockPrisma.booking.findUnique.mockResolvedValue({
        bookingNumber: 4242,
        customer: { name: 'Ana' },
        service: { name: 'Corte' },
        business: { name: 'Peluquería', currency: 'CLP' },
      })

      const res = await POST(makeRequest(body, { 'x-signature': signature, 'x-request-id': 'req-123' }))

      expect(res.status).toBe(200)
      expect(sendBookingUnexpectedPaymentToBusiness).toHaveBeenCalledWith(
        'biz-1',
        expect.objectContaining({
          customerName: 'Ana',
          serviceName: 'Corte',
          bookingLabel: '#4242',
          amount: basePayment.amount,
          businessCurrency: 'CLP',
        }),
      )
      // La clienta no se entera: para ella la reserva no cambió.
      expect(sendBookingConfirmedNotification).not.toHaveBeenCalled()
    })
  })

  describe('pending payment', () => {
    it('does not confirm booking for pending status', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-002' } }
      const signature = createMpSignatureHeader('mp-pay-002', 'req-456', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-002',
            status: 'pending',
            date_approved: null,
            external_reference: 'pay-local-002',
            metadata: { ...baseMpPayment.metadata, localPaymentId: 'pay-local-002' },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        id: 'pay-local-002',
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-456',
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })
  })

  describe('rejected payment', () => {
    it('updates payment to rejected without confirming booking', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-003' } }
      const signature = createMpSignatureHeader('mp-pay-003', 'req-789', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-003',
            status: 'rejected',
            date_approved: null,
            external_reference: 'pay-local-003',
            metadata: { ...baseMpPayment.metadata, localPaymentId: 'pay-local-003' },
          }),
      })

      mockPrisma.payment.findUnique
        .mockResolvedValueOnce({
          ...basePayment,
          id: 'pay-local-003',
        })
        .mockResolvedValueOnce({
          ...basePayment,
          id: 'pay-local-003',
          status: 'pending',
        })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-789',
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-local-003' },
          data: expect.objectContaining({ status: 'rejected' }),
        }),
      )
    })

    it('does not downgrade already approved payment', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-004' } }
      const signature = createMpSignatureHeader('mp-pay-004', 'req-000', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-004',
            status: 'rejected',
            date_approved: null,
            external_reference: 'pay-local-004',
            metadata: { ...baseMpPayment.metadata, localPaymentId: 'pay-local-004' },
          }),
      })

      mockPrisma.payment.findUnique
        .mockResolvedValueOnce({
          ...basePayment,
          id: 'pay-local-004',
          status: 'approved',
          providerPaymentId: 'mp-pay-004',
        })
        .mockResolvedValueOnce({
          ...basePayment,
          id: 'pay-local-004',
          status: 'approved',
          providerPaymentId: 'mp-pay-004',
        })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-000',
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      // Should NOT update status since already approved
      const updateCalls = (mockPrisma.payment.update as ReturnType<typeof vi.fn>).mock
        .calls
      const statusUpdates = updateCalls.filter(
        (call: unknown[]) => {
          const arg = call[0] as { data?: { status?: string } } | undefined
          return arg?.data?.status === 'rejected'
        },
      )
      expect(statusUpdates).toHaveLength(0)
    })
  })

  describe('refunded payment', () => {
    it('reverses loyalty visit points for the booking on refund', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-refund' } }
      const signature = createMpSignatureHeader('mp-pay-refund', 'req-refund', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-refund',
            status: 'refunded',
            date_approved: null,
            external_reference: 'pay-local-refund',
            metadata: {
              ...baseMpPayment.metadata,
              localPaymentId: 'pay-local-refund',
            },
          }),
      })

      mockPrisma.payment.findUnique
        .mockReset()
        .mockResolvedValueOnce({
          ...basePayment,
          id: 'pay-local-refund',
        })
        .mockResolvedValueOnce({
          ...basePayment,
          id: 'pay-local-refund',
          status: 'pending',
        })

      mockPrisma.$transaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) => fn({ ...mockPrisma }),
      )

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-refund',
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-local-refund' },
          data: expect.objectContaining({ status: 'refunded' }),
        }),
      )
      expect(reverseVisitPoints).toHaveBeenCalledWith(
        expect.anything(),
        'booking-1',
      )
    })
  })

  describe('validation failures', () => {
    it('rejects amount mismatch', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-005' } }
      const signature = createMpSignatureHeader('mp-pay-005', 'req-111', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-005',
            transaction_amount: 99999,
            external_reference: 'pay-local-005',
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        id: 'pay-local-005',
        amount: 10000,
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-111',
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })

    it('rejects metadata bookingId mismatch', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-006' } }
      const signature = createMpSignatureHeader('mp-pay-006', 'req-222', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-006',
            external_reference: 'pay-local-006',
            metadata: {
              localPaymentId: 'pay-local-006',
              bookingId: 'wrong-booking',
              businessId: 'biz-1',
              paymentType: 'deposit',
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        id: 'pay-local-006',
        bookingId: 'booking-1',
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-222',
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
    })

    it('rejects approved payment with missing metadata', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-nometa' } }
      const signature = createMpSignatureHeader('mp-pay-nometa', 'req-nometa', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-nometa',
            status: 'approved',
            external_reference: 'pay-local-nometa',
            metadata: null,
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        id: 'pay-local-nometa',
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-nometa',
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })

    it('rejects approved payment with partial metadata', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-partial' } }
      const signature = createMpSignatureHeader('mp-pay-partial', 'req-partial', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-partial',
            status: 'approved',
            external_reference: 'pay-local-partial',
            metadata: {
              localPaymentId: 'pay-local-partial',
              bookingId: 'booking-1',
              // businessId and paymentType intentionally missing
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        id: 'pay-local-partial',
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-partial',
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })

    it('rejects approved payment with localPaymentId mismatch in metadata', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-lpmm' } }
      const signature = createMpSignatureHeader('mp-pay-lpmm', 'req-lpmm', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-lpmm',
            status: 'approved',
            external_reference: 'pay-local-lpmm',
            metadata: {
              localPaymentId: 'different-payment-id',
              bookingId: 'booking-1',
              businessId: 'biz-1',
              paymentType: 'deposit',
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePayment,
        id: 'pay-local-lpmm',
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-lpmm',
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })

    it('rejects when body data.id and query data.id differ', async () => {
      const secret = 'test-webhook-secret'
      // Signature for the query ID (canonical source)
      const signature = createMpSignatureHeader('mp-pay-query', 'req-mismatch', secret)

      const url = new URL(
        'https://example.com/api/webhooks/mercado-pago?data.id=mp-pay-query',
      )
      // Body has a different ID — should be rejected
      const body = JSON.stringify({ data: { id: 'mp-pay-body' } })
      const req = new Request(url, {
        method: 'POST',
        headers: createRequestInit({
          'x-signature': signature,
          'x-request-id': 'req-mismatch',
        }),
        body,
      })

      const res = await POST(req)
      expect(res.status).toBe(400)
    })

    it('returns 404 for non-existent external_reference', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-007' } }
      const signature = createMpSignatureHeader('mp-pay-007', 'req-333', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...baseMpPayment,
            id: 'mp-pay-007',
            external_reference: 'non-existent-payment',
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue(null)

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-333',
      })
      const res = await POST(req)

      expect(res.status).toBe(404)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })
  })

  describe('approved payments fail-closed without business token', () => {
    beforeEach(() => {
      setEnv({
        NODE_ENV: 'development',
        MERCADO_PAGO_ACCESS_TOKEN: 'test-access-token',
        MERCADO_PAGO_WEBHOOK_SECRET: undefined,
      })
      mockPrisma.paymentAccount.findFirst.mockReset()
      mockPrisma.payment.findUnique.mockReset()
      vi.clearAllMocks()
    })

    const approvedPaymentBody = {
      ...baseMpPayment,
      status: 'approved',
      external_reference: 'pay-local-fc',
      transaction_amount: 10000,
      currency_id: 'CLP',
      metadata: {
        localPaymentId: 'pay-local-fc',
        bookingId: 'booking-fc',
        businessId: 'biz-1',
        paymentType: 'deposit',
      },
    }

    function setupApprovedWebhook() {
      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(approvedPaymentBody),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 'pay-local-fc',
        bookingId: 'booking-fc',
        businessId: 'biz-1',
        provider: 'mercado_pago',
        providerEnvironment: 'sandbox',
        amount: 10000,
        currency: 'CLP',
        status: 'pending',
        providerPaymentId: null,
        paymentType: 'deposit',
        paymentMethod: null,
        booking: {
          id: 'booking-fc',
          businessId: 'biz-1',
          customerId: 'cust-1',
          status: 'pending_payment',
          totalPrice: 20000,
          depositRequired: 10000,
          depositPaid: 0,
          remainingBalance: 20000,
          finalAmount: 20000,
          paymentStatus: 'unpaid',
        },
      })
    }

    it('rejects approved payment when business has no connected PaymentAccount', async () => {
      setupApprovedWebhook()
      mockPrisma.paymentAccount.findFirst.mockResolvedValue(null)

      const req = makeRequest(approvedPaymentBody, {}, 'pay-local-fc')
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })

    it('rejects approved payment when decrypt of business token fails', async () => {
      setupApprovedWebhook()
      mockPrisma.paymentAccount.findFirst.mockResolvedValue({
        id: 'pa-1',
        businessId: 'biz-1',
        provider: 'mercado_pago',
        environment: 'sandbox',
        status: 'connected',
        providerAccountId: '12345',
        accessTokenEncrypted: 'invalid-ciphertext',
      })

      mockGetValidBusinessAccessTokenForAccount.mockRejectedValueOnce(new Error('Decrypt failed'))

      const req = makeRequest(approvedPaymentBody, {}, 'pay-local-fc')
      const res = await POST(req)

      expect(res.status).toBe(500)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })

    it('rejects approved payment when re-fetch with business token fails', async () => {
      setupApprovedWebhook()
      mockPrisma.paymentAccount.findFirst.mockResolvedValue({
        id: 'pa-1',
        businessId: 'biz-1',
        provider: 'mercado_pago',
        environment: 'sandbox',
        status: 'connected',
        providerAccountId: '12345',
        accessTokenEncrypted: 'encrypted-test-token',
      })

      mockMpFetch.mockRejectedValueOnce(new Error('Network error on seller verification'))

      const req = makeRequest(approvedPaymentBody, {}, 'pay-local-fc')
      const res = await POST(req)

      expect(res.status).toBe(502)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })
  })

  describe('currency mismatch', () => {
    it('rejects currency mismatch with 400 and does not call applyApprovedPayment', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-currency' } }
      const signature = createMpSignatureHeader('mp-pay-currency', 'req-curr', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'mp-pay-currency',
            status: 'approved',
            status_detail: 'accredited',
            transaction_amount: 10000,
            currency_id: 'USD',
            date_approved: '2024-01-15T10:30:00Z',
            date_created: '2024-01-15T10:25:00Z',
            collector_id: 12345,
            external_reference: 'pay-currency',
            metadata: {
              bookingId: 'booking-1',
              businessId: 'biz-1',
              paymentType: 'deposit',
              localPaymentId: 'pay-currency',
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 'pay-currency',
        bookingId: 'booking-1',
        businessId: 'biz-1',
        customerId: 'cust-1',
        provider: 'mercado_pago',
        providerEnvironment: 'sandbox',
        providerPaymentId: null,
        amount: 10000,
        currency: 'CLP',
        status: 'pending',
        paymentType: 'deposit',
        paymentMethod: null,
        booking: {
          id: 'booking-1',
          businessId: 'biz-1',
          status: 'pending_payment',
        },
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-curr',
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('Currency mismatch')
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })
  })

  describe('metadata businessId mismatch', () => {
    it('rejects metadata.businessId mismatch with 400 and does not call applyApprovedPayment', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-bizid' } }
      const signature = createMpSignatureHeader('mp-pay-bizid', 'req-bizid', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'mp-pay-bizid',
            status: 'approved',
            status_detail: 'accredited',
            transaction_amount: 10000,
            currency_id: 'CLP',
            date_approved: '2024-01-15T10:30:00Z',
            date_created: '2024-01-15T10:25:00Z',
            collector_id: 12345,
            external_reference: 'pay-bizid',
            metadata: {
              bookingId: 'booking-1',
              businessId: 'biz-999',
              paymentType: 'deposit',
              localPaymentId: 'pay-bizid',
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 'pay-bizid',
        bookingId: 'booking-1',
        businessId: 'biz-1',
        customerId: 'cust-1',
        provider: 'mercado_pago',
        providerEnvironment: 'sandbox',
        providerPaymentId: null,
        amount: 10000,
        currency: 'CLP',
        status: 'pending',
        paymentType: 'deposit',
        paymentMethod: null,
        booking: {
          id: 'booking-1',
          businessId: 'biz-1',
          status: 'pending_payment',
        },
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-bizid',
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('businessId mismatch')
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })
  })

  describe('providerPaymentId conflict', () => {
    it('rejects conflicting providerPaymentId with 409', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-conflict' } }
      const signature = createMpSignatureHeader('mp-pay-conflict', 'req-conflict', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'mp-pay-conflict',
            status: 'approved',
            status_detail: 'accredited',
            transaction_amount: 10000,
            currency_id: 'CLP',
            date_approved: '2024-01-15T10:30:00Z',
            date_created: '2024-01-15T10:25:00Z',
            collector_id: 12345,
            external_reference: 'pay-conflict',
            metadata: {
              bookingId: 'booking-1',
              businessId: 'biz-1',
              paymentType: 'deposit',
              localPaymentId: 'pay-conflict',
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 'pay-conflict',
        bookingId: 'booking-1',
        businessId: 'biz-1',
        customerId: 'cust-1',
        provider: 'mercado_pago',
        providerEnvironment: 'sandbox',
        providerPaymentId: 'some-other-mp-id',
        amount: 10000,
        currency: 'CLP',
        status: 'pending',
        paymentType: 'deposit',
        paymentMethod: null,
        booking: {
          id: 'booking-1',
          businessId: 'biz-1',
          status: 'pending_payment',
        },
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-conflict',
      })
      const res = await POST(req)

      expect(res.status).toBe(409)
      expect((await res.json()).error).toContain('ProviderPaymentId conflict')
    })
  })

  describe('cross-tenant isolation', () => {
    it('does not modify Payment or Booking when metadata businessId belongs to different business', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-cross' } }
      const signature = createMpSignatureHeader('mp-pay-cross', 'req-cross', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'mp-pay-cross',
            status: 'approved',
            status_detail: 'accredited',
            transaction_amount: 10000,
            currency_id: 'CLP',
            date_approved: '2024-01-15T10:30:00Z',
            date_created: '2024-01-15T10:25:00Z',
            collector_id: 12345,
            external_reference: 'pay-cross',
            metadata: {
              bookingId: 'booking-1',
              businessId: 'biz-999',
              paymentType: 'deposit',
              localPaymentId: 'pay-cross',
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 'pay-cross',
        bookingId: 'booking-1',
        businessId: 'biz-1',
        customerId: 'cust-1',
        provider: 'mercado_pago',
        providerEnvironment: 'sandbox',
        providerPaymentId: null,
        amount: 10000,
        currency: 'CLP',
        status: 'pending',
        paymentType: 'deposit',
        paymentMethod: null,
        booking: {
          id: 'booking-1',
          businessId: 'biz-1',
          status: 'pending_payment',
        },
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-cross',
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect((await res.json()).error).toContain('businessId mismatch')
      expect(mockPrisma.payment.update).not.toHaveBeenCalled()
      expect(mockPrisma.booking.update).not.toHaveBeenCalled()
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })
  })

  describe('single seller fetch before apply', () => {
    it('uses only the business token before applying', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pay-twofet' } }
      const signature = createMpSignatureHeader('mp-pay-twofet', 'req-twofet', secret)

      const fetchCalls: string[] = []
      mockMpFetch.mockImplementation(
        () =>
          new Promise((resolve) => {
            setImmediate(() => {
              fetchCalls.push('called')
              resolve({
                ok: true,
                json: () =>
                  Promise.resolve({
                    id: 'mp-pay-twofet',
                    status: 'approved',
                    status_detail: 'accredited',
                    transaction_amount: 10000,
                    currency_id: 'CLP',
                    date_approved: '2024-01-15T10:30:00Z',
                    date_created: '2024-01-15T10:25:00Z',
                    collector_id: 12345,
                    external_reference: 'pay-twofet',
                    metadata: {
                      bookingId: 'booking-1',
                      businessId: 'biz-1',
                      paymentType: 'deposit',
                      localPaymentId: 'pay-twofet',
                    },
                  }),
              })
            })
          }),
      )

      mockPrisma.payment.findUnique.mockResolvedValue({
        id: 'pay-twofet',
        bookingId: 'booking-1',
        businessId: 'biz-1',
        customerId: 'cust-1',
        provider: 'mercado_pago',
        providerEnvironment: 'sandbox',
        providerPaymentId: null,
        amount: 10000,
        currency: 'CLP',
        status: 'pending',
        paymentType: 'deposit',
        paymentMethod: null,
        booking: {
          id: 'booking-1',
          businessId: 'biz-1',
          status: 'pending_payment',
        },
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-twofet',
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      expect(fetchCalls.length).toBe(1)
      expect(mockMpFetch.mock.calls[0][1].headers.Authorization).toBe('Bearer test-access-token')
      expect(applyApprovedPayment).toHaveBeenCalled()
    })
  })
})
