import { describe, it, expect, vi, beforeEach } from 'vitest'

const getCurrentUser = vi.fn()
vi.mock('@/lib/auth/user', () => ({ getCurrentUser: () => getCurrentUser() }))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn().mockResolvedValue({ success: true }) }))

const { ensureUserRow, AccountConflictError } = vi.hoisted(() => {
  class AccountConflictError extends Error {}
  return { ensureUserRow: vi.fn(), AccountConflictError }
})
vi.mock('@/lib/auth/ensure-user-row', () => ({ ensureUserRow, AccountConflictError }))

const findOrCreateCustomerInTx = vi.fn()
vi.mock('@/lib/customers/find-or-create', () => ({ findOrCreateCustomerInTx: (...a: unknown[]) => findOrCreateCustomerInTx(...a) }))

const resolveOnlinePaymentAvailabilityForBusiness = vi.fn()
vi.mock('@/lib/payments/factory', () => ({
  resolveOnlinePaymentAvailabilityForBusiness: (...a: unknown[]) => resolveOnlinePaymentAvailabilityForBusiness(...a),
}))

const tx = {
  packageProduct: { findFirst: vi.fn() },
  packagePurchase: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
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
    ensureUserRow.mockReset()
    getCurrentUser.mockResolvedValue({ id: 'u1', email: 'ana@x.cl' })
    ensureUserRow.mockResolvedValue(undefined)
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

  it('asegura la fila User (Vía 3) antes de vincular el Customer — clienta que nunca pasó por /mi', async () => {
    await createPackagePurchase(baseInput)
    expect(ensureUserRow).toHaveBeenCalledWith({ id: 'u1', email: 'ana@x.cl' })
    // ensureUserRow debe correr ANTES de findOrCreateCustomerInTx: si no, el FK
    // Customer.userId -> User.id hace que linkCustomerFromBookingSession (Vía 3)
    // sea un no-op silencioso y la compra queda sin dueña.
    const ensureOrder = ensureUserRow.mock.invocationCallOrder[0]
    const linkOrder = findOrCreateCustomerInTx.mock.invocationCallOrder[0]
    expect(ensureOrder).toBeLessThan(linkOrder)
  })

  it('propaga un mensaje limpio si ensureUserRow encuentra un conflicto de cuenta', async () => {
    ensureUserRow.mockRejectedValue(new AccountConflictError('Tu email ya está asociado a otra cuenta.'))
    await expect(createPackagePurchase(baseInput)).rejects.toThrow('Tu email ya está asociado a otra cuenta.')
    expect(findOrCreateCustomerInTx).not.toHaveBeenCalled()
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

  it('reusa una compra pending viva (recalculando el hold) en vez de crear otra', async () => {
    tx.packagePurchase.findFirst.mockResolvedValue({ id: 'ppExisting', holdExpiresAt: new Date(Date.now() + 60000) })
    const { purchaseId } = await createPackagePurchase(baseInput)
    expect(purchaseId).toBe('ppExisting')
    expect(tx.packagePurchase.create).not.toHaveBeenCalled()
    // El reuse recalcula holdExpiresAt al método actual (posible cambio mp→transfer).
    expect(tx.packagePurchase.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'ppExisting' },
      data: expect.objectContaining({ holdExpiresAt: expect.any(Date) }),
    }))
  })
})
