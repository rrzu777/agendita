import { Prisma, PromotionGrant } from '@prisma/client'
import { generateGrantCode } from '@/lib/loyalty/redeem'

type Tx = Prisma.TransactionClient

export interface MintCampaignGrantArgs {
  businessId: string
  promotion: { id: string; grantExpiryDays: number | null }
  customerId: string
  requestId: string
  config: { grantExpiryDays: number | null }
  createdByUserId?: string | null
  now?: Date
}

/** Mintea un grant GRATIS (pointsSpent 0) para una promo de campaña, idempotente
 *  por (customerId, requestId). Modelado en activatePackagePurchaseInTx: sin puntos,
 *  sin advisory lock, sin consumir stock.
 *  El P2002 del create (carrera entre dos requests) se deja propagar: el caller lo
 *  captura FUERA del $transaction y re-lee el grant por (customerId, requestId). */
export async function mintCampaignGrant(tx: Tx, args: MintCampaignGrantArgs): Promise<PromotionGrant> {
  const existing = await tx.promotionGrant.findUnique({
    where: { customerId_requestId: { customerId: args.customerId, requestId: args.requestId } },
  })
  if (existing) return existing

  const now = args.now ?? new Date()
  const expiryDays = args.promotion.grantExpiryDays ?? args.config.grantExpiryDays
  const expiresAt = expiryDays != null ? new Date(now.getTime() + expiryDays * 86_400_000) : null
  const code = await generateGrantCode(tx, args.businessId)

  return tx.promotionGrant.create({
    data: {
      businessId: args.businessId,
      promotionId: args.promotion.id,
      customerId: args.customerId,
      code,
      pointsSpent: 0,
      status: 'active',
      expiresAt,
      refundOnExpiry: false,
      forfeitOnNoShow: false,
      requestId: args.requestId,
      createdByUserId: args.createdByUserId ?? null,
    },
  })
}
