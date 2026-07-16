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
 *  sin advisory lock, sin consumir stock. */
export async function mintCampaignGrant(tx: Tx, args: MintCampaignGrantArgs): Promise<PromotionGrant> {
  const existing = await tx.promotionGrant.findUnique({
    where: { customerId_requestId: { customerId: args.customerId, requestId: args.requestId } },
  })
  if (existing) return existing

  const now = args.now ?? new Date()
  const expiryDays = args.promotion.grantExpiryDays ?? args.config.grantExpiryDays
  const expiresAt = expiryDays != null ? new Date(now.getTime() + expiryDays * 86_400_000) : null
  const code = await generateGrantCode(tx, args.businessId)

  try {
    return await tx.promotionGrant.create({
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
  } catch (e) {
    // Carrera: otro request creó el mismo (customerId,requestId) → devolver el existente.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      const g = await tx.promotionGrant.findUnique({
        where: { customerId_requestId: { customerId: args.customerId, requestId: args.requestId } },
      })
      if (g) return g
    }
    throw e
  }
}
