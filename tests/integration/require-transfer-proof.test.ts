import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

// Mockeamos las capas de infraestructura (auth, rate limit, revalidate) para
// ejercitar la LÓGICA REAL de la action contra un Postgres real — mismo
// approach que bank-transfer-settings.test.ts.
const BIZ = 'rtp-biz-1'
const USER = 'rtp-user-1'
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => ({ businessId: BIZ, user: { id: USER } }),
  requireBusinessRole: async () => ({ businessId: BIZ, user: { id: USER } }),
  ForbiddenError: class extends Error {},
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => ({ success: true, remaining: 30, resetAt: 0 }) }))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

describe('setRequireTransferProof action', () => {
  let prisma: PrismaClient

  beforeAll(async () => {
    prisma = new PrismaClient()
    await prisma.user.create({ data: { id: USER, email: 'rtp@t.test', name: 'RTP Owner' } })
    await prisma.business.create({
      data: {
        id: BIZ, name: 'RTP Biz', slug: 'rtp-biz', subdomain: 'rtpbiz', ownerUserId: USER,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
      },
    })
    await prisma.businessUser.create({ data: { id: 'rtp-bu-1', businessId: BIZ, userId: USER, role: 'owner' } })
  })

  afterAll(async () => {
    await prisma.businessUser.deleteMany({ where: { businessId: BIZ } })
    await prisma.business.deleteMany({ where: { id: BIZ } })
    await prisma.user.deleteMany({ where: { id: USER } })
    await prisma.$disconnect()
  })

  it('persiste requireTransferProof=true y luego false', async () => {
    const { setRequireTransferProof } = await import('@/server/actions/bank-transfer-settings')

    const res1 = await setRequireTransferProof(true)
    expect(res1.ok).toBe(true)
    let row = await prisma.business.findUnique({ where: { id: BIZ } })
    expect(row!.requireTransferProof).toBe(true)

    const res2 = await setRequireTransferProof(false)
    expect(res2.ok).toBe(true)
    row = await prisma.business.findUnique({ where: { id: BIZ } })
    expect(row!.requireTransferProof).toBe(false)
  })
})
