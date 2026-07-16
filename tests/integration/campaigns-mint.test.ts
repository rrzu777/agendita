import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { requireTestDatabase } from './setup'
import { mintCampaignGrant } from '@/lib/campaigns/mint'

requireTestDatabase()

const BIZ = 'cmint-biz-1'
const OWNER_USER = 'cmint-owner-1'
const CUST = 'cmint-cust-1'
const PROMO = 'cmint-promo-1'

const DAY_MS = 86_400_000

describe('campaigns mintCampaignGrant', () => {
  let prisma: PrismaClient

  async function cleanup(db: PrismaClient) {
    await db.promotionGrant.deleteMany({ where: { businessId: BIZ } })
    await db.promotion.deleteMany({ where: { businessId: BIZ } })
    await db.customer.deleteMany({ where: { businessId: BIZ } })
    await db.businessUser.deleteMany({ where: { businessId: BIZ } })
    await db.business.deleteMany({ where: { id: BIZ } })
    await db.user.deleteMany({ where: { id: OWNER_USER } })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await cleanup(prisma)

    await prisma.user.create({ data: { id: OWNER_USER, email: 'owner@cmint.test', name: 'CMint Owner' } })
    await prisma.business.create({
      data: {
        id: BIZ, name: 'CMint Biz', slug: 'cmint-biz', subdomain: 'cmintbiz', ownerUserId: OWNER_USER,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
      },
    })
    await prisma.businessUser.create({ data: { id: 'cmint-bu-1', businessId: BIZ, userId: OWNER_USER, role: 'owner' } })
    await prisma.customer.create({
      data: { id: CUST, businessId: BIZ, name: 'Clienta Campaña', phone: '+56911330001' },
    })
    await prisma.promotion.create({
      data: {
        id: PROMO, businessId: BIZ, name: 'Campaña 20%', triggerType: 'granted',
        pointsCost: null, rewardType: 'percentage', rewardValue: 20,
        grantExpiryDays: 30, appliesToAll: true,
      },
    })
  })

  afterAll(async () => {
    await cleanup(prisma)
    await prisma.$disconnect()
  })

  it('mintea un grant gratis con expiresAt y es idempotente', async () => {
    const requestId = `campaign:camp1#${CUST}`
    const g1 = await prisma.$transaction((tx) => mintCampaignGrant(tx, {
      businessId: BIZ, promotion: { id: PROMO, grantExpiryDays: 30 }, customerId: CUST,
      requestId, config: { grantExpiryDays: null }, createdByUserId: OWNER_USER, now: new Date(),
    }))
    expect(g1.pointsSpent).toBe(0)
    expect(g1.expiresAt).not.toBeNull()
    expect(g1.status).toBe('active')
    expect(g1.refundOnExpiry).toBe(false)
    expect(g1.forfeitOnNoShow).toBe(false)

    const g2 = await prisma.$transaction((tx) => mintCampaignGrant(tx, {
      businessId: BIZ, promotion: { id: PROMO, grantExpiryDays: 30 }, customerId: CUST,
      requestId, config: { grantExpiryDays: null }, createdByUserId: OWNER_USER, now: new Date(),
    }))
    expect(g2.id).toBe(g1.id) // idempotente

    const count = await prisma.promotionGrant.count({ where: { customerId: CUST, requestId } })
    expect(count).toBe(1)
  })

  it('sin expiryDays no expira; con fallback al config expira a now+config', async () => {
    // Promo y config sin expiración → expiresAt null.
    const gNull = await prisma.$transaction((tx) => mintCampaignGrant(tx, {
      businessId: BIZ, promotion: { id: PROMO, grantExpiryDays: null }, customerId: CUST,
      requestId: `campaign:camp2#${CUST}`, config: { grantExpiryDays: null },
      createdByUserId: OWNER_USER, now: new Date(),
    }))
    expect(gNull.expiresAt).toBeNull()

    // Promo sin expiración pero config con 15 días → fallback al config.
    const now = new Date()
    const gConfig = await prisma.$transaction((tx) => mintCampaignGrant(tx, {
      businessId: BIZ, promotion: { id: PROMO, grantExpiryDays: null }, customerId: CUST,
      requestId: `campaign:camp3#${CUST}`, config: { grantExpiryDays: 15 },
      createdByUserId: OWNER_USER, now,
    }))
    expect(gConfig.expiresAt).not.toBeNull()
    expect(gConfig.expiresAt!.getTime()).toBe(now.getTime() + 15 * DAY_MS)
  })
})
