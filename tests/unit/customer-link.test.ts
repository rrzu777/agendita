import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isVerifiedEmail,
  linkCustomersByVerifiedEmail,
  linkCustomerByLoyaltyToken,
  linkCustomerFromBookingSession,
  CardLinkError,
} from '@/lib/customers/link'

function makeDb() {
  return {
    customer: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
    businessUser: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  }
}

const verifiedSession = { id: 'user-1', email: 'ana@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' }

describe('isVerifiedEmail', () => {
  it('true con email_confirmed_at', () => {
    expect(isVerifiedEmail({ email: 'a@b.c', email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe(true)
  })
  it('false sin email_confirmed_at — user_metadata.email_verified NO cuenta (escribible por el usuario)', () => {
    expect(isVerifiedEmail({ email: 'a@b.c', email_confirmed_at: null, user_metadata: { email_verified: true } } as never)).toBe(false)
  })
  it('false sin email', () => {
    expect(isVerifiedEmail({ email: null, email_confirmed_at: '2026-01-01T00:00:00Z' })).toBe(false)
  })
})

describe('linkCustomersByVerifiedEmail', () => {
  let db: ReturnType<typeof makeDb>
  beforeEach(() => {
    db = makeDb()
    db.businessUser.findMany.mockResolvedValue([])
  })

  it('matches trimmed + case-insensitive y solo Customer sin userId', async () => {
    db.customer.updateMany.mockResolvedValue({ count: 2 })
    const count = await linkCustomersByVerifiedEmail(db as never, 'user-1', '  Ana@Example.com ')
    expect(count).toBe(2)
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { email: { equals: 'Ana@Example.com', mode: 'insensitive' }, userId: null },
      data: { userId: 'user-1' },
    })
  })

  it('excluye negocios donde el user es miembro (owner/staff no reclaman clientas propias)', async () => {
    db.businessUser.findMany.mockResolvedValue([{ businessId: 'b-mio' }])
    db.customer.updateMany.mockResolvedValue({ count: 1 })
    await linkCustomersByVerifiedEmail(db as never, 'user-1', 'ana@example.com')
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: {
        email: { equals: 'ana@example.com', mode: 'insensitive' },
        userId: null,
        businessId: { notIn: ['b-mio'] },
      },
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
  beforeEach(() => {
    db = makeDb()
    db.businessUser.findFirst.mockResolvedValue(null)
  })

  it('vincula un Customer sin dueño (update atómico where userId null)', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: null, businessId: 'b1' })
    db.customer.updateMany.mockResolvedValue({ count: 1 })
    await linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', userId: null },
      data: { userId: 'user-1' },
    })
  })

  it('es no-op si ya está vinculado a la misma cuenta', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: 'user-1', businessId: 'b1' })
    await linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')
    expect(db.customer.updateMany).not.toHaveBeenCalled()
  })

  it('CardLinkError si está vinculado a otra cuenta', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: 'user-2', businessId: 'b1' })
    await expect(linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')).rejects.toBeInstanceOf(CardLinkError)
  })

  it('CardLinkError si el token no existe', async () => {
    db.customer.findUnique.mockResolvedValue(null)
    await expect(linkCustomerByLoyaltyToken(db as never, 'user-1', 'nope')).rejects.toBeInstanceOf(CardLinkError)
  })

  it('CardLinkError si el user es miembro del negocio (la dueña tiene todos los tokens)', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: null, businessId: 'b1' })
    db.businessUser.findFirst.mockResolvedValue({ id: 'bu1' })
    await expect(linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')).rejects.toBeInstanceOf(CardLinkError)
    expect(db.customer.updateMany).not.toHaveBeenCalled()
  })

  it('CardLinkError si otro ganó la carrera (updateMany count 0)', async () => {
    db.customer.findUnique.mockResolvedValue({ id: 'c1', userId: null, businessId: 'b1' })
    db.customer.updateMany.mockResolvedValue({ count: 0 })
    await expect(linkCustomerByLoyaltyToken(db as never, 'user-1', 'tok')).rejects.toBeInstanceOf(CardLinkError)
  })
})

describe('linkCustomerFromBookingSession', () => {
  let db: ReturnType<typeof makeDb>
  beforeEach(() => { db = makeDb() })

  it('no-op si el customer ya tiene dueño (sin queries)', async () => {
    const linked = await linkCustomerFromBookingSession(
      db as never, { id: 'c1', userId: 'other', email: 'ana@example.com' }, verifiedSession, 'b1',
    )
    expect(linked).toBe(false)
    expect(db.businessUser.findFirst).not.toHaveBeenCalled()
    expect(db.customer.updateMany).not.toHaveBeenCalled()
  })

  it('no vincula si el email de la fila no coincide con el de la sesión (reserva con teléfono ajeno)', async () => {
    const linked = await linkCustomerFromBookingSession(
      db as never, { id: 'c1', userId: null, email: 'amiga@example.com' }, verifiedSession, 'b1',
    )
    expect(linked).toBe(false)
    expect(db.businessUser.findFirst).not.toHaveBeenCalled()
  })

  it('no vincula si la sesión no tiene email verificado', async () => {
    const linked = await linkCustomerFromBookingSession(
      db as never, { id: 'c1', userId: null, email: 'ana@example.com' },
      { id: 'user-1', email: 'ana@example.com', email_confirmed_at: null }, 'b1',
    )
    expect(linked).toBe(false)
  })

  it('no vincula a miembros del negocio', async () => {
    db.businessUser.findFirst.mockResolvedValue({ id: 'bu1' })
    db.user.findUnique.mockResolvedValue({ id: 'user-1' })
    const linked = await linkCustomerFromBookingSession(
      db as never, { id: 'c1', userId: null, email: 'ana@example.com' }, verifiedSession, 'b1',
    )
    expect(linked).toBe(false)
    expect(db.customer.updateMany).not.toHaveBeenCalled()
  })

  it('no vincula si la fila User de Prisma no existe', async () => {
    db.businessUser.findFirst.mockResolvedValue(null)
    db.user.findUnique.mockResolvedValue(null)
    const linked = await linkCustomerFromBookingSession(
      db as never, { id: 'c1', userId: null, email: 'ana@example.com' }, verifiedSession, 'b1',
    )
    expect(linked).toBe(false)
    expect(db.customer.updateMany).not.toHaveBeenCalled()
  })

  it('vincula con emails coincidentes (case/trim-insensitive) y update atómico', async () => {
    db.businessUser.findFirst.mockResolvedValue(null)
    db.user.findUnique.mockResolvedValue({ id: 'user-1' })
    db.customer.updateMany.mockResolvedValue({ count: 1 })
    const linked = await linkCustomerFromBookingSession(
      db as never, { id: 'c1', userId: null, email: ' Ana@Example.com ' }, verifiedSession, 'b1',
    )
    expect(linked).toBe(true)
    expect(db.customer.updateMany).toHaveBeenCalledWith({
      where: { id: 'c1', userId: null },
      data: { userId: 'user-1' },
    })
  })
})
