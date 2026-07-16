import { describe, it, expect, vi, beforeEach } from 'vitest'

const linkMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/customers/link', () => ({ linkCustomerFromBookingSession: linkMock }))

const { findOrCreateCustomerInTx } = await import('@/lib/customers/find-or-create')

function makeTx(existing: any) {
  return {
    customer: {
      findFirst: vi.fn().mockResolvedValue(existing),
      create: vi.fn().mockImplementation(({ data }: any) => Promise.resolve({ id: 'new', userId: null, ...data })),
      update: vi.fn().mockResolvedValue({}),
    },
  } as any
}

describe('findOrCreateCustomerInTx', () => {
  beforeEach(() => linkMock.mockReset().mockResolvedValue(false))

  it('crea la Customer cuando no hay match por teléfono', async () => {
    const tx = makeTx(null)
    const { customer, created } = await findOrCreateCustomerInTx(tx, {
      businessId: 'b1', phone: '9 1234 5678', name: 'Ana', email: 'ana@x.cl',
    })
    expect(created).toBe(true)
    expect(tx.customer.create).toHaveBeenCalledWith({
      data: { businessId: 'b1', name: 'Ana', phone: '56912345678', email: 'ana@x.cl', birthDate: null },
    })
    expect(customer.id).toBe('new')
  })

  it('reusa la Customer existente y backfillea email vacío', async () => {
    const tx = makeTx({ id: 'c1', userId: null, email: null, name: 'Ana', phone: '56912345678' })
    const { customer, created } = await findOrCreateCustomerInTx(tx, {
      businessId: 'b1', phone: '56912345678', name: 'Ana', email: 'ana@x.cl',
    })
    expect(created).toBe(false)
    expect(customer.id).toBe('c1')
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { email: 'ana@x.cl' } })
  })

  it('NO pisa un email existente', async () => {
    const tx = makeTx({ id: 'c1', userId: null, email: 'old@x.cl', name: 'Ana', phone: '56912345678' })
    await findOrCreateCustomerInTx(tx, { businessId: 'b1', phone: '56912345678', name: 'Ana', email: 'new@x.cl' })
    expect(tx.customer.update).not.toHaveBeenCalled()
  })

  it('llama a linkCustomerFromBookingSession cuando hay sesión', async () => {
    const tx = makeTx(null)
    const sessionUser = { id: 'u1', email: 'ana@x.cl', email_confirmed_at: '2026-01-01' }
    await findOrCreateCustomerInTx(tx, { businessId: 'b1', phone: '56912345678', name: 'Ana', email: 'ana@x.cl', sessionUser })
    expect(linkMock).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 'new' }), sessionUser, 'b1')
  })

  it('no linkea si no hay sesión', async () => {
    const tx = makeTx(null)
    await findOrCreateCustomerInTx(tx, { businessId: 'b1', phone: '56912345678', name: 'Ana', email: 'ana@x.cl' })
    expect(linkMock).not.toHaveBeenCalled()
  })

  it('backfillea email vacío y LUEGO linkea la sesión en el mismo match', async () => {
    const tx = makeTx({ id: 'c1', userId: null, email: null, name: 'Ana', phone: '56912345678' })
    const sessionUser = { id: 'u1', email: 'ana@x.cl', email_confirmed_at: '2026-01-01' }
    await findOrCreateCustomerInTx(tx, { businessId: 'b1', phone: '56912345678', name: 'Ana', email: 'ana@x.cl', sessionUser })
    expect(tx.customer.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { email: 'ana@x.cl' } })
    // el link recibe la Customer YA con email backfilleado (email no-null) → habilita vía 3
    expect(linkMock).toHaveBeenCalledWith(tx, expect.objectContaining({ id: 'c1', email: 'ana@x.cl' }), sessionUser, 'b1')
  })
})
