import { PrismaClient } from '@prisma/client'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

// Mockeamos las capas de infraestructura (auth, revalidate) para ejercitar la
// LÓGICA REAL de las actions contra un Postgres real — mismo approach que
// require-transfer-proof.test.ts. Las actions se importan dinámicamente en los
// tests para que la factory del mock corra DESPUÉS de inicializar las consts.
const BIZ = 'cact-biz-1'
const USER = 'cact-owner-1'
vi.mock('@/lib/auth/server', () => ({
  requireBusiness: async () => ({ businessId: BIZ, user: { id: USER }, role: 'owner' }),
  requireBusinessRole: async () => ({ businessId: BIZ, user: { id: USER }, role: 'owner' }),
  AuthError: class extends Error {},
  ForbiddenError: class extends Error {},
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))

const SVC = 'cact-svc-1'
const CUST_A = 'cact-cust-a'
const CUST_B = 'cact-cust-b'
const PROMO = 'cact-promo-1'
const NOW = new Date()

async function importActions() {
  return import('@/server/actions/campaigns')
}

describe('campaigns actions', () => {
  let prisma: PrismaClient

  /** Franja horaria disjunta por índice (constraint EXCLUDE Booking_no_overlap):
   *  días distintos → nunca solapan. */
  function slot(index: number) {
    const start = new Date(NOW)
    start.setUTCDate(start.getUTCDate() + 30 + index)
    start.setUTCHours(15, 0, 0, 0)
    const end = new Date(start.getTime() + 60 * 60_000)
    return { startDateTime: start, endDateTime: end }
  }

  async function cleanup(db: PrismaClient) {
    await db.campaignRecipient.deleteMany({ where: { campaign: { businessId: BIZ } } })
    await db.campaign.deleteMany({ where: { businessId: BIZ } })
    await db.promotionGrant.deleteMany({ where: { businessId: BIZ } })
    await db.promotion.deleteMany({ where: { businessId: BIZ } })
    await db.booking.deleteMany({ where: { businessId: BIZ } })
    await db.service.deleteMany({ where: { businessId: BIZ } })
    await db.customer.deleteMany({ where: { businessId: BIZ } })
    await db.businessUser.deleteMany({ where: { businessId: BIZ } })
    await db.business.deleteMany({ where: { id: BIZ } })
    await db.user.deleteMany({ where: { id: USER } })
  }

  beforeAll(async () => {
    prisma = new PrismaClient()
    await cleanup(prisma)

    await prisma.user.create({ data: { id: USER, email: 'owner@cact.test', name: 'CAct Owner' } })
    await prisma.business.create({
      data: {
        id: BIZ, name: 'CAct Biz', slug: 'cact-biz', subdomain: 'cactbiz', ownerUserId: USER,
        city: 'Santiago', country: 'CL', currency: 'CLP', timezone: 'America/Santiago', bookingWindowDays: 90,
      },
    })
    await prisma.businessUser.create({ data: { id: 'cact-bu-1', businessId: BIZ, userId: USER, role: 'owner' } })
    await prisma.service.create({
      data: { id: SVC, businessId: BIZ, name: 'Corte', durationMinutes: 60, price: 20000, depositAmount: 5000, pastelColor: '#FFD700' },
    })
    await prisma.customer.create({
      data: { id: CUST_A, businessId: BIZ, name: 'Ana Campaña', phone: '+56911440001' },
    })
    await prisma.customer.create({
      data: { id: CUST_B, businessId: BIZ, name: 'Berta Campaña', phone: '+56911440002' },
    })
    // 1 completada por clienta, en días distintos (EXCLUDE Booking_no_overlap).
    for (const [i, cust] of [CUST_A, CUST_B].entries()) {
      await prisma.booking.create({
        data: {
          businessId: BIZ, serviceId: SVC, customerId: cust,
          ...slot(i),
          status: 'completed',
          totalPrice: 20000, depositRequired: 5000, depositPaid: 5000,
          remainingBalance: 0, discountAmount: 0, finalAmount: 20000,
          paymentStatus: 'fully_paid',
        },
      })
    }
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

  it('createCampaign materializa recipients del segmento', async () => {
    const { createCampaign, getCampaignDetail } = await importActions()
    const { campaignId } = await createCampaign({
      name: 'Frecuentes', segmentType: 'frequent', segmentParams: { frequentMin: 1 },
      messageTemplate: 'Hola {nombre} {codigo}', promotionId: PROMO,
    })
    const d = await getCampaignDetail(campaignId)
    expect(d.recipients.length).toBeGreaterThanOrEqual(2)
  })

  it('createCampaign con newPromotion crea granted pointsCost null', async () => {
    const { createCampaign, getCampaignDetail } = await importActions()
    const { campaignId } = await createCampaign({
      name: 'Inline', segmentType: 'frequent', segmentParams: { frequentMin: 1 },
      messageTemplate: 'Hola {nombre}',
      newPromotion: { name: '15%', rewardType: 'percentage', rewardValue: 15, appliesToAll: true, serviceIds: [] },
    })
    const d = await getCampaignDetail(campaignId)
    const promo = await prisma.promotion.findUnique({ where: { id: d.promotionId } })
    expect(promo?.triggerType).toBe('granted')
    expect(promo?.pointsCost).toBeNull()
  })

  it('sendCampaignMessage mintea grant idempotente + setea sentAt + devuelve waUrl', async () => {
    const { createCampaign, getCampaignDetail, sendCampaignMessage } = await importActions()
    const { campaignId } = await createCampaign({
      name: 'X', segmentType: 'frequent', segmentParams: { frequentMin: 1 },
      messageTemplate: 'Hola {nombre} {codigo}', promotionId: PROMO,
    })
    const d = await getCampaignDetail(campaignId)
    const rid = d.recipients[0].id
    const r1 = await sendCampaignMessage(rid)
    expect(r1.waUrl).toMatch(/wa\.me/)
    const r2 = await sendCampaignMessage(rid)
    expect(r2.waUrl).toMatch(/wa\.me/)
    const d2 = await getCampaignDetail(campaignId)
    const rec = d2.recipients.find((x) => x.id === rid)!
    expect(rec.sentAt).not.toBeNull()
    const grants = await prisma.promotionGrant.count({
      where: { customerId: rec.customerId, requestId: `campaign:${campaignId}#${rec.customerId}` },
    })
    expect(grants).toBe(1) // idempotente
  })

  it('listCampaignPromotions lista granted del negocio', async () => {
    const { listCampaignPromotions } = await importActions()
    const promos = await listCampaignPromotions()
    expect(promos.some((p) => p.id === PROMO)).toBe(true)
  })

  it('getCampaigns lista la campaña con counts', async () => {
    const { getCampaigns } = await importActions()
    const list = await getCampaigns()
    expect(list.length).toBeGreaterThanOrEqual(1)
    expect(list[0]._count.recipients).toBeGreaterThanOrEqual(0)
  })
})
