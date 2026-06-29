import { describe, it, expect, vi } from 'vitest'
import { ensureLoyaltyToken } from '@/lib/loyalty/token'

describe('ensureLoyaltyToken', () => {
  it('devuelve el token existente sin escribir', async () => {
    const db = { customer: { update: vi.fn() } } as any
    expect(await ensureLoyaltyToken(db, { id: 'c1', loyaltyToken: 'tok-existente' })).toBe('tok-existente')
    expect(db.customer.update).not.toHaveBeenCalled()
  })
  it('genera y persiste uno nuevo si falta', async () => {
    const db = { customer: { update: vi.fn().mockResolvedValue({}) } } as any
    const tok = await ensureLoyaltyToken(db, { id: 'c1', loyaltyToken: null })
    expect(typeof tok).toBe('string')
    expect(tok.length).toBeGreaterThan(10)
    expect(db.customer.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { loyaltyToken: tok } })
  })
})
