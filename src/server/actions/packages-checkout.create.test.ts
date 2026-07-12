import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: () => getCurrentUser() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))

const findOrCreateCustomerInTx = vi.fn()
vi.mock('@/lib/customers/find-or-create', () => ({ findOrCreateCustomerInTx: (...a: unknown[]) => findOrCreateCustomerInTx(...a) }))

const resolveOnlinePaymentAvailabilityForBusiness = vi.fn()
vi.mock('@/lib/payments/factory', () => ({
  resolveOnlinePaymentAvailabilityForBusiness: (...a: unknown[]) => resolveOnlinePaymentAvailabilityForBusiness(...a),
}))

const tx = {
  packageProduct: { findFirst: vi.fn() },
  packagePurchase: { findFirst: vi.fn(), create: vi.fn() },
}
vi.mock('@/lib/db', () => ({
  prisma: {
    packageProduct: { findFirst: (...a: unknown[]) => tx.packageProduct.findFirst(...a) },
    $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
  },
}))

import { createPackagePurchase } from './packages-checkout'

const baseInput = { packageProductId: 'prod1', name: 'Ana', phone: '+56911112222', acceptedTerms: true }
const product = {
  id: 'prod1', businessId: 'b1', name: 'Pack 5', price: 50000, quantity: 5, bonusQuantity: 1,
  appliesToAll: true, expiryDays: 90, isActive: true, services: [],
}

describe('createPackagePurchase', () => {
  beforeEach(() => {
    Object.values(tx).forEach(m => Object.values(m).forEach(f => (f as ReturnType<typeof vi.fn>).mockReset()))
    getCurrentUser.mockReset(); findOrCreateCustomerInTx.mockReset(); resolveOnlinePaymentAvailabilityForBusiness.mockReset()
    getCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@x.cl' })
    resolveOnlinePaymentAvailabilityForBusiness.mockResolvedValue({ available: true, provider: 'mercado_pago' })
    tx.packageProduct.findFirst.mockResolvedValue(product)
    findOrCreateCustomerInTx.mockResolvedValue({ customer: { id: 'c1', email: 'ana@x.cl' }, created: false })
    tx.packagePurchase.findFirst.mockResolvedValue(null)
    tx.packagePurchase.create.mockImplementation(({ data }: { data: Record<string, unknown> }) => ({ id: 'pp1', ...data }))
  })

  it('rechaza si no hay sesión', async () => {
    getCurrentUser.mockResolvedValue(null)
    await expect(createPackagePurchase(baseInput)).rejects.toThrow(/iniciar sesión|login|sesión/i)
  })

  it('re-gatea disponibilidad online y rechaza si no disponible', async () => {
    resolveOnlinePaymentAvailabilityForBusiness.mockResolvedValue({ available: false, reason: 'no MP' })
    await expect(createPackagePurchase(baseInput)).rejects.toThrow('no MP')
  })

  it('pasa el email verificado de sesión y el sessionUser a findOrCreateCustomerInTx', async () => {
    await createPackagePurchase(baseInput)
    const arg = findOrCreateCustomerInTx.mock.calls[0][1]
    expect(arg.email).toBe('ana@x.cl')
    expect(arg.sessionUser).toEqual({ id: 'u1', email: 'ana@x.cl' })
    expect(arg.businessId).toBe('b1')
  })

  it('crea PackagePurchase pending/online con snapshots y holdExpiresAt futuro', async () => {
    const { purchaseId } = await createPackagePurchase(baseInput)
    expect(purchaseId).toBe('pp1')
    const data = tx.packagePurchase.create.mock.calls[0][0].data
    expect(data.status).toBe('pending')
    expect(data.source).toBe('online')
    expect(data.pricePaid).toBe(50000)
    expect(data.quantity).toBe(5)
    expect(data.bonusQuantity).toBe(1)
    expect(data.coversAll).toBe(true)
    expect(data.holdExpiresAt.getTime()).toBeGreaterThan(Date.now())
  })

  it('reusa una compra pending viva en vez de crear otra', async () => {
    tx.packagePurchase.findFirst.mockResolvedValue({ id: 'ppExisting', holdExpiresAt: new Date(Date.now() + 60000) })
    const { purchaseId } = await createPackagePurchase(baseInput)
    expect(purchaseId).toBe('ppExisting')
    expect(tx.packagePurchase.create).not.toHaveBeenCalled()
  })
})
