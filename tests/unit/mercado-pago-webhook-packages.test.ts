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
  packagePurchase: {
    findUnique: vi.fn(),
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
  applyApprovedPackagePayment: vi.fn(),
}))

vi.mock('@/lib/booking-payments', () => ({
  assertBookingPayable: vi.fn(),
}))

vi.mock('@/lib/notifications', () => ({
  sendBookingConfirmedNotification: vi.fn(),
  sendNotificationSafely: (_label: string, fn: () => unknown) => fn(),
  sendMultiNotificationSafely: (_label: string, fn: () => unknown) => fn(),
  sendPackagePurchasedNotification: vi.fn().mockResolvedValue({ success: true }),
  sendPackageSoldNotificationToBusiness: vi.fn().mockResolvedValue([{ success: true }]),
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

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

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

const { applyApprovedPayment, applyApprovedPackagePayment } = await import('@/server/services/finance')
const { revalidatePath } = await import('next/cache')

describe('Mercado Pago webhook — dispatch de paquete', () => {
  let POST: (req: Request) => Promise<Response>

  async function getHandlers() {
    const mod = await import('@/app/api/webhooks/mercado-pago/route')
    return mod
  }

  const basePackageMpPayment = {
    id: 'mp-pkg-001',
    status: 'approved',
    status_detail: 'accredited',
    transaction_amount: 50000,
    currency_id: 'CLP',
    date_approved: '2024-01-15T10:30:00Z',
    date_created: '2024-01-15T10:25:00Z',
    external_reference: 'pay-pkg-001',
    metadata: {
      packagePurchaseId: 'pp-1',
      businessId: 'biz-1',
      paymentType: 'package_purchase',
      localPaymentId: 'pay-pkg-001',
    },
  }

  const basePackagePayment = {
    id: 'pay-pkg-001',
    bookingId: null,
    packagePurchaseId: 'pp-1',
    businessId: 'biz-1',
    customerId: 'cust-1',
    provider: 'mercado_pago',
    providerPaymentId: null,
    amount: 50000,
    currency: 'CLP',
    status: 'pending',
    paymentType: 'package_purchase',
    paymentMethod: null,
    booking: null,
    packagePurchase: { customerId: 'cust-1' },
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

    mockPrisma.packagePurchase.findUnique.mockReset().mockResolvedValue({
      id: 'pp-1',
      businessId: 'biz-1',
      customerId: 'cust-1',
      quantity: 5,
      bonusQuantity: 1,
      pricePaid: 50000,
      product: { name: 'Pack 5 sesiones' },
      customer: { name: 'Ana' },
      business: { name: 'Studio Ana', currency: 'CLP' },
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

  describe('approved package payment', () => {
    it('dispatches to applyApprovedPackagePayment, sends notifications and revalidates dashboard', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pkg-001' } }
      const signature = createMpSignatureHeader('mp-pkg-001', 'req-pkg', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(basePackageMpPayment),
      })

      mockPrisma.payment.findUnique.mockResolvedValue(basePackagePayment)
      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({ ...mockPrisma }))

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-pkg',
      })
      const res = await POST(req)

      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.success).toBe(true)
      expect(json.packagePurchaseId).toBe('pp-1')

      expect(applyApprovedPackagePayment).toHaveBeenCalledTimes(1)
      expect(applyApprovedPayment).not.toHaveBeenCalled()

      expect(mockPrisma.payment.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'pay-pkg-001' },
          data: expect.objectContaining({ providerPaymentId: 'mp-pkg-001' }),
        }),
      )

      expect(revalidatePath).toHaveBeenCalledWith('/dashboard/paquetes')
      expect(revalidatePath).toHaveBeenCalledWith('/dashboard/customers/cust-1')
    })

    it('rejects approved package payment with missing packagePurchaseId in metadata', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pkg-002' } }
      const signature = createMpSignatureHeader('mp-pkg-002', 'req-pkg2', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...basePackageMpPayment,
            id: 'mp-pkg-002',
            external_reference: 'pay-pkg-002',
            metadata: {
              localPaymentId: 'pay-pkg-002',
              businessId: 'biz-1',
              paymentType: 'package_purchase',
              // packagePurchaseId intentionally missing
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePackagePayment,
        id: 'pay-pkg-002',
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-pkg2',
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect(applyApprovedPackagePayment).not.toHaveBeenCalled()
    })

    it('rejects when metadata.packagePurchaseId does not match the DB payment', async () => {
      const secret = 'test-webhook-secret'
      const body = { data: { id: 'mp-pkg-003' } }
      const signature = createMpSignatureHeader('mp-pkg-003', 'req-pkg3', secret)

      mockMpFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...basePackageMpPayment,
            id: 'mp-pkg-003',
            external_reference: 'pay-pkg-003',
            metadata: {
              localPaymentId: 'pay-pkg-003',
              businessId: 'biz-1',
              paymentType: 'package_purchase',
              packagePurchaseId: 'wrong-purchase',
            },
          }),
      })

      mockPrisma.payment.findUnique.mockResolvedValue({
        ...basePackagePayment,
        id: 'pay-pkg-003',
      })

      const req = makeRequest(body, {
        'x-signature': signature,
        'x-request-id': 'req-pkg3',
      })
      const res = await POST(req)

      expect(res.status).toBe(400)
      expect(applyApprovedPackagePayment).not.toHaveBeenCalled()
    })
  })
})
