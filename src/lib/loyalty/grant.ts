import { randomInt } from 'node:crypto'
import type { Prisma, PrismaClient, PromotionGrant } from '@prisma/client'

type TxLike = Prisma.TransactionClient | PrismaClient
type Tx = Prisma.TransactionClient

// Crockford base32 sin caracteres ambiguos (sin I, L, O, U).
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function randomCode(len = 10): string {
  let s = ''
  for (let i = 0; i < len; i++) s += ALPHABET[randomInt(ALPHABET.length)]
  return s
}

/** Genera un código de grant único en el negocio, sin colisionar con promo-códigos
 *  ni con otros grants. Ya viene normalizado (uppercase base32). */
export async function generateGrantCode(tx: Tx, businessId: string): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = randomCode()
    const [promo, grant] = await Promise.all([
      tx.promotion.findFirst({ where: { businessId, code }, select: { id: true } }),
      tx.promotionGrant.findFirst({ where: { businessId, code }, select: { id: true } }),
    ])
    if (!promo && !grant) return code
  }
  throw new Error('No se pudo generar un código de canje')
}

export interface CreateGrantArgs {
  businessId: string
  promotionId: string
  customerId: string
  requestId: string
  pointsSpent?: number
  expiresAt?: Date | null
  refundOnExpiry?: boolean
  forfeitOnNoShow?: boolean
  createdByUserId?: string | null
  triggeringBookingId?: string | null
  packagePurchaseId?: string | null
  metadata?: Prisma.InputJsonValue
}

/** Emite un grant `active` con código único. Único punto donde se construye el
 *  `promotionGrant.create`: los cuatro emisores (campaña, canje por puntos, regla
 *  automática, activación de paquete) pasan sólo lo que varía y heredan los defaults
 *  (pointsSpent 0, sin refund/forfeit). Los campos extra (`undefined`) los omite Prisma.
 *  La idempotencia por (customerId, requestId) y el manejo del P2002 quedan en el caller. */
export async function createGrantInTx(tx: Tx, args: CreateGrantArgs): Promise<PromotionGrant> {
  const code = await generateGrantCode(tx, args.businessId)
  return tx.promotionGrant.create({
    data: {
      businessId: args.businessId,
      promotionId: args.promotionId,
      customerId: args.customerId,
      code,
      pointsSpent: args.pointsSpent ?? 0,
      status: 'active',
      expiresAt: args.expiresAt ?? null,
      refundOnExpiry: args.refundOnExpiry ?? false,
      forfeitOnNoShow: args.forfeitOnNoShow ?? false,
      requestId: args.requestId,
      createdByUserId: args.createdByUserId ?? null,
      triggeringBookingId: args.triggeringBookingId,
      packagePurchaseId: args.packagePurchaseId,
      metadata: args.metadata,
    },
  })
}

/** Reconcilia los grants vencidos de una clienta (lazy, sin cron). Idempotente:
 *  el guard `updateMany` garantiza que sólo la llamada que hace el flip inserta el
 *  reembolso. Corre en toda superficie que muestre saldo.
 *  IMPORTANTE: debe ejecutarse DENTRO de una transacción para que el flip a
 *  `reversed` y el asiento de reembolso sean atómicos (un crash entre ambos dejaría
 *  el grant consumido sin devolver los puntos). `redeemForGrant` ya la llama dentro
 *  de su tx; los demás callers la envuelven en `prisma.$transaction(tx => ...)`. */
export async function reconcileExpiredGrants(
  db: TxLike,
  customerId: string,
  businessId: string,
  now: Date = new Date(),
): Promise<void> {
  const expired = await db.promotionGrant.findMany({
    where: { customerId, businessId, status: 'active', expiresAt: { lt: now } },
    select: { id: true, businessId: true, customerId: true, pointsSpent: true, refundOnExpiry: true },
  })
  for (const g of expired) {
    await expireGrantWithRefund(db, g, 'active', now)
  }
}

/** Vence un grant: flip atómico desde `fromStatus` y, si `refundOnExpiry`, inserta el
 *  asiento de reembolso. El guard del `updateMany` lo hace idempotente (sólo la llamada
 *  que gana el flip inserta el reembolso). Compartido por la reconciliación lazy
 *  (`fromStatus='active'`) y el release de una reserva con grant (`fromStatus='redeemed'`). */
export async function expireGrantWithRefund(
  db: TxLike,
  grant: { id: string; businessId: string; customerId: string; pointsSpent: number; refundOnExpiry: boolean },
  fromStatus: 'active' | 'redeemed',
  now: Date,
): Promise<void> {
  if (!grant.refundOnExpiry) {
    await db.promotionGrant.updateMany({
      where: { id: grant.id, status: fromStatus },
      data: { status: 'expired' },
    })
    return
  }
  const flipped = await db.promotionGrant.updateMany({
    where: { id: grant.id, status: fromStatus },
    data: { status: 'reversed', reversedAt: now },
  })
  if (flipped.count === 1) {
    await db.loyaltyLedger.create({
      data: {
        businessId: grant.businessId, customerId: grant.customerId, points: grant.pointsSpent,
        reason: 'redemption_reversal', metadata: { grantId: grant.id },
      },
    })
  }
}
