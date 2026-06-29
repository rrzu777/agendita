import { describe, it, expect, vi } from 'vitest'
import { redeemForGrant } from '@/lib/loyalty/redeem'

const PROMO = { id: 'p1', businessId: 'b1', triggerType: 'granted', isActive: true,
  pointsCost: 80, grantExpiryDays: 30, maxRedemptions: null, maxPerCustomer: null }
const CONFIG = { isActive: true, grantExpiryDays: 90, refundPointsOnExpiry: true, forfeitGrantOnNoShow: false }

function fakeTx(opts: { balance: number; existing?: any; claimed?: number } ) {
  return {
    $executeRaw: vi.fn().mockResolvedValue(1),
    promotionGrant: {
      findUnique: vi.fn().mockResolvedValue(opts.existing ?? null),
      findMany: vi.fn().mockResolvedValue([]),       // reconcile: sin vencidos
      findFirst: vi.fn().mockResolvedValue(null),    // generateGrantCode: sin colisión
      count: vi.fn().mockResolvedValue(opts.claimed ?? 0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'g1', code: 'ABC123' }),
    },
    promotion: { findFirst: vi.fn().mockResolvedValue(null), update: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    loyaltyLedger: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { points: opts.balance } }),
      create: vi.fn().mockResolvedValue({}),
    },
  } as any
}

describe('redeemForGrant', () => {
  it('toma el advisory lock, descuenta puntos y emite el grant', async () => {
    const tx = fakeTx({ balance: 100 })
    const grant = await redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: PROMO as any, config: CONFIG, requestId: 'r1', createdByUserId: 'u1' })
    expect(tx.$executeRaw).toHaveBeenCalled()
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ points: -80, reason: 'redemption' }) }))
    expect(tx.promotionGrant.create).toHaveBeenCalled()
    expect(grant).toEqual({ id: 'g1', code: 'ABC123' })
  })
  it('rechaza si el programa está pausado (config.isActive=false)', async () => {
    const tx = fakeTx({ balance: 100 })
    await expect(redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: PROMO as any, config: { ...CONFIG, isActive: false }, requestId: 'r1' }))
      .rejects.toThrow(/pausado/)
    expect(tx.promotionGrant.create).not.toHaveBeenCalled()
  })
  it('idempotente: si ya hay grant con ese requestId lo devuelve sin tocar nada', async () => {
    const tx = fakeTx({ balance: 100, existing: { id: 'gOld' } })
    const grant = await redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: PROMO as any, config: CONFIG, requestId: 'r1' })
    expect(grant).toEqual({ id: 'gOld' })
    expect(tx.promotionGrant.create).not.toHaveBeenCalled()
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('rechaza si el saldo no alcanza', async () => {
    const tx = fakeTx({ balance: 50 })
    await expect(redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: PROMO as any, config: CONFIG, requestId: 'r1' })).rejects.toThrow(/suficientes/)
    expect(tx.promotionGrant.create).not.toHaveBeenCalled()
  })
  it('rechaza si el stock se agotó (incremento condicional count 0)', async () => {
    const tx = fakeTx({ balance: 100 })
    tx.promotion.updateMany = vi.fn().mockResolvedValue({ count: 0 })
    await expect(redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: { ...PROMO, maxRedemptions: 5 } as any, config: CONFIG, requestId: 'r1' })).rejects.toThrow(/agotó/)
  })
  it('rechaza si la clienta superó su tope', async () => {
    const tx = fakeTx({ balance: 100, claimed: 2 })
    await expect(redeemForGrant(tx, { businessId: 'b1', customerId: 'c1',
      promotion: { ...PROMO, maxPerCustomer: 2 } as any, config: CONFIG, requestId: 'r1' })).rejects.toThrow(/límite/)
  })
})
