import type { Prisma } from '@prisma/client'
import { generateGrantCode } from '@/lib/loyalty/redeem'
import { perGrantRequestId } from '@/lib/packages/schema'

const PACKAGE_MARKER_NAME = 'package-coverage'

/** Una Promotion marcador por negocio a la que apuntan los grants de paquete.
 *  triggerType 'granted' (para que release reactive el grant), free_service, appliesToAll,
 *  pointsCost null (excluida del catálogo de canje). Creada lazily. */
export async function getOrCreatePackageMarkerPromotion(tx: Prisma.TransactionClient, businessId: string): Promise<string> {
  const existing = await tx.promotion.findFirst({
    where: { businessId, triggerType: 'granted', name: PACKAGE_MARKER_NAME, pointsCost: null },
    select: { id: true },
  })
  if (existing) return existing.id
  const created = await tx.promotion.create({
    data: {
      businessId, name: PACKAGE_MARKER_NAME, triggerType: 'granted',
      rewardType: 'free_service', rewardValue: 0, appliesToAll: true, isActive: true,
      metadata: { kind: 'package-coverage' } as Prisma.InputJsonValue,
    },
    select: { id: true },
  })
  return created.id
}

/** Datos mínimos de la compra que necesita el activador. */
export interface ActivatablePurchase {
  id: string
  businessId: string
  customerId: string
  pricePaid: number
  quantity: number
  bonusQuantity: number
  expiresAt: Date | null
  createdByUserId: string | null
}

export interface ActivateOptions {
  /** Base para el requestId idempotente de cada grant (perGrantRequestId). */
  requestId: string
  /** Payment que originó la activación (online). Null/undefined para venta manual. */
  paymentId?: string | null
  /** Override del autor; por defecto el de la compra. */
  createdByUserId?: string | null
}

/**
 * Activa una PackagePurchase: emite quantity+bonus grants (idempotentes por
 * perGrantRequestId), marca la compra `active` y escribe el asiento de ledger
 * `package_sale` (income = pricePaid). Único activador — lo invocan la venta
 * manual (sellPackage) y, a futuro, el pago online (webhook MP / transferencia).
 */
export async function activatePackagePurchaseInTx(
  tx: Prisma.TransactionClient,
  purchase: ActivatablePurchase,
  opts: ActivateOptions,
): Promise<void> {
  const markerId = await getOrCreatePackageMarkerPromotion(tx, purchase.businessId)
  const total = purchase.quantity + purchase.bonusQuantity
  const author = opts.createdByUserId ?? purchase.createdByUserId

  for (let i = 0; i < total; i++) {
    await tx.promotionGrant.create({
      data: {
        businessId: purchase.businessId, promotionId: markerId, customerId: purchase.customerId,
        code: await generateGrantCode(tx, purchase.businessId), pointsSpent: 0, status: 'active',
        expiresAt: purchase.expiresAt, refundOnExpiry: false, forfeitOnNoShow: false,
        requestId: perGrantRequestId(opts.requestId, i), packagePurchaseId: purchase.id,
        createdByUserId: author,
      },
    })
  }

  await tx.packagePurchase.update({ where: { id: purchase.id }, data: { status: 'active' } })

  const ledgerData = {
    businessId: purchase.businessId,
    packagePurchaseId: purchase.id,
    paymentId: opts.paymentId ?? null,
    customerId: purchase.customerId,
    type: 'package_sale' as const,
    direction: 'income' as const,
    amount: purchase.pricePaid,
    currency: 'CLP',
    description: 'Venta de paquete',
    occurredAt: new Date(),
    createdByUserId: author,
  }

  // Con paymentId: upsert para respetar @@unique([paymentId]) ante reintentos
  // del pago online. Venta manual (paymentId null): create directo (múltiples
  // NULLs permitidos en el índice único).
  if (opts.paymentId) {
    await tx.ledgerEntry.upsert({ where: { paymentId: opts.paymentId }, update: {}, create: ledgerData })
  } else {
    await tx.ledgerEntry.create({ data: ledgerData })
  }
}
