import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import { requireTestDatabase } from './setup'

requireTestDatabase()

const authState = vi.hoisted(() => ({ businessId: '', userId: '' }))
vi.mock('@/lib/auth/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/server')>()
  return {
    ...actual,
    requireBusinessRole: vi.fn(async () => ({
      businessId: authState.businessId,
      user: { id: authState.userId },
      business: { timezone: 'America/Santiago' },
    })),
  }
})

const promoEmail = vi.hoisted(() => vi.fn(async () => ({ success: true, messageId: 'm1' })))
vi.mock('@/lib/notifications', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/notifications')>()
  return {
    ...actual,
    sendCampaignPromoEmail: promoEmail,
    getBusinessReplyToEmail: vi.fn(async () => null),
    sendNotificationSafely: async (_l: string, fn: () => Promise<unknown>) => fn(),
  }
})

import { prisma } from '@/lib/db'
import { sendCampaignEmailBatch } from '@/server/actions/campaigns'

let seq = 0
/** Crea negocio + promo granted + campaña con 3 clientas de email + 1 opt-out + 1 sin email. */
async function seedCampaign() {
  seq += 1
  const uniq = `${Date.now()}-${seq}`
  const user = await prisma.user.create({ data: { email: `u-${uniq}@x.com`, name: 'Owner' } })
  const business = await prisma.business.create({
    data: {
      name: 'Biz Bulk', slug: `biz-bulk-${uniq}`, subdomain: `bizbulk${seq}${Date.now()}`,
      ownerUserId: user.id, city: 'Santiago', timezone: 'America/Santiago',
    },
  })
  await prisma.businessUser.create({ data: { businessId: business.id, userId: user.id, role: 'owner' } })
  const promotion = await prisma.promotion.create({
    data: {
      businessId: business.id, triggerType: 'granted', pointsCost: null, name: 'Promo',
      rewardType: 'percentage', rewardValue: 20, appliesToAll: true, grantExpiryDays: 30, isActive: true,
    },
  })
  const specs = [
    { name: 'Emi Uno', email: 'e1@x.com', optedOut: false },
    { name: 'Emi Dos', email: 'e2@x.com', optedOut: false },
    { name: 'Emi Tres', email: 'e3@x.com', optedOut: false },
    { name: 'Opta Fuera', email: 'o@x.com', optedOut: true },
    { name: 'Sin Mail', email: null, optedOut: false },
  ]
  const recipientIds: string[] = []
  const campaign = await prisma.campaign.create({
    data: {
      businessId: business.id, name: 'C', segmentType: 'inactive', promotionId: promotion.id,
      messageTemplate: 'Hola {nombre}, código {codigo}',
    },
    select: { id: true },
  })
  for (const s of specs) {
    const customer = await prisma.customer.create({
      data: {
        businessId: business.id, name: s.name, phone: '1', email: s.email,
        marketingOptOutAt: s.optedOut ? new Date() : null,
      },
    })
    const rec = await prisma.campaignRecipient.create({
      data: { campaignId: campaign.id, customerId: customer.id }, select: { id: true },
    })
    recipientIds.push(rec.id)
  }
  authState.businessId = business.id
  authState.userId = user.id
  return { business, campaignId: campaign.id, recipientIds }
}

const created: string[] = []
afterAll(async () => {
  for (const id of created) {
    await prisma.campaignRecipient.deleteMany({ where: { campaign: { businessId: id } } })
    await prisma.campaign.deleteMany({ where: { businessId: id } })
    await prisma.promotionGrant.deleteMany({ where: { businessId: id } })
    await prisma.promotion.deleteMany({ where: { businessId: id } })
    await prisma.customer.deleteMany({ where: { businessId: id } })
    await prisma.businessUser.deleteMany({ where: { businessId: id } })
    const biz = await prisma.business.findUnique({ where: { id }, select: { ownerUserId: true } })
    await prisma.business.deleteMany({ where: { id } })
    if (biz) await prisma.user.deleteMany({ where: { id: biz.ownerUserId } })
  }
  await prisma.$disconnect()
})

describe('sendCampaignEmailBatch', () => {
  beforeEach(() => vi.clearAllMocks())

  it('drena una tanda mixta: envía 3, saltea opt-out y sin-email; re-run no reenvía', async () => {
    const { business, campaignId, recipientIds } = await seedCampaign()
    created.push(business.id)

    const { results } = await sendCampaignEmailBatch(campaignId, recipientIds)
    const sent = results.filter((r) => r.status === 'sent').length
    const skipped = results.filter((r) => r.status === 'skipped').length
    expect(sent).toBe(3)
    expect(skipped).toBe(2) // opt-out + sin-email
    expect(promoEmail).toHaveBeenCalledTimes(3)

    vi.clearAllMocks()
    const again = await sendCampaignEmailBatch(campaignId, recipientIds)
    expect(again.results.filter((r) => r.status === 'sent').length).toBe(0)
    expect(promoEmail).not.toHaveBeenCalled()
  })

  it('rechaza tandas más grandes que el máximo por llamada', async () => {
    const { business, campaignId } = await seedCampaign()
    created.push(business.id)
    const tooMany = Array.from({ length: 26 }, (_, i) => `x${i}`)
    await expect(sendCampaignEmailBatch(campaignId, tooMany)).rejects.toThrow('tanda')
  })
})
