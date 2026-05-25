import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

const mockMpFetch = vi.fn()
vi.stubGlobal('fetch', mockMpFetch)

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
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/server/services/finance', () => ({
  applyApprovedPayment: vi.fn(),
}))

vi.mock('@/lib/booking-payments', () => ({
  assertBookingPayable: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  sendBookingConfirmedNotification: vi.fn(),
  sendNotificationSafely: vi.fn(),
}))

vi.mock('@/lib/payments/encryption', () => ({
  encryptSecret: vi.fn().mockReturnValue('encrypted-token'),
  decryptSecret: vi.fn().mockReturnValue('test-access-token'),
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

    mockPrisma.paymentAccount.findFirst.mockReset().mockResolvedValue({
      id: 'pa-1',
      businessId: 'biz-1',
      provider: 'mercado_pago',
      status: 'connected',
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
  ): Request {
    const url = new URL('https://example.com/api/webhooks/mercado-pago')
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
        'https://example.com/api/webhooks/mercado-pago?data.id=mp-pay-qp',
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
        'https://example.com/api/webhooks/mercado-pago?data.id=mp-pay-bad',
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
      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-local-001' },
          data: expect.objectContaining({
            providerPaymentId: 'mp-pay-001',
          }),
        }),
      )
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

      const req = makeRequest(approvedPaymentBody)
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
        status: 'connected',
        accessTokenEncrypted: 'invalid-ciphertext',
      })

      const { decryptSecret } = await import('@/lib/payments/encryption')
      vi.mocked(decryptSecret).mockImplementationOnce(() => {
        throw new Error('Decrypt failed')
      })

      const req = makeRequest(approvedPaymentBody)
      const res = await POST(req)

      expect(res.status).toBe(500)
      expect(applyApprovedPayment).not.toHaveBeenCalled()
    })
  })
})
