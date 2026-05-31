import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPrisma = {
  user: { findUnique: vi.fn(), create: vi.fn() },
  businessUser: { findFirst: vi.fn() },
  plan: { findFirst: vi.fn() },
  $transaction: vi.fn(),
}

const mockSupabaseGetUser = vi.fn()
const mockSupabase = { auth: { getUser: mockSupabaseGetUser } }

vi.mock('@/lib/db', () => ({ prisma: mockPrisma }))
vi.mock('@/lib/auth/middleware', () => ({
  createClient: vi.fn(() => mockSupabase),
}))

function makeUser(id: string, email: string) {
  return { id, email, user_metadata: { name: 'Test User' }, app_metadata: {}, aud: 'authenticated', created_at: '2024-01-01', role: 'authenticated' }
}

describe('recoverBusiness', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.plan.findFirst.mockResolvedValue({ id: 'plan-beta', name: 'Beta gratis' })
  })

  function setupTransaction() {
    const tx = {
      business: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'biz-1' }),
      },
      businessUser: { create: vi.fn() },
      businessSubscription: { create: vi.fn() },
      availabilityRule: { createMany: vi.fn() },
    }
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => callback(tx))
    return tx
  }

  it('creates business when user has none', async () => {
    mockSupabaseGetUser.mockResolvedValue({ data: { user: makeUser('user-1', 'a@a.com') }, error: null })
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@a.com', name: 'Test User' })
    mockPrisma.businessUser.findFirst.mockResolvedValue(null)

    const tx = setupTransaction()
    const { recoverBusiness } = await import('@/server/actions/recover-business')

    const result = await recoverBusiness()

    expect(result).toEqual({ success: true, redirectTo: '/dashboard/onboarding' })
    expect(tx.businessUser.create).toHaveBeenCalled()
    expect(tx.businessSubscription.create).toHaveBeenCalled()
    expect(tx.availabilityRule.createMany).toHaveBeenCalled()
  })

  it('returns alreadyExists when business exists', async () => {
    mockSupabaseGetUser.mockResolvedValue({ data: { user: makeUser('user-1', 'a@a.com') }, error: null })
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@a.com', name: 'Test User' })
    mockPrisma.businessUser.findFirst.mockResolvedValue({ userId: 'user-1', businessId: 'biz-1', role: 'owner', business: { id: 'biz-1' } })

    const { recoverBusiness } = await import('@/server/actions/recover-business')
    const result = await recoverBusiness()

    expect(result).toEqual({ success: true, alreadyExists: true, redirectTo: '/dashboard' })
  })

  it('returns error when no session', async () => {
    mockSupabaseGetUser.mockResolvedValue({ data: { user: null }, error: new Error('No session') })

    const { recoverBusiness } = await import('@/server/actions/recover-business')
    const result = await recoverBusiness()

    expect(result).toEqual({ success: false, error: 'No se encontró sesión activa. Inicia sesión de nuevo.', code: 'NO_SESSION' })
  })

  it('returns error when email conflict', async () => {
    mockSupabaseGetUser.mockResolvedValue({ data: { user: makeUser('user-9', 'taken@email.com') }, error: null })
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null) // find by id: not found
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ id: 'user-other', email: 'taken@email.com', name: 'Other' }) // find by email: different id
    mockPrisma.businessUser.findFirst.mockResolvedValue(null)

    const { recoverBusiness } = await import('@/server/actions/recover-business')
    const result = await recoverBusiness()

    expect(result).toEqual({
      success: false,
      error: 'Ya existe una cuenta con este email asociada a otro usuario. Contacta soporte.',
      code: 'EMAIL_ID_CONFLICT',
    })
  })

  it('returns error when plan missing', async () => {
    mockSupabaseGetUser.mockResolvedValue({ data: { user: makeUser('user-1', 'a@a.com') }, error: null })
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'a@a.com', name: 'Test User' })
    mockPrisma.businessUser.findFirst.mockResolvedValue(null)
    mockPrisma.plan.findFirst.mockResolvedValue(null)

    const { recoverBusiness } = await import('@/server/actions/recover-business')
    const result = await recoverBusiness()

    expect(result).toEqual({
      success: false,
      error: 'No se encontró el plan Beta gratis. Contacta soporte para configurar los planes.',
      code: 'MISSING_BETA_PLAN',
    })
  })
})
