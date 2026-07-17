'use server'

import type { Prisma, PromotionGrant } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { formatInTimeZone } from 'date-fns-tz'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { createCampaignSchema, type CampaignRewardInput } from '@/lib/campaigns/schema'
import { queryCampaignSegment } from '@/lib/campaigns/segments'
import { renderCampaignMessage } from '@/lib/campaigns/message'
import { mintCampaignGrant } from '@/lib/campaigns/mint'
import { isP2002 } from '@/lib/loyalty/credit'
import { buildWhatsappUrl } from '@/lib/notifications/whatsapp'
import { isWhatsappablePhone } from '@/lib/customers/phone'

// NOTE: 'use server' — SOLO funciones async exportadas. Schemas/consts/tipos
// viven en src/lib/campaigns/.

/** Promos elegibles para campaña: todas las granted activas del negocio
 *  (catálogo de canje + creadas por campañas). */
export async function listCampaignPromotions() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.promotion.findMany({
    where: { businessId, triggerType: 'granted', isActive: true },
    orderBy: { createdAt: 'desc' },
    select: { id: true, name: true },
  })
}

/** Crea una promo granted inline para la campaña (pointsCost null = no canjeable
 *  por puntos; sólo minteable vía grant). Module-local, no exportada. Corre dentro
 *  de la tx de createCampaign para no dejar promos huérfanas si el create falla. */
async function createInlineGrantedPromotion(
  tx: Prisma.TransactionClient, businessId: string, userId: string, r: CampaignRewardInput,
): Promise<string> {
  if (r.serviceIds.length) {
    const count = await tx.service.count({ where: { id: { in: r.serviceIds }, businessId } })
    if (count !== r.serviceIds.length) throw new Error('Servicio inválido')
  }
  const promo = await tx.promotion.create({
    data: {
      businessId, triggerType: 'granted', pointsCost: null,
      name: r.name, rewardType: r.rewardType, rewardValue: r.rewardValue, maxDiscount: r.maxDiscount,
      appliesToAll: r.appliesToAll, grantExpiryDays: r.grantExpiryDays, createdByUserId: userId,
      services: r.appliesToAll ? undefined : { connect: r.serviceIds.map((id) => ({ id })) },
    },
    select: { id: true },
  })
  return promo.id
}

export async function createCampaign(data: unknown): Promise<{ campaignId: string }> {
  const { businessId, user, business } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('create-campaign', 20, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const parsed = createCampaignSchema.safeParse(data)
  if (!parsed.success) throw new Error('Datos inválidos: ' + parsed.error.issues.map((i) => i.message).join(', '))
  const d = parsed.data

  // Promo de catálogo: verificación (read) fuera de la tx. Ownership + que sea granted.
  let catalogPromotionId: string | null = null
  if (!d.newPromotion) {
    const existing = await prisma.promotion.findFirst({
      where: { id: d.promotionId!, businessId, triggerType: 'granted' }, select: { id: true },
    })
    if (!existing) throw new ForbiddenError('Promo no encontrada')
    catalogPromotionId = existing.id
  }

  const tz = business.timezone || 'America/Santiago'
  const segment = await queryCampaignSegment(prisma, businessId, d.segmentType, d.segmentParams ?? {}, new Date(), tz)

  // Promo inline + campaña en UNA tx: si el create de la campaña falla, no queda
  // una promo granted huérfana en el catálogo (patrón sellPackage en packages.ts).
  const campaign = await prisma.$transaction(async (tx) => {
    const promotionId = d.newPromotion
      ? await createInlineGrantedPromotion(tx, businessId, user.id, d.newPromotion)
      : catalogPromotionId!
    return tx.campaign.create({
      data: {
        businessId, name: d.name, segmentType: d.segmentType, segmentParams: d.segmentParams ?? undefined,
        promotionId, messageTemplate: d.messageTemplate, createdByUserId: user.id,
        recipients: { createMany: { data: segment.map((c) => ({ customerId: c.id })) } },
      },
      select: { id: true },
    })
  })
  revalidatePath('/dashboard/campanas')
  return { campaignId: campaign.id }
}

export async function getCampaigns() {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  return prisma.campaign.findMany({
    where: { businessId }, orderBy: { createdAt: 'desc' },
    select: {
      id: true, name: true, segmentType: true, createdAt: true,
      promotion: { select: { name: true } },
      _count: { select: { recipients: true } },
    },
  })
}

export async function getCampaignDetail(campaignId: string) {
  const { businessId } = await requireBusinessRole(['owner', 'admin'])
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, businessId },
    select: {
      id: true, name: true, segmentType: true, promotionId: true, createdAt: true,
      promotion: { select: { name: true, rewardType: true, rewardValue: true } },
      recipients: {
        orderBy: { customer: { name: 'asc' } },
        select: {
          id: true, customerId: true, sentAt: true,
          customer: { select: { name: true, phone: true } },
          grant: { select: { status: true, expiresAt: true } },
        },
      },
    },
  })
  if (!campaign) throw new ForbiddenError('Campaña no encontrada')
  return campaign
}

