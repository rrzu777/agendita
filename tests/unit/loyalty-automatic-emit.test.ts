import { describe, it, expect, vi } from 'vitest'
import { emitAutomaticReward, reverseAutoRewardsForBooking } from '@/lib/loyalty/automatic'

const cfg = { grantExpiryDays: 90, forfeitGrantOnNoShow: false }

/** `alreadyEmitted`: la clave única (dedupeKey / requestId) ya existe. Es lo que ve
 *  el PRE-CHEQUEO — la dedup NO puede ser un catch del P2002, porque esto corre
 *  adentro de una tx y Postgres abortaría la transacción entera. */
function fakeTx(opts: { alreadyEmitted?: boolean } = {}) {
  const existing = opts.alreadyEmitted ? { id: 'ya-estaba' } : null
  return {
    loyaltyLedger: {
      findUnique: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockResolvedValue({ id: 'l1' }),
      count: vi.fn().mockResolvedValue(0),
    },
    promotion: { findFirst: vi.fn().mockResolvedValue(null) },
    promotionGrant: {
      findUnique: vi.fn().mockResolvedValue(existing),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'g1', code: 'ABC' }),
      count: vi.fn().mockResolvedValue(0),
    },
  } as any
}

const pointsRule = { id: 'r1', businessId: 'b1', conditions: { kind: 'birthday' },
  rewardPoints: 150, rewardType: null, rewardValue: 0, maxDiscount: null,
  appliesToAll: true, grantExpiryDays: null, services: [] }
const grantRule = { ...pointsRule, rewardPoints: null, rewardType: 'percentage', rewardValue: 20 }

describe('emitAutomaticReward', () => {
  it('puntos: inserta un asiento bonus con dedupeKey y triggeringBookingId', async () => {
    const tx = fakeTx()
    const out = await emitAutomaticReward(tx, { rule: pointsRule as any, businessId: 'b1',
      customerId: 'c1', dedupeKey: 'k1', config: cfg, triggeringBookingId: 'bk1', now: new Date('2026-06-29') })
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ points: 150, reason: 'bonus', dedupeKey: 'k1', bookingId: null }) }))
    expect(out).toEqual({ kind: 'points', points: 150, ledgerId: 'l1' })
  })
  it('puntos: ya emitido => null SIN intentar el insert (nada de P2002 adentro de la tx)', async () => {
    const tx = fakeTx({ alreadyEmitted: true })
    const out = await emitAutomaticReward(tx, { rule: pointsRule as any, businessId: 'b1',
      customerId: 'c1', dedupeKey: 'k1', config: cfg, now: new Date('2026-06-29') })
    expect(out).toBeNull()
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('grant: ya emitido => null SIN intentar el insert', async () => {
    const tx = fakeTx({ alreadyEmitted: true })
    const out = await emitAutomaticReward(tx, { rule: grantRule as any, businessId: 'b1',
      customerId: 'c1', dedupeKey: 'k2', config: cfg, now: new Date('2026-06-29') })
    expect(out).toBeNull()
    expect(tx.promotionGrant.create).not.toHaveBeenCalled()
  })
  it('grant: crea PromotionGrant pointsSpent 0 y refundOnExpiry false', async () => {
    const tx = fakeTx()
    const out = await emitAutomaticReward(tx, { rule: grantRule as any, businessId: 'b1',
      customerId: 'c1', dedupeKey: 'k2', config: cfg, now: new Date('2026-06-29') })
    expect(tx.promotionGrant.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pointsSpent: 0, refundOnExpiry: false, requestId: 'k2' }) }))
    expect(out).toEqual({ kind: 'grant', grantId: 'g1', code: 'ABC' })
  })
  it('R-CAP: si la clienta ya alcanzó maxPerCustomer => null sin emitir', async () => {
    const tx = fakeTx()
    tx.loyaltyLedger.count = vi.fn().mockResolvedValue(1)
    tx.promotionGrant.count = vi.fn().mockResolvedValue(0)
    const out = await emitAutomaticReward(tx, { rule: { ...pointsRule, maxPerCustomer: 1 } as any,
      businessId: 'b1', customerId: 'c1', dedupeKey: 'k9', config: cfg, now: new Date('2026-06-29') })
    expect(out).toBeNull()
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
})

describe('reverseAutoRewardsForBooking', () => {
  /** `reversals` son los dedupeKey de reversiones que YA existen. `loyaltyLedger.findMany`
   *  recibe dos consultas distintas (los bonus de la reserva y las reversiones ya
   *  hechas): un mock que contestara lo mismo a las dos estaría mintiendo. */
  function clawbackTx(bonuses: any[], grants: any[], reversals: string[] = []) {
    return {
      loyaltyLedger: {
        findMany: vi.fn(async (args: any) =>
          args?.where?.dedupeKey ? reversals.map((dedupeKey) => ({ dedupeKey })) : bonuses),
        create: vi.fn().mockResolvedValue({ id: 'rev' }),
      },
      promotionGrant: {
        findMany: vi.fn().mockResolvedValue(grants),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    } as any
  }
  it('reversa los puntos bonus de la reserva con un asiento bonus_reversal', async () => {
    const tx = clawbackTx([{ id: 'l1', businessId: 'b1', customerId: 'c1', points: 150 }], [])
    await reverseAutoRewardsForBooking(tx, 'bk1', new Date())
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ points: -150, reason: 'bonus_reversal', dedupeKey: 'reversal:l1' }) }))
  })
  it('no re-reversa lo que ya estaba reversado (sin insert repetido que aborte la tx)', async () => {
    const tx = clawbackTx(
      [{ id: 'l1', businessId: 'b1', customerId: 'c1', points: 150 }], [], ['reversal:l1'],
    )
    await reverseAutoRewardsForBooking(tx, 'bk1', new Date())
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('reversa grants automáticos activos (flip a reversed)', async () => {
    const tx = clawbackTx([], [{ id: 'g1' }])
    await reverseAutoRewardsForBooking(tx, 'bk1', new Date())
    expect(tx.promotionGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'g1', status: 'active' }),
      data: expect.objectContaining({ status: 'reversed' }) }))
  })
})
