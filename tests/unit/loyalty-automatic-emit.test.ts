import { describe, it, expect, vi } from 'vitest'
import { emitAutomaticReward } from '@/lib/loyalty/automatic'

const cfg = { grantExpiryDays: 90, forfeitGrantOnNoShow: false }

function fakeTx(opts: { ledgerThrows?: boolean } = {}) {
  return {
    loyaltyLedger: {
      create: opts.ledgerThrows
        ? vi.fn().mockRejectedValue({ code: 'P2002' })
        : vi.fn().mockResolvedValue({ id: 'l1' }),
    },
    promotion: { findFirst: vi.fn().mockResolvedValue(null) },
    promotionGrant: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'g1', code: 'ABC' }),
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
  it('puntos: P2002 (ya emitido) => null sin romper', async () => {
    const tx = fakeTx({ ledgerThrows: true })
    const out = await emitAutomaticReward(tx, { rule: pointsRule as any, businessId: 'b1',
      customerId: 'c1', dedupeKey: 'k1', config: cfg, now: new Date('2026-06-29') })
    expect(out).toBeNull()
  })
  it('grant: crea PromotionGrant pointsSpent 0 y refundOnExpiry false', async () => {
    const tx = fakeTx()
    const out = await emitAutomaticReward(tx, { rule: grantRule as any, businessId: 'b1',
      customerId: 'c1', dedupeKey: 'k2', config: cfg, now: new Date('2026-06-29') })
    expect(tx.promotionGrant.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ pointsSpent: 0, refundOnExpiry: false, requestId: 'k2' }) }))
    expect(out).toEqual({ kind: 'grant', grantId: 'g1', code: 'ABC' })
  })
})
