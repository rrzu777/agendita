'use server'

import type { Prisma } from '@prisma/client'
import { revalidatePath } from 'next/cache'
import { prisma } from '@/lib/db'
import { checkRateLimit } from '@/lib/rate-limit'
import { requireBusinessRole, ForbiddenError } from '@/lib/auth/server'
import { createCampaignSchema, type CampaignRewardInput } from '@/lib/campaigns/schema'
import { queryCampaignSegment } from '@/lib/campaigns/segments'
import { prepareCampaignSend } from '@/lib/campaigns/send'
import { buildWhatsappUrl } from '@/lib/notifications/whatsapp'
import { isWhatsappablePhone } from '@/lib/customers/phone'
import { isEmailable } from '@/lib/customers/email'
import { ensureLoyaltyToken } from '@/lib/loyalty/token'
import { getBusinessReplyToEmail, sendNotificationSafely, sendCampaignPromoEmail } from '@/lib/notifications'

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
          customer: { select: { name: true, phone: true, email: true, marketingOptOutAt: true } },
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

  const { recipient, grant, message } = await prepareCampaignSend(prisma, businessId, recipientId, user.id)

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { grantId: grant.id, sentAt: recipient.sentAt ?? new Date() },
  })

  const waUrl = isWhatsappablePhone(recipient.customer.phone)
    ? buildWhatsappUrl(recipient.customer.phone, message)
    : null
  return { waUrl }
}

/** Envío de campaña por email (canal alternativo a WhatsApp). Mintea el grant vía
 *  el mismo core idempotente, envía server-side vía Resend, y marca sentAt SÓLO si el
 *  envío fue exitoso (a diferencia de WhatsApp, acá conocemos el resultado). El grant
 *  minteado persiste aunque el email falle; reintentar es idempotente. */
export async function sendCampaignEmail(recipientId: string): Promise<{ sent: boolean; error?: string }> {
  const { businessId, user } = await requireBusinessRole(['owner', 'admin'])
  const limit = await checkRateLimit('send-campaign-email', 30, 60000, { userId: user.id, businessId })
  if (!limit.success) throw new Error('Demasiadas solicitudes. Intenta más tarde.')

  const { recipient, grant, message } = await prepareCampaignSend(prisma, businessId, recipientId, user.id)

  const email = recipient.customer.email
  if (!isEmailable(email)) return { sent: false, error: 'La clienta no tiene un email válido.' }

  // Independientes (token keyea por customer, replyTo por businessId): en paralelo.
  const [token, replyTo] = await Promise.all([
    ensureLoyaltyToken(prisma, recipient.customer),
    getBusinessReplyToEmail(businessId),
  ])
  const result = await sendNotificationSafely('campaign_email', () =>
    sendCampaignPromoEmail({
      to: email!,
      businessName: recipient.campaign.business.name,
      businessReplyToEmail: replyTo,
      message,
      unsubscribeToken: token,
    }))

  if (!result.success) {
    return { sent: false, error: result.error ?? result.skipped ?? 'No se pudo enviar el email' }
  }

  await prisma.campaignRecipient.update({
    where: { id: recipient.id },
    data: { grantId: grant.id, sentAt: recipient.sentAt ?? new Date() },
  })
  return { sent: true }
}
