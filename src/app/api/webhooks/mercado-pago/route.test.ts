import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const { prismaMock, decryptSecret, fetchMock, getValidBusinessAccessTokenForAccount } = vi.hoisted(() => ({
  prismaMock: {
    payment: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    paymentProviderIncident: { upsert: vi.fn() },
    paymentAccount: { findFirst: vi.fn() },
    packagePurchase: { findUnique: vi.fn() },
    booking: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  decryptSecret: vi.fn(),
  fetchMock: vi.fn(),
  getValidBusinessAccessTokenForAccount: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ prisma: prismaMock }))
vi.mock('@/lib/payments/encryption', () => ({ decryptSecret }))
vi.mock('@/lib/payments/mercado-pago-oauth', () => ({ getValidBusinessAccessTokenForAccount }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/logger', () => ({
  logger: {
    webhook: { received: vi.fn(), rejected: vi.fn(), processed: vi.fn(), error: vi.fn() },
    payment: { approved: vi.fn() },
  },
}))
vi.mock('@/server/services/finance', () => ({
  applyApprovedPayment: vi.fn(), applyApprovedPackagePayment: vi.fn(),
  describeUnexpectedPackagePayment: vi.fn(),
}))
vi.mock('@/lib/notifications', () => ({
  sendNotificationSafely: vi.fn(), sendMultiNotificationSafely: vi.fn(),
  sendBookingConfirmedNotification: vi.fn(), sendPackagePurchasedNotification: vi.fn(),
  sendPackageSoldNotificationToBusiness: vi.fn(), sendPackageDisputedToBusiness: vi.fn(),
  sendPackageUnexpectedPaymentToBusiness: vi.fn(), sendBookingDisputedToBusiness: vi.fn(),
  sendBookingUnexpectedPaymentToBusiness: vi.fn(),
}))
vi.mock('@/lib/bookings/notify-payment-not-confirmed', () => ({ firePaymentNotConfirmedNotification: vi.fn() }))
vi.mock('@/lib/promotions/release', () => ({ releaseRedemptionForBooking: vi.fn() }))
vi.mock('@/lib/loyalty/clawback', () => ({ clawbackLoyaltyForBooking: vi.fn() }))
vi.mock('@/lib/packages/reverse', () => ({ reversePackagePurchaseInTx: vi.fn() }))
vi.mock('@/lib/bookings/reverse-payment', () => ({ reverseBookingPaymentInTx: vi.fn() }))
vi.mock('@/lib/bookings/number', () => ({ formatBookingNumber: vi.fn() }))
vi.mock('@/lib/vocabulary', () => ({ getVocabulary: vi.fn(() => ({ Client: 'Clienta' })) }))

import { POST } from './route'

const payment = {
  id: 'local-payment-1', businessId: 'business-a', bookingId: 'booking-a',
  packagePurchaseId: null, customerId: 'customer-a', provider: 'mercado_pago',
  providerPaymentId: null, providerPreferenceId: 'preference-a',
  providerEnvironment: 'sandbox', amount: 10_000, currency: 'CLP', status: 'pending',
  paymentType: 'deposit', paymentMethod: null, rawPayload: null,
  booking: { id: 'booking-a', businessId: 'business-a', customerId: 'customer-a' },
  packagePurchase: null,
}

function request(locator = 'local-payment-1', paymentId = 'provider-payment-1') {
  const url = new URL('https://agendita.cl/api/webhooks/mercado-pago')
  if (locator) url.searchParams.set('local_payment_id', locator)
  url.searchParams.set('data.id', paymentId)
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'payment', data: { id: paymentId } }),
  })
}

function providerPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: 'provider-payment-1', status: 'pending', status_detail: null,
    transaction_amount: 10_000, currency_id: 'CLP', date_approved: null,
    date_created: '2026-08-11T00:00:00Z', external_reference: 'local-payment-1',
    collector_id: 12345,
    metadata: { localPaymentId: 'local-payment-1', bookingId: 'booking-a', businessId: 'business-a', paymentType: 'deposit' },
    ...overrides,
  }
}

