import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

// Mockeamos auth + revalidate para ejercitar la lógica REAL de las actions
// contra un Postgres real (mismo approach que campaigns-actions.test.ts).
// importOriginal conserva ForbiddenError/AuthError reales (instanceof).
const BIZ = 'mopt-biz-1'
const USER = 'mopt-owner-1'
const CLIENTA_USER = 'mopt-user-clienta'
const authCtx = () => ({
  businessId: BIZ,
  user: { id: USER },
  business: { id: BIZ, name: 'MOpt Biz', timezone: 'America/Santiago' },
  role: 'owner',
})
vi.mock('@/lib/auth/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/server')>()
  return {
    ...actual,
    requireBusiness: async () => authCtx(),
    requireBusinessRole: async () => authCtx(),
    requireUser: async () => ({ id: CLIENTA_USER }),
  }
})
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const CUST = 'mopt-cust-1'
const CUST_LINKED = 'mopt-cust-linked'
const CUST_AJENA = 'mopt-cust-ajena'
const BIZ2 = 'mopt-biz-2'
const USER2 = 'mopt-owner-2'
const TOKEN = 'mopt-token-0000-0000'

describe('marketing opt-out actions', () => {
  let prisma: PrismaClient

  async function cleanup(db: PrismaClient) {
    await db.customer.deleteMany({ where: { businessId: { in: [BIZ, BIZ2] } } })
    await db.businessUser.deleteMany({ where: { businessId: { in: [BIZ, BIZ2] } } })
    await db.business.deleteMany({ where: { id: { in: [BIZ, BIZ2] } } })
    await db.user.deleteMany({ where: { id: { in: [USER, USER2, CLIENTA_USER] } } })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await cleanup(prisma)
    await prisma.user.create({ data: { id: USER, email: 'owner@mopt.test', name: 'MOpt Owner' } })
    await prisma.user.create({ data: { id: USER2, email: 'owner2@mopt.test', name: 'MOpt Owner 2' } })
    await prisma.user.create({ data: { id: CLIENTA_USER, email: 'clienta@mopt.test', name: 'MOpt Clienta' } })
    await prisma.business.create({
      data: { id: BIZ, name: 'MOpt Biz', slug: 'mopt-biz', subdomain: 'moptbiz', ownerUserId: USER,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90 },
    })
    await prisma.business.create({
      data: { id: BIZ2, name: 'MOpt Biz 2', slug: 'mopt-biz-2', subdomain: 'moptbiz2', ownerUserId: USER2,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90 },
    })
    await prisma.businessUser.create({ data: { id: 'mopt-bu-1', businessId: BIZ, userId: USER, role: 'owner' } })
    await prisma.businessUser.create({ data: { id: 'mopt-bu-2', businessId: BIZ2, userId: USER2, role: 'owner' } })
    await prisma.customer.create({
      data: { id: CUST, businessId: BIZ, name: 'Con Token', phone: '+56911550001', loyaltyToken: TOKEN },
    })
    await prisma.customer.create({
      data: { id: CUST_LINKED, businessId: BIZ, name: 'Vinculada', phone: '+56911550002', userId: CLIENTA_USER },
    })
    await prisma.customer.create({
      data: { id: CUST_AJENA, businessId: BIZ2, name: 'De Otro Negocio', phone: '+56911550003' },
    })
  })

  afterAll(async () => {
    await cleanup(prisma)
    await prisma.$disconnect()
  })

  it('setCustomerMarketingOptOut marca y desmarca (dueña)', async () => {
    const { setCustomerMarketingOptOut } = await import('@/server/actions/customers')
    await setCustomerMarketingOptOut(CUST, true)
    let c = await prisma.customer.findUnique({ where: { id: CUST } })
    expect(c?.marketingOptOutAt).toBeInstanceOf(Date)
    await setCustomerMarketingOptOut(CUST, false)
    c = await prisma.customer.findUnique({ where: { id: CUST } })
    expect(c?.marketingOptOutAt).toBeNull()
  })

  it('setCustomerMarketingOptOut rechaza clientas de otro negocio', async () => {
    const { setCustomerMarketingOptOut } = await import('@/server/actions/customers')
    await expect(setCustomerMarketingOptOut(CUST_AJENA, true)).rejects.toThrow()
    const c = await prisma.customer.findUnique({ where: { id: CUST_AJENA } })
    expect(c?.marketingOptOutAt).toBeNull()
  })

  it('setMarketingOptOutByToken marca y desmarca; token inválido falla', async () => {
    const { setMarketingOptOutByToken } = await import('@/server/actions/marketing-optout')
    await setMarketingOptOutByToken(TOKEN, true)
    let c = await prisma.customer.findUnique({ where: { id: CUST } })
    expect(c?.marketingOptOutAt).toBeInstanceOf(Date)
    await setMarketingOptOutByToken(TOKEN, false)
    c = await prisma.customer.findUnique({ where: { id: CUST } })
    expect(c?.marketingOptOutAt).toBeNull()
    await expect(setMarketingOptOutByToken('token-que-no-existe', true)).rejects.toThrow()
  })

  it('setMarketingOptOutAsMe exige que el Customer pertenezca a la sesión', async () => {
    const { setMarketingOptOutAsMe } = await import('@/server/actions/marketing-optout')
    await setMarketingOptOutAsMe(CUST_LINKED, true)
    const c = await prisma.customer.findUnique({ where: { id: CUST_LINKED } })
    expect(c?.marketingOptOutAt).toBeInstanceOf(Date)
    // CUST no está vinculado a CLIENTA_USER → Forbidden.
    await expect(setMarketingOptOutAsMe(CUST, true)).rejects.toThrow()
  })
})
