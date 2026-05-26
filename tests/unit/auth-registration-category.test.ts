import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = {
  plan: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))

describe('createBusinessForUser category templates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.plan.findFirst.mockResolvedValue({ id: 'plan-beta', name: 'Beta gratis' })
  })

  function setupTransaction() {
    const tx = {
      user: { create: vi.fn() },
      business: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'biz-1' }),
      },
      businessUser: { create: vi.fn() },
      businessSubscription: { create: vi.fn() },
      service: { createMany: vi.fn() },
      availabilityRule: { createMany: vi.fn() },
    }
    mockPrisma.$transaction.mockImplementation(async (callback) => callback(tx))
    return tx
  }

  it('category other does not create services by default', async () => {
    const tx = setupTransaction()
    const { createBusinessForUser } = await import('@/lib/auth/actions')

    await createBusinessForUser({
      userId: 'user-1',
      email: 'owner@example.com',
      name: 'Centro Alma',
      subdomain: 'centroalma',
      category: 'other',
    })

    expect(tx.service.createMany).not.toHaveBeenCalled()
  })

  it('category nails without useServiceTemplate does not create services', async () => {
    const tx = setupTransaction()
    const { createBusinessForUser } = await import('@/lib/auth/actions')

    await createBusinessForUser({
      userId: 'user-1',
      email: 'owner@example.com',
      name: 'Studio Nano',
      subdomain: 'studionano',
      category: 'nails',
      useServiceTemplate: false,
    })

    expect(tx.service.createMany).not.toHaveBeenCalled()
  })

  it('category nails with useServiceTemplate creates services', async () => {
    const tx = setupTransaction()
    const { createBusinessForUser } = await import('@/lib/auth/actions')

    await createBusinessForUser({
      userId: 'user-1',
      email: 'owner@example.com',
      name: 'Studio Uno',
      subdomain: 'studiouno',
      category: 'nails',
      useServiceTemplate: true,
    })

    expect(tx.service.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ businessId: 'biz-1', name: 'Manicura rusa' }),
      ]),
    })
  })

  it('category barber with useServiceTemplate creates services', async () => {
    const tx = setupTransaction()
    const { createBusinessForUser } = await import('@/lib/auth/actions')

    await createBusinessForUser({
      userId: 'user-1',
      email: 'owner@example.com',
      name: 'Barbería Central',
      subdomain: 'barberiacentral',
      category: 'barber',
      useServiceTemplate: true,
    })

    expect(tx.service.createMany).toHaveBeenCalledWith({
      data: expect.arrayContaining([
        expect.objectContaining({ businessId: 'biz-1', name: 'Corte de cabello' }),
      ]),
    })
  })

  it('category other with useServiceTemplate does not create services', async () => {
    const tx = setupTransaction()
    const { createBusinessForUser } = await import('@/lib/auth/actions')

    await createBusinessForUser({
      userId: 'user-1',
      email: 'owner@example.com',
      name: 'Centro Generic',
      subdomain: 'centrogeneric',
      category: 'other',
      useServiceTemplate: true,
    })

    expect(tx.service.createMany).not.toHaveBeenCalled()
  })
})