describe('Mercado Pago tenant webhook resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    delete process.env.MERCADO_PAGO_WEBHOOK_SECRET
    delete process.env.MERCADO_PAGO_ACCESS_TOKEN
    prismaMock.payment.findUnique.mockResolvedValue(payment)
    prismaMock.paymentAccount.findFirst.mockResolvedValue({
      businessId: 'business-a', environment: 'sandbox', status: 'connected',
      providerAccountId: '12345', accessTokenEncrypted: 'encrypted-a',
    })
    decryptSecret.mockReturnValue('seller-token-a')
    getValidBusinessAccessTokenForAccount.mockResolvedValue('seller-token-a')
    fetchMock.mockResolvedValue(new Response(JSON.stringify(providerPayment()), { status: 200 }))
    prismaMock.payment.update.mockResolvedValue(payment)
  })

  it('resolves the tenant locally and fetches only with its seller token', async () => {
    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(process.env.MERCADO_PAGO_ACCESS_TOKEN).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer seller-token-a')
    expect(prismaMock.paymentAccount.findFirst).toHaveBeenCalledWith({
      where: {
        businessId: 'business-a', provider: 'mercado_pago',
        environment: 'sandbox', status: 'connected',
      },
    })
  })

  it('rejects a missing local locator before database or network access', async () => {
    const response = await POST(request(''))

    expect(response.status).toBe(400)
    expect(prismaMock.payment.findUnique).not.toHaveBeenCalled()
    expect(prismaMock.paymentAccount.findFirst).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['unknown locator', 'unknown', null],
    ['wrong provider', 'local-payment-1', { ...payment, provider: 'manual' }],
    ['missing environment', 'local-payment-1', { ...payment, providerEnvironment: null }],
    ['booking from another tenant', 'local-payment-1', { ...payment, booking: { ...payment.booking, businessId: 'business-b' } }],
  ])('rejects %s before any provider network call', async (_label, locator, found) => {
    prismaMock.payment.findUnique.mockResolvedValue(found)

    const response = await POST(request(locator))

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(prismaMock.paymentAccount.findFirst).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a package purchase from another tenant before credential lookup', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      ...payment, bookingId: null, booking: null, packagePurchaseId: 'package-a',
      packagePurchase: { customerId: 'customer-a', businessId: 'business-b' },
    })

    const response = await POST(request())

    expect(response.status).toBe(403)
    expect(prismaMock.paymentAccount.findFirst).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not fall back to any global token when the seller account is absent', async () => {
    process.env.MERCADO_PAGO_ACCESS_TOKEN = 'must-not-be-used'
    prismaMock.paymentAccount.findFirst.mockResolvedValue(null)

    const response = await POST(request())

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it.each([
    ['crossed external reference', { external_reference: 'local-payment-b' }],
    ['crossed metadata business', { status: 'approved', metadata: { localPaymentId: 'local-payment-1', bookingId: 'booking-a', businessId: 'business-b', paymentType: 'deposit' } }],
    ['wrong seller', { collector_id: 99999 }],
    ['wrong amount', { transaction_amount: 9_999 }],
    ['wrong currency', { currency_id: 'ARS' }],
    ['wrong provider id', { id: 'another-provider-payment' }],
  ])('rejects %s after authoritative seller verification', async (_label, override) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(providerPayment(override)), { status: 200 }))

    const response = await POST(request())

    expect(response.status).toBeGreaterThanOrEqual(400)
    expect(prismaMock.payment.update).not.toHaveBeenCalled()
  })

  it('handles an already approved duplicate without applying a second local effect', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({ ...payment, status: 'approved', providerPaymentId: 'provider-payment-1' })
    fetchMock.mockImplementation(async () => new Response(JSON.stringify(providerPayment({
      status: 'approved', date_approved: '2026-08-11T01:00:00Z',
    })), { status: 200 }))

    const first = await POST(request())
    const second = await POST(request())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(prismaMock.payment.update).not.toHaveBeenCalled()
    expect(prismaMock.$transaction).not.toHaveBeenCalled()
  })

  it('persists a late distinct approval for manual review instead of returning a bare conflict', async () => {
    prismaMock.payment.findUnique.mockResolvedValue({
      ...payment, status: 'approved', providerPaymentId: 'provider-payment-winner',
    })
    fetchMock.mockResolvedValue(new Response(JSON.stringify(providerPayment({
      status: 'approved', date_approved: '2026-08-11T01:00:00Z',
    })), { status: 200 }))
    prismaMock.$transaction.mockImplementation(async (callback: (tx: typeof prismaMock) => unknown) => {
      prismaMock.payment.updateMany.mockResolvedValue({ count: 0 })
      prismaMock.paymentProviderIncident.upsert.mockResolvedValue({ id: 'incident-1' })
      return callback(prismaMock)
    })

    const response = await POST(request())

    expect(response.status).toBe(200)
    expect(prismaMock.paymentProviderIncident.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ kind: 'distinct_approved_overpayment', status: 'manual_review' }),
    }))
  })

  it('projects hostile provider payloads before persistence', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(providerPayment({
      payer: { email: 'sentinel@example.com', identification: { number: 'SECRET' } },
      card: { first_six_digits: '123456' }, token: 'SENTINEL_TOKEN',
      transaction_details: { external_resource_url: 'https://secret.example' },
    })), { status: 200 }))

    const response = await POST(request())
    expect(response.status).toBe(200)
    const persisted = prismaMock.payment.update.mock.calls[0][0].data.rawPayload
    expect(JSON.stringify(persisted)).not.toMatch(/sentinel|secret|123456/i)
    expect(persisted).toEqual(expect.objectContaining({
      id: 'provider-payment-1', status: 'pending', collectorId: '12345',
    }))
  })
})
