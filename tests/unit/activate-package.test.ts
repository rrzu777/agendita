import { describe, it, expect, vi, beforeEach } from 'vitest'

const { activatePackagePurchaseInTx } = await import('@/lib/packages/activate')

function makeTx() {
  return {
    promotion: {
      // El marker se busca sin `code`; generateGrantCode busca por `code` (sin colisión).
      findFirst: vi.fn().mockImplementation((args: any) =>
        Promise.resolve(args?.where?.code ? null : { id: 'marker' })),
      create: vi.fn().mockResolvedValue({ id: 'marker' }),
    },
    promotionGrant: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
    },
    packagePurchase: { update: vi.fn().mockResolvedValue({}) },
    ledgerEntry: { create: vi.fn().mockResolvedValue({}), upsert: vi.fn().mockResolvedValue({}) },
  } as any
}

const purchase = {
  id: 'p1', businessId: 'b1', customerId: 'c1', pricePaid: 30000,
  quantity: 3, bonusQuantity: 1, expiresAt: null, createdByUserId: 'u1',
}

describe('activatePackagePurchaseInTx', () => {
  it('emite quantity+bonus grants, activa la compra y escribe el asiento de ledger', async () => {
    const tx = makeTx()
    await activatePackagePurchaseInTx(tx, purchase, { requestId: 'req' })
    expect(tx.promotionGrant.create).toHaveBeenCalledTimes(4)
    expect(tx.packagePurchase.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { status: 'active' } })
    expect(tx.ledgerEntry.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        businessId: 'b1', packagePurchaseId: 'p1', customerId: 'c1',
        type: 'package_sale', direction: 'income', amount: 30000, paymentId: null,
      }),
    }))
  })

  it('usa ledgerEntry.upsert (no create) cuando hay paymentId', async () => {
    const tx = makeTx()
    await activatePackagePurchaseInTx(tx, purchase, { requestId: 'req', paymentId: 'pay1' })
    expect(tx.ledgerEntry.create).not.toHaveBeenCalled()
    expect(tx.ledgerEntry.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { paymentId: 'pay1' },
    }))
  })

  it('usa requestId determinista por grant', async () => {
    const tx = makeTx()
    await activatePackagePurchaseInTx(tx, purchase, { requestId: 'req' })
    const requestIds = tx.promotionGrant.create.mock.calls.map((c: any) => c[0].data.requestId)
    expect(requestIds).toEqual(['req#0', 'req#1', 'req#2', 'req#3'])
  })
})
