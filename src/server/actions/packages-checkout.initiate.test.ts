import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: () => getCurrentUser() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))

const getOnlinePaymentProviderForBusiness = vi.fn()
vi.mock('@/lib/payments/factory', () => ({
  resolveOnlinePaymentAvailabilityForBusiness: vi.fn(),
  getOnlinePaymentProviderForBusiness: (...a: unknown[]) => getOnlinePaymentProviderForBusiness(...a),
}))

const createMpPreferenceForPayment = vi.fn()
vi.mock('@/lib/payments/create-preference', () => ({
  createMpPreferenceForPayment: (...a: unknown[]) => createMpPreferenceForPayment(...a),
  getPaymentAppUrl: () => 'https://app.test',
}))

const applyApprovedPackagePayment = vi.fn()
vi.mock('@/server/services/finance', () => ({ applyApprovedPackagePayment: (...a: unknown[]) => applyApprovedPackagePayment(...a) }))

// vi.mock factories are hoisted above top-level const declarations, so a
// factory that closes over `prismaMock` directly (rather than through an
// indirection function, like the other mocks above) hits a TDZ
// ReferenceError. vi.hoisted() lifts the object's creation alongside the
// mock registration to avoid that.
const { prismaMock } = vi.hoisted(() => {
  const prismaMock = {
    packagePurchase: { findUnique: vi.fn() },
    payment: { findFirst: vi.fn(), create: vi.fn() },
    $transaction: (fn: (t: unknown) => unknown) => fn(prismaMock),
  }
  return { prismaMock }
})
vi.mock('@/lib/db', () => ({ prisma: prismaMock }))

import { initiatePackagePayment } from './packages-checkout'

const purchase = {
  id: 'pp1', businessId: 'b1', customerId: 'c1', pricePaid: 50000, status: 'pending',
  customer: { userId: 'u1', email: 'ana@x.cl' },
  product: { name: 'Pack 5' },
  business: { slug: 'demo', subdomain: null, currency: 'CLP' },
}

describe('initiatePackagePayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@x.cl' })
    prismaMock.packagePurchase.findUnique.mockResolvedValue(purchase)
    getOnlinePaymentProviderForBusiness.mockResolvedValue({ name: 'mercado_pago' })
    prismaMock.payment.findFirst.mockResolvedValue(null)
    prismaMock.payment.create.mockResolvedValue({ id: 'pay1' })
    createMpPreferenceForPayment.mockResolvedValue({ redirectUrl: 'https://mp/redirect', paymentId: 'pay1' })
  })

  it('rechaza si la compra no es del usuario logueado', async () => {
    prismaMock.packagePurchase.findUnique.mockResolvedValue({ ...purchase, customer: { userId: 'otro' } })
    const res = await initiatePackagePayment({ purchaseId: 'pp1' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(/no.*(corresponde|pertenece|autoriz)/i)
  })

  it('pre-crea Payment package_purchase pending y devuelve redirectUrl', async () => {
    const res = await initiatePackagePayment({ purchaseId: 'pp1' })
    const data = prismaMock.payment.create.mock.calls[0][0].data
    expect(data.paymentType).toBe('package_purchase')
    expect(data.packagePurchaseId).toBe('pp1')
    expect(data.status).toBe('pending')
    expect(data.amount).toBe(50000)
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.data).toEqual({ redirectUrl: 'https://mp/redirect' })
    const prefArgs = createMpPreferenceForPayment.mock.calls[0][1]
    expect(prefArgs.metadata).toMatchObject({ packagePurchaseId: 'pp1', businessId: 'b1', paymentType: 'package_purchase', localPaymentId: 'pay1' })
  })

  it('reusa Payment pending existente (anti doble-click)', async () => {
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'payExisting' })
    await initiatePackagePayment({ purchaseId: 'pp1' })
    expect(prismaMock.payment.create).not.toHaveBeenCalled()
    expect(createMpPreferenceForPayment.mock.calls[0][1].localPaymentId).toBe('payExisting')
  })

  it('provider mock (sin redirect) confirma vía applyApprovedPackagePayment', async () => {
    getOnlinePaymentProviderForBusiness.mockResolvedValue({ name: 'mock' })
    createMpPreferenceForPayment.mockResolvedValue({ redirectUrl: null, paymentId: 'pay1' })
    // verifyAndConfirmPackagePayment (llamada internamente por la rama mock, vía
    // la versión _raw sin ActionResult) re-consulta payment.findFirst para
    // localizar el Payment a confirmar. Ajuste mínimo vs. el snippet del plan:
    // dejamos que devuelva el Payment recién creado (mock provider, sin
    // providerPaymentId/paymentMethod) para ejercer la rama real de
    // confirmación en vez de que explote con 'Pago no encontrado'.
    prismaMock.payment.findFirst.mockResolvedValue({ id: 'pay1', provider: 'mock', providerPaymentId: null, paymentMethod: null })
    const res = await initiatePackagePayment({ purchaseId: 'pp1' })
    expect(res.ok).toBe(true)
    if (!res.ok) throw new Error('expected ok')
    expect(res.data).toEqual({ confirmed: true })
    expect(applyApprovedPackagePayment).toHaveBeenCalled()
  })
})
