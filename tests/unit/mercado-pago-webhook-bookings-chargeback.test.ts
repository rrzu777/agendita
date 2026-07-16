import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createHmac } from 'crypto'

const mockMpFetch = vi.fn()
vi.stubGlobal('fetch', mockMpFetch)

// Solo los modelos que las ramas testeadas tocan de verdad: el núcleo de
// reversión y las notifs están mockeados por módulo, así que ledger/loyalty/
// grants nunca se alcanzan desde acá.
const mockPrisma = {
  payment: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  booking: {
    findUnique: vi.fn(),
  },
  packagePurchase: {
    findUnique: vi.fn(),
  },
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

vi.mock('@/server/services/finance', () => ({
  applyApprovedPayment: vi.fn(),
  applyApprovedPackagePayment: vi.fn().mockResolvedValue({ wasActivated: true }),
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
  sendPackageDisputedToBusiness: vi.fn().mockResolvedValue([{ success: true }]),
  sendBookingDisputedToBusiness: vi.fn().mockResolvedValue([{ success: true }]),
}))

vi.mock('@/lib/packages/reverse', () => ({
  reversePackagePurchaseInTx: vi.fn().mockResolvedValue({ reversed: true }),
}))

vi.mock('@/lib/bookings/reverse-payment', () => ({
  reverseBookingPaymentInTx: vi.fn().mockResolvedValue({ reversed: true }),
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

const { reverseBookingPaymentInTx } = await import('@/lib/bookings/reverse-payment')
const { reversePackagePurchaseInTx } = await import('@/lib/packages/reverse')
const { sendBookingDisputedToBusiness } = await import('@/lib/notifications')
const { revalidatePath } = await import('next/cache')

describe('Mercado Pago webhook — chargeback/refund de RESERVA post-approved', () => {
  let POST: (req: Request) => Promise<Response>

  const baseMpPayment = {
    id: 'mp-bk-001',
    status: 'charged_back',
    status_detail: null,
    transaction_amount: 8000,
    currency_id: 'CLP',
    date_approved: '2026-07-10T10:30:00Z',
    date_created: '2026-07-10T10:25:00Z',
    external_reference: 'pay-bk-001',
    metadata: {
      bookingId: 'bk-1',
      businessId: 'biz-1',
      localPaymentId: 'pay-bk-001',
    },
  }

  const approvedBookingPayment = {
    id: 'pay-bk-001',
    bookingId: 'bk-1',
    packagePurchaseId: null,
    businessId: 'biz-1',
    customerId: 'cust-1',
    provider: 'mercado_pago',
    providerPaymentId: 'mp-bk-001',
    amount: 8000,
    currency: 'CLP',
    status: 'approved',
    paymentType: 'deposit',
    paymentMethod: null,
    booking: {
      id: 'bk-1', businessId: 'biz-1', customerId: 'cust-1', status: 'confirmed',
      bookingNumber: 4738, startDateTime: new Date('2026-07-20T15:00:00Z'),
    },
    packagePurchase: null,
  }

  beforeEach(async () => {
    setEnv({
      MERCADO_PAGO_ACCESS_TOKEN: 'test-access-token',
      MERCADO_PAGO_WEBHOOK_SECRET: 'test-webhook-secret',
      NODE_ENV: 'development',
    })
    vi.clearAllMocks()
    mockMpFetch.mockReset()
    ;(reverseBookingPaymentInTx as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ reversed: true })
    ;(reversePackagePurchaseInTx as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ reversed: true })

    // Fetch de nombres para la alarma (fuera de la tx)
    mockPrisma.booking.findUnique.mockReset().mockResolvedValue({
      customer: { name: 'Caro P' },
      service: { name: 'Manicure' },
      business: { name: 'Estudio Mimo', currency: 'CLP', timezone: 'America/Santiago' },
    })
    mockPrisma.$transaction.mockReset().mockImplementation(async (fn: (tx: unknown) => unknown) => fn(mockPrisma))

    vi.resetModules()
    const mod = await import('@/app/api/webhooks/mercado-pago/route')
    POST = mod.POST as unknown as (req: Request) => Promise<Response>
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  function makeRequest(mpPaymentId: string, requestId: string): Request {
    const signature = createMpSignatureHeader(mpPaymentId, requestId, 'test-webhook-secret')
    return new Request('https://example.com/api/webhooks/mercado-pago', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': signature,
        'x-request-id': requestId,
      },
      body: JSON.stringify({ data: { id: mpPaymentId } }),
    })
  }

  it('charged_back sobre Payment de reserva approved: revierte en modo chargeback con flipData y notifica', async () => {
    mockMpFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(baseMpPayment) })
    mockPrisma.payment.findUnique.mockResolvedValue(approvedBookingPayment)

    const res = await POST(makeRequest('mp-bk-001', 'req-cb'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('Booking chargeback processed')
    expect(json.bookingId).toBe('bk-1')

    expect(reverseBookingPaymentInTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      paymentId: 'pay-bk-001',
      bookingId: 'bk-1',
      businessId: 'biz-1',
      customerId: 'cust-1',
      amount: 8000,
      currency: 'CLP',
      mode: 'chargeback',
      flipData: expect.objectContaining({ providerPaymentId: 'mp-bk-001' }),
    }))
    expect(sendBookingDisputedToBusiness).toHaveBeenCalledWith('biz-1', expect.objectContaining({
      customerName: 'Caro P',
      serviceName: 'Manicure',
      bookingLabel: '#4738',
      amount: 8000,
    }))
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/bookings')
    expect(revalidatePath).toHaveBeenCalledWith('/dashboard/customers/cust-1')
  })

  it('refunded sobre Payment de reserva approved: modo voluntary, SIN alarma', async () => {
    mockMpFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ...baseMpPayment, status: 'refunded' }) })
    mockPrisma.payment.findUnique.mockResolvedValue(approvedBookingPayment)

    const res = await POST(makeRequest('mp-bk-001', 'req-ref'))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.message).toBe('Booking refund processed')

    expect(reverseBookingPaymentInTx).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: 'voluntary' }))
    expect(sendBookingDisputedToBusiness).not.toHaveBeenCalled()
  })

  it('redelivery (núcleo devuelve reversed false): 200 idempotente sin notificación ni revalidate', async () => {
    ;(reverseBookingPaymentInTx as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({ reversed: false })
    mockMpFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(baseMpPayment) })
    mockPrisma.payment.findUnique.mockResolvedValue(approvedBookingPayment)

    const res = await POST(makeRequest('mp-bk-001', 'req-rd'))
    expect(res.status).toBe(200)
    expect(sendBookingDisputedToBusiness).not.toHaveBeenCalled()
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('Payment local ya refunded (gate no matchea): NO llama al núcleo', async () => {
    mockMpFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve(baseMpPayment) })
    mockPrisma.payment.findUnique.mockResolvedValue({ ...approvedBookingPayment, status: 'refunded' })

    const res = await POST(makeRequest('mp-bk-001', 'req-old'))
    expect(res.status).toBe(200)
    expect(reverseBookingPaymentInTx).not.toHaveBeenCalled()
  })

  it('redelivery REAL end-to-end: Payment local ya refunded → 200 sin re-liberar redención ni re-revertir puntos', async () => {
    const { releaseRedemptionForBooking } = await import('@/lib/promotions/release')
    const { reverseVisitPoints } = await import('@/lib/loyalty/credit')
    mockMpFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ...baseMpPayment, status: 'refunded' }) })
    const refundedPayment = { ...approvedBookingPayment, status: 'refunded' }
    mockPrisma.payment.findUnique.mockResolvedValue(refundedPayment)

    const res = await POST(makeRequest('mp-bk-001', 'req-rd2'))
    expect(res.status).toBe(200)
    expect(reverseBookingPaymentInTx).not.toHaveBeenCalled()
    expect(releaseRedemptionForBooking).not.toHaveBeenCalled()
    expect(reverseVisitPoints).not.toHaveBeenCalled()
    expect(mockPrisma.payment.update).not.toHaveBeenCalled()
  })

  it('la rama vieja SIGUE degradando un Payment pending con mpStatus rejected', async () => {
    mockMpFetch.mockResolvedValue({ ok: true, json: () => Promise.resolve({ ...baseMpPayment, status: 'rejected' }) })
    const pendingPayment = { ...approvedBookingPayment, status: 'pending' }
    mockPrisma.payment.findUnique.mockResolvedValue(pendingPayment)

    const res = await POST(makeRequest('mp-bk-001', 'req-rej'))
    expect(res.status).toBe(200)
    expect(mockPrisma.payment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'pay-bk-001' },
      data: expect.objectContaining({ status: 'rejected' }),
    }))
  })

  it('payment de PAQUETE con charged_back: va a reversePackagePurchaseInTx, nunca al núcleo de reservas', async () => {
    mockMpFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ ...baseMpPayment, id: 'mp-pkg-001', external_reference: 'pay-pkg-001' }),
    })
    mockPrisma.payment.findUnique.mockResolvedValue({
      ...approvedBookingPayment,
      id: 'pay-pkg-001',
      bookingId: null,
      booking: null,
      packagePurchaseId: 'pp-1',
      packagePurchase: { customerId: 'cust-1' },
      providerPaymentId: 'mp-pkg-001',
    })
    mockPrisma.packagePurchase.findUnique.mockResolvedValue({
      id: 'pp-1', businessId: 'biz-1', customerId: 'cust-1', status: 'active',
      product: { name: 'Pack 5' }, customer: { name: 'Ana' }, business: { name: 'Studio', currency: 'CLP' },
    })

    const res = await POST(makeRequest('mp-pkg-001', 'req-pkg'))
    expect(res.status).toBe(200)
    expect(reversePackagePurchaseInTx).toHaveBeenCalled()
    expect(reverseBookingPaymentInTx).not.toHaveBeenCalled()
  })
})
