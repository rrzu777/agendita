import type { Prisma, PrismaClient, PromotionGrant } from '@prisma/client'
import { formatInTimeZone } from 'date-fns-tz'
import { mintCampaignGrant } from './mint'
import { renderCampaignMessage } from './message'
import { isP2002 } from '@/lib/loyalty/credit'
import { ForbiddenError } from '@/lib/auth/server'

type Db = PrismaClient

export interface PreparedCampaignSend {
  recipient: {
    id: string
    sentAt: Date | null
    customer: {
      id: string; name: string; phone: string; email: string | null
      loyaltyToken: string | null; marketingOptOutAt: Date | null
    }
    campaign: {
      id: string; name: string
      business: { name: string; timezone: string | null }
    }
  }
  grant: PromotionGrant
  message: string
}

/** Núcleo compartido de envío de campaña (WhatsApp y email). Lee la destinataria,
 *  aplica la puerta 2 de opt-out (retroactiva), mintea el grant de forma perezosa e
 *  idempotente (por customerId+requestId) y renderiza el mensaje. NO marca sentAt:
 *  eso lo decide cada canal según su resultado. */
export async function prepareCampaignSend(
  db: Db,
  businessId: string,
  recipientId: string,
  createdByUserId: string,
): Promise<PreparedCampaignSend> {
  const [recipient, config] = await Promise.all([
    db.campaignRecipient.findFirst({
      where: { id: recipientId, campaign: { businessId } },
      select: {
        id: true, sentAt: true,
        customer: {
          select: {
            id: true, name: true, phone: true, email: true,
            loyaltyToken: true, marketingOptOutAt: true,
          },
        },
        campaign: {
          select: {
            id: true, name: true, messageTemplate: true,
            promotion: { select: { id: true, grantExpiryDays: true, isActive: true } },
            business: { select: { name: true, timezone: true } },
          },
        },
      },
    }),
    db.loyaltyConfig.findUnique({ where: { businessId }, select: { grantExpiryDays: true } }),
  ])
  if (!recipient) throw new ForbiddenError('Destinataria no encontrada')
  // Puerta 2 (retroactiva): la clienta pudo hacer opt-out DESPUÉS de materializar la lista.
  if (recipient.customer.marketingOptOutAt) {
    throw new Error('La clienta pidió no recibir campañas')
  }
  // Gate de promo activa: si la promo se archivó entre crear la campaña y enviar,
  // cortar (fail-fast) en vez de emitir beneficios contra una promo apagada.
  // Vive en el core → aplica también al single-send.
  if (!recipient.campaign.promotion.isActive) {
    throw new Error('La promoción de esta campaña está pausada')
  }

  const tz = recipient.campaign.business.timezone || 'America/Santiago'
  const requestId = `campaign:${recipient.campaign.id}#${recipient.customer.id}`

  let grant: PromotionGrant | null = null
  try {
    grant = await db.$transaction((tx: Prisma.TransactionClient) =>
      mintCampaignGrant(tx, {
        businessId,
        promotion: {
          id: recipient.campaign.promotion.id,
          grantExpiryDays: recipient.campaign.promotion.grantExpiryDays,
        },
        customerId: recipient.customer.id,
        requestId,
        config: { grantExpiryDays: config?.grantExpiryDays ?? null },
        createdByUserId,
      }),
    )
  } catch (e) {
    if (isP2002(e)) {
      grant = await db.promotionGrant.findUnique({
        where: { customerId_requestId: { customerId: recipient.customer.id, requestId } },
      })
    }
    if (!grant) throw e
  }
  if (!grant) throw new Error('No se pudo generar el beneficio')

  const firstName = recipient.customer.name?.split(' ')[0] || ''
  const vencimiento = grant.expiresAt ? formatInTimeZone(grant.expiresAt, tz, 'dd/MM/yyyy') : 'sin vencimiento'
  const message = renderCampaignMessage(recipient.campaign.messageTemplate, {
    nombre: firstName, codigo: grant.code, vencimiento, negocio: recipient.campaign.business.name,
  })

  return { recipient, grant, message }
}
