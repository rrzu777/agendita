import { describe, it, expect, vi } from 'vitest'
import { captureReferral, rewardReferralOnCompletion } from '@/lib/loyalty/referral'

describe('captureReferral', () => {
  function tx(referrer: any) {
    return {
      customer: { findFirst: vi.fn().mockResolvedValue(referrer) },
      referral: { create: vi.fn().mockResolvedValue({ id: 'rf1' }) },
    } as any
  }
  it('crea Referral pending cuando el ref es válido y no es self', async () => {
    const t = tx({ id: 'ref1', businessId: 'b1', phone: '111' })
    await captureReferral(t, { businessId: 'b1', referredCustomerId: 'c2',
      referrerToken: 'tok', referredPhone: '222' })
    expect(t.referral.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ referrerCustomerId: 'ref1', referredCustomerId: 'c2', status: 'pending' }) }))
  })
  it('no crea si el token no resuelve a una referidora', async () => {
    const t = tx(null)
    await captureReferral(t, { businessId: 'b1', referredCustomerId: 'c2', referrerToken: 'x', referredPhone: '222' })
    expect(t.referral.create).not.toHaveBeenCalled()
  })
  it('no crea self-referral (mismo teléfono)', async () => {
    const t = tx({ id: 'ref1', businessId: 'b1', phone: '222' })
    await captureReferral(t, { businessId: 'b1', referredCustomerId: 'c2', referrerToken: 'tok', referredPhone: '222' })
    expect(t.referral.create).not.toHaveBeenCalled()
  })
})

describe('rewardReferralOnCompletion', () => {
  it('flip pending->rewarded y emite a ambas si beneficiary both', async () => {
    const emit = vi.fn().mockResolvedValue({ kind: 'points', points: 50, ledgerId: 'l' })
    const t = {
      referral: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findFirst: vi.fn().mockResolvedValue({ referrerCustomerId: 'ref1', referredCustomerId: 'c2' }),
      },
    } as any
    const rule = { id: 'r', businessId: 'b1', conditions: { kind: 'referral', beneficiary: 'both' },
      rewardPoints: 50, rewardType: null, rewardValue: 0, appliesToAll: true, grantExpiryDays: null, services: [] }
    await rewardReferralOnCompletion(t, { businessId: 'b1', referredCustomerId: 'c2', bookingId: 'bk',
      rule: rule as any, config: { grantExpiryDays: null, forfeitGrantOnNoShow: false }, now: new Date(), emit })
    expect(t.referral.updateMany).toHaveBeenCalled()
    expect(emit).toHaveBeenCalledTimes(2) // referida + referidora
  })
  it('no emite si no había referral pendiente (count 0)', async () => {
    const emit = vi.fn()
    const t = { referral: { updateMany: vi.fn().mockResolvedValue({ count: 0 }), findFirst: vi.fn() } } as any
    await rewardReferralOnCompletion(t, { businessId: 'b1', referredCustomerId: 'c2', bookingId: 'bk',
      rule: {} as any, config: { grantExpiryDays: null, forfeitGrantOnNoShow: false }, now: new Date(), emit })
    expect(emit).not.toHaveBeenCalled()
  })
})
