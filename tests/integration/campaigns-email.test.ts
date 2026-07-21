import { describe, expect, it, vi, beforeEach, afterAll } from 'vitest'
import { requireTestDatabase } from './setup'
import { expectActionError } from './helpers/action-result'

requireTestDatabase()

// Auth: forzamos owner de un negocio conocido (fijado por seed()).
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

// Provider de email: capturamos y controlamos éxito/fallo.
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
import { sendCampaignEmail } from '@/server/actions/campaigns'

let seq = 0
// Helpers de seed: crea negocio + promo granted + campaña + recipient con email.
async function seed(opts: { optedOut?: boolean; email?: string | null; promoActive?: boolean }) {
  seq += 1
  const uniq = `${Date.now()}-${seq}`
  const user = await prisma.user.create({ data: { email: `u-${uniq}@x.com`, name: 'Owner' } })
  const business = await prisma.business.create({
    data: {
      name: 'Biz Email', slug: `biz-email-${uniq}`, subdomain: `bizemail${seq}${Date.now()}`,
      ownerUserId: user.id, city: 'Santiago', timezone: 'America/Santiago',
    },
  })
  await prisma.businessUser.create({ data: { businessId: business.id, userId: user.id, role: 'owner' } })
  const promotion = await prisma.promotion.create({
    data: {
      businessId: business.id, triggerType: 'granted', pointsCost: null, name: 'Promo',
      rewardType: 'percentage', rewardValue: 20, appliesToAll: true, grantExpiryDays: 30,
      isActive: opts.promoActive === false ? false : true,
    },
  })
  const customer = await prisma.customer.create({
    data: {
      businessId: business.id, name: 'Ana Mail', phone: '1',
      email: opts.email === undefined ? 'anamail@example.com' : opts.email,
      marketingOptOutAt: opts.optedOut ? new Date() : null,
    },
  })
  const campaign = await prisma.campaign.create({
    data: {
      businessId: business.id, name: 'C', segmentType: 'inactive', promotionId: promotion.id,
      messageTemplate: 'Hola {nombre}, código {codigo}',
      recipients: { create: [{ customerId: customer.id }] },
    },
    include: { recipients: true },
  })
  authState.businessId = business.id
  authState.userId = user.id
  return { business, customer, campaign, recipientId: campaign.recipients[0].id }
}

const created: string[] = []
afterAll(async () => {
  // Limpieza best-effort por negocio.
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

describe('sendCampaignEmail', () => {
  beforeEach(() => vi.clearAllMocks())

  it('éxito: envía email, mintea grant y marca sentAt', async () => {
    const { business, recipientId } = await seed({})
    created.push(business.id)
    const res = await sendCampaignEmail(recipientId)
    if (!res.ok) throw new Error(res.error)
    expect(res.data.sent).toBe(true)
    expect(promoEmail).toHaveBeenCalledTimes(1)
    const r = await prisma.campaignRecipient.findUnique({ where: { id: recipientId } })
    expect(r?.sentAt).not.toBeNull()
    expect(r?.grantId).not.toBeNull()
  })

  it('fallo de envío: NO marca sentAt (grant persiste)', async () => {
    promoEmail.mockResolvedValueOnce({ success: false, error: 'boom' } as never)
    const { business, recipientId } = await seed({})
    created.push(business.id)
    const res = await sendCampaignEmail(recipientId)
    if (!res.ok) throw new Error(res.error)
    expect(res.data.sent).toBe(false)
    const r = await prisma.campaignRecipient.findUnique({ where: { id: recipientId } })
    expect(r?.sentAt).toBeNull()
    // el grant sí se minteó
    const grants = await prisma.promotionGrant.count({ where: { businessId: business.id } })
    expect(grants).toBe(1)
  })

  it('opt-out retroactivo: lanza y no envía', async () => {
    const { business, recipientId } = await seed({ optedOut: true })
    created.push(business.id)
    await expectActionError(sendCampaignEmail(recipientId), 'no recibir campañas')
    expect(promoEmail).not.toHaveBeenCalled()
  })

  it('sin email válido: devuelve sent:false sin llamar al provider', async () => {
    const { business, recipientId } = await seed({ email: null })
    created.push(business.id)
    const res = await sendCampaignEmail(recipientId)
    if (!res.ok) throw new Error(res.error)
    expect(res.data.sent).toBe(false)
    expect(promoEmail).not.toHaveBeenCalled()
  })

  it('promo pausada: lanza y no envía', async () => {
    const { business, recipientId } = await seed({ promoActive: false })
    created.push(business.id)
    await expectActionError(sendCampaignEmail(recipientId), 'pausada')
    expect(promoEmail).not.toHaveBeenCalled()
  })

  it('claim: dos envíos sobre la misma destinataria → un solo email', async () => {
    const { business, recipientId } = await seed({})
    created.push(business.id)
    const r1 = await sendCampaignEmail(recipientId)
    const r2 = await sendCampaignEmail(recipientId)
    if (!r1.ok) throw new Error(r1.error)
    if (!r2.ok) throw new Error(r2.error)
    expect(r1.data.sent).toBe(true)
    expect(r2.data.sent).toBe(false) // segundo: ya enviado, no reenvía
    expect(promoEmail).toHaveBeenCalledTimes(1)
  })
})
