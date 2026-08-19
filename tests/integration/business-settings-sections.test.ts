import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const BIZ = 'settings-sections-biz'
const USER = 'settings-sections-user'
const prisma = new PrismaClient()

vi.mock('@/lib/auth/server', () => ({
  requireBusinessRole: async () => ({ businessId: BIZ, user: { id: USER }, role: 'owner' }),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/server/actions/revalidate-business', () => ({ revalidateBusinessPublicPaths: async () => {} }))

describe('section-scoped business settings updates', () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: USER, email: 'settings-sections@test.agendita.cl', name: 'Settings Owner' },
    })
    await prisma.business.create({
      data: {
        id: BIZ, ownerUserId: USER, name: 'Original', slug: 'settings-sections', subdomain: 'settings-sections',
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
      },
    })
    await prisma.businessUser.create({
      data: { id: 'settings-sections-bu', businessId: BIZ, userId: USER, role: 'owner' },
    })
  })

  afterAll(async () => {
    await prisma.businessUser.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  it('concurrent section updates preserve both sets of columns', async () => {
    const { updateProfileSettings, updatePolicySettings } = await import('@/server/actions/business-settings')
    const [profile, policy] = await Promise.all([
      updateProfileSettings({
        name: 'Perfil nuevo', bio: '', profileImageUrl: '', logoUrl: '', whatsapp: '',
        instagram: '', addressText: '', city: 'Santiago', subdomain: 'settings-sections',
      }),
      updatePolicySettings({
        selfServiceCutoffHours: 24, cancellationReminderEnabled: true,
        cancellationPolicy: '', bookingPolicy: 'Política nueva', depositPolicy: '',
      }),
    ])

    expect(profile.ok).toBe(true)
    expect(policy.ok).toBe(true)

    const row = await prisma.business.findUniqueOrThrow({ where: { id: BIZ } })
    expect(row.name).toBe('Perfil nuevo')
    expect(row.bookingPolicy).toBe('Política nueva')
    expect(row.timezone).toBe('America/Santiago')
  })
})
