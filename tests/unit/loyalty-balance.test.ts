import { describe, it, expect, vi } from 'vitest'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'

function fakeDb() {
  return {
    loyaltyLedger: {
      aggregate: vi.fn().mockResolvedValue({ _sum: { points: 140 } }),
      findMany: vi.fn().mockResolvedValue([{ id: 'l1', points: 10, reason: 'visit' }]),
    },
  } as any
}

describe('getLoyaltyBalance', () => {
  it('devuelve la suma de points', async () => {
    const db = fakeDb()
    expect(await getLoyaltyBalance(db, 'cus1')).toBe(140)
    expect(db.loyaltyLedger.aggregate).toHaveBeenCalledWith({
      where: { customerId: 'cus1' }, _sum: { points: true },
    })
  })
  it('devuelve 0 cuando no hay asientos', async () => {
    const db = { loyaltyLedger: { aggregate: vi.fn().mockResolvedValue({ _sum: { points: null } }) } } as any
    expect(await getLoyaltyBalance(db, 'cus1')).toBe(0)
  })
})

describe('getLoyaltyHistory', () => {
  it('pide los últimos N desc', async () => {
    const db = fakeDb()
    await getLoyaltyHistory(db, 'cus1', 50)
    expect(db.loyaltyLedger.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { customerId: 'cus1' }, orderBy: { createdAt: 'desc' }, take: 50,
    }))
  })
})
