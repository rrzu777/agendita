import { describe, it, expect, vi } from 'vitest'
import { creditVisitPoints, reverseVisitPoints } from '@/lib/loyalty/credit'

function p2002() { const e: any = new Error('unique'); e.code = 'P2002'; return e }
const activeCfg = { isActive: true, pointsPerVisit: 10, spendPerPoint: 1000, minSpendToEarn: null }

function fakeTx(overrides: any = {}) {
  return {
    loyaltyLedger: {
      create: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn().mockResolvedValue(null),
      ...overrides,
    },
  } as any
}

describe('creditVisitPoints', () => {
  const args = { businessId: 'b1', customerId: 'c1', finalAmount: 16000, bookingId: 'bk1', config: activeCfg }

  it('inserta un asiento visit con el desglose en metadata', async () => {
    const tx = fakeTx()
    const r = await creditVisitPoints(tx, args)
    expect(r?.total).toBe(26)
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ businessId: 'b1', customerId: 'c1', bookingId: 'bk1', points: 26, reason: 'visit' }),
    }))
  })
  it('no hace nada si el programa está inactivo', async () => {
    const tx = fakeTx()
    expect(await creditVisitPoints(tx, { ...args, config: { ...activeCfg, isActive: false } })).toBeNull()
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('no hace nada si no hay customerId (walk-in)', async () => {
    const tx = fakeTx()
    expect(await creditVisitPoints(tx, { ...args, customerId: null as any })).toBeNull()
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('no inserta si total = 0', async () => {
    const tx = fakeTx()
    await creditVisitPoints(tx, { ...args, config: { ...activeCfg, pointsPerVisit: 0, spendPerPoint: null } })
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('es idempotente: P2002 en create se traga (no relanza)', async () => {
    const tx = fakeTx({ create: vi.fn().mockRejectedValue(p2002()) })
    await expect(creditVisitPoints(tx, args)).resolves.toBeNull()
  })
  it('config null => no-op', async () => {
    const tx = fakeTx()
    expect(await creditVisitPoints(tx, { ...args, config: null })).toBeNull()
  })
})

describe('reverseVisitPoints', () => {
  it('inserta el asiento negativo del visit original', async () => {
    const tx = fakeTx({ findUnique: vi.fn().mockResolvedValue({ id: 'led1', points: 26, businessId: 'b1', customerId: 'c1' }) })
    await reverseVisitPoints(tx, 'bk1')
    expect(tx.loyaltyLedger.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ bookingId: 'bk1', points: -26, reason: 'visit_reversal' }),
    }))
  })
  it('no-op si no había visit', async () => {
    const tx = fakeTx({ findUnique: vi.fn().mockResolvedValue(null) })
    await reverseVisitPoints(tx, 'bk1')
    expect(tx.loyaltyLedger.create).not.toHaveBeenCalled()
  })
  it('idempotente: P2002 en la reversa se traga', async () => {
    const tx = fakeTx({
      findUnique: vi.fn().mockResolvedValue({ id: 'led1', points: 26, businessId: 'b1', customerId: 'c1' }),
      create: vi.fn().mockRejectedValue(p2002()),
    })
    await expect(reverseVisitPoints(tx, 'bk1')).resolves.toBeUndefined()
  })
})
