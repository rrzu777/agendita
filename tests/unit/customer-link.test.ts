import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isVerifiedEmail,
  linkCustomersByVerifiedEmail,
  linkCustomerByLoyaltyToken,
  CardLinkError,
} from '@/lib/customers/link'

function makeDb() {
  return {
    customer: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  }
}

describe('isVerifiedEmail', () => {
  it('true con user_metadata.email_verified', () => {
    expect(isVerifiedEmail({ email: 'a@b.c', user_metadata: { email_verified: true }, email_confirmed_at: null })).toBe(true)
  })
  it('true con email_confirmed_at', () => {
    expect(isVerifiedEmail({ email: 'a@b.c', user_metadata: {}, email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe(true)
  })
  it('false sin verificación o sin email', () => {
    expect(isVerifiedEmail({ email: 'a@b.c', user_metadata: {}, email_confirmed_at: null })).toBe(false)
    expect(isVerifiedEmail({ email: null, user_metadata: { email_verified: true }, email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe(false)
  })
})

describe('linkCustomersByVerifiedEmail', () => {
  let db: ReturnType<typeof makeDb>
  beforeEach(() => { db = makeDb() })

  it('matches trimmed + case-insensitive y solo Customer sin userId', async () => {
    db.customer.updateMany.mockResolvedValue({ count: 2 })
    const count = await linkCustomersByVerifiedEmail(db as never, 'user-1', '  Ana@Example.com ')
    expect(count).toBe(2)
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { email: { equals: 'Ana@Example.com', mode: 'insensitive' }, userId: null },
      data: { userId: 'user-1' },
    })
  })

  it('no hace nada con email vacío', async () => {
    const count = await linkCustomersByVerifiedEmail(db as never, 'user-1', '   ')
    expect(count).toBe(0)
    expect(db.customer.updateMany).not.toHaveBeenCalled()
  })
})

describe('linkCustomerByLoyaltyToken', () => {
  let db: ReturnType<typeof makeDb>
  beforeEach(() => { db = makeDb() })

  it('vincula un Customer sin dueño (update atómico where userId null)', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: null })
    db.customer.updateMany.mockResolvedValue({ count: 1 })
    await linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', userId: null },
      data: { userId: 'user-1' },
    })
  })

  it('es no-op si ya está vinculado a la misma cuenta', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: 'user-1' })
    await linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')
    expect(db.customer.updateMany).not.toHaveBeenCalled()
  })

  it('CardLinkError si está vinculado a otra cuenta', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: 'user-2' })
    await expect(linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')).rejects.toBeInstanceOf(CardLinkError)
  })

  it('CardLinkError si el token no existe', async () => {
    db.customer.findUnique.mockResolvedValue(null)
    await expect(linkCustomerByLoyaltyToken(db as never, 'user-1', 'nope')).rejects.toBeInstanceOf(CardLinkError)
  })

  it('CardLinkError si otro ganó la carrera (updateMany count 0)', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: null })
    db.customer.updateMany.mockResolvedValue({ count: 0 })
    await expect(linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')).rejects.toBeInstanceOf(CardLinkError)
  })
})