export async function sendCampaignMessage(recipientId: string): Promise<{ waUrl: string | null }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('send-campaign', 120, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  // Lecturas independientes en paralelo (recipient + config), patrón runRedemption.
  const [recipient, config] = await Promise.all([
    prisma.campaignRecipient.findFirst({
      where: { id: recipientId, campaign: { businessId } },
      select: {
        id: true, sentAt: true,
        customer: { select: { id: true, name: true, phone: true, marketingOptOutAt: true } },
        campaign: {
          select: {
            id: true, messageTemplate: true,
            promotion: { select: { id: true, grantExpiryDays: true } },
            business: { select: { name: true, timezone: true } },
          },
        },
      },
    }),
    prisma.loyaltyConfig.findUnique({ where: { businessId }, select: { grantExpiryDays: true } }),
  ])
  if (!recipient) throw new ForbiddenError('Destinataria no encontrada')
  // Puerta 2 (retroactiva): la clienta pudo hacer opt-out DESPUÉS de que la
  // campaña materializó su lista. Bloquear antes de mintear: sin grant, sin sentAt.
  if (recipient.customer.marketingOptOutAt) {
    throw new Error('La clienta pidió no recibir campañas')
  }
  const tz = recipient.campaign.business.timezone || 'America/Santiago'
  const requestId = `campaign:${recipient.campaign.id}#${recipient.customer.id}`

  // Mint perezoso en tx chica, idempotente por (customerId, requestId). El P2002
  // de la carrera se captura FUERA de la tx y se re-lee el grant existente
  // (mismo patrón que runRedemption en actions/loyalty.ts).
  let grant: PromotionGrant | null = null
  try {
    grant = await prisma.$transaction((tx) =>
      mintCampaignGrant(tx, {
        businessId,
        promotion: { id: recipient.campaign.promotion.id, grantExpiryDays: recipient.campaign.promotion.grantExpiryDays },
        customerId: recipient.customer.id,
        requestId,
        config: { grantExpiryDays: config?.grantExpiryDays ?? null },
        createdByUserId: user.id,
      }),
    )
  } catch (e) {
    if (isP2002(e)) {
      grant = await prisma.promotionGrant.findUnique({
        where: { customerId_requestId: { customerId: recipient.customer.id, requestId } },
      })
    }
    if (!grant) throw e
  }
  if (!grant) throw new Error('No se pudo generar el beneficio')

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { grantId: grant.id, sentAt: recipient.sentAt ?? new Date() },
  })

  const firstName = recipient.customer.name?.split(' ')[0] || ''
  const vencimiento = grant.expiresAt ? formatInTimeZone(grant.expiresAt, tz, 'dd/MM/yyyy') : 'sin vencimiento'
  const message = renderCampaignMessage(recipient.campaign.messageTemplate, {
    nombre: firstName, codigo: grant.code, vencimiento, negocio: recipient.campaign.business.name,
  })

  const waUrl = isWhatsappablePhone(recipient.customer.phone) ? buildWhatsappUrl(recipient.customer.phone, message) : null
  return { waUrl }
}
