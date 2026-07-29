import type { Prisma, PromotionReward, PrismaClient } from '@prisma/client'
import { createGrantInTx } from './grant'
import { conditionKind } from './automatic-match'

type Tx = Prisma.TransactionClient

/** Shape compartido para cargar reglas automáticas (cron + carga puntual). */
export const AUTOMATIC_RULE_SELECT = {
  id: true, businessId: true, conditions: true, rewardPoints: true, rewardType: true,
  rewardValue: true, maxDiscount: true, appliesToAll: true, grantExpiryDays: true, priority: true,
  maxPerCustomer: true,
  services: { select: { id: true } },
} satisfies Prisma.PromotionSelect

const DAY_MS = 86_400_000

export interface AutomaticRule {
  id: string
  businessId: string
  conditions: Prisma.JsonValue
  rewardPoints: number | null
  rewardType: PromotionReward | null
  rewardValue: number
  maxDiscount: number | null
  appliesToAll: boolean
  grantExpiryDays: number | null
  maxPerCustomer?: number | null
  priority?: number
  services?: { id: string }[]
}

export interface EmitConfig {
  grantExpiryDays: number | null
  forfeitGrantOnNoShow: boolean
}

export type EmittedReward =
  | { kind: 'points'; points: number; ledgerId: string }
  | { kind: 'grant'; grantId: string; code: string }
  | null // ya emitido (dedup) o regla sin recompensa válida

/** Carga todas las reglas automáticas activas de un negocio. Acepta el client global o una tx. */
export async function loadAutomaticRules(db: Tx | PrismaClient, businessId: string): Promise<AutomaticRule[]> {
  return db.promotion.findMany({
    where: { businessId, triggerType: 'automatic', isActive: true },
    select: AUTOMATIC_RULE_SELECT,
  })
}

/** Carga la regla automática activa de un kind para un negocio (a lo sumo una). */
export async function loadAutomaticRule(tx: Tx, businessId: string, kind: string): Promise<AutomaticRule | null> {
  const rules = await loadAutomaticRules(tx, businessId)
  return rules.find((r) => conditionKind(r.conditions) === kind) ?? null
}

/** Emite la recompensa de una regla automática (puntos o grant), idempotente.
 *  - puntos: asiento `bonus` con `dedupeKey` (unique businessId+dedupeKey) y
 *    columnas `triggeringBookingId`/`sourcePromotionId` para el clawback/guard. `bookingId` queda null.
 *  - grant: PromotionGrant ganado (pointsSpent 0, refundOnExpiry false), `requestId = dedupeKey`.
 *  Devuelve null si ya estaba emitido o si la regla no define recompensa.
 *
 *  La dedup va por PRE-CHEQUEO de la clave única, no por try/catch del P2002: esta
 *  función corre SIEMPRE adentro de un `prisma.$transaction` (bookings, reviews,
 *  referidos, cron), y en Postgres una violación de constraint aborta la transacción
 *  entera — Prisma no usa savepoints, así que atajar el error no recupera nada: lo
 *  que siguiera fallaría con "current transaction is aborted". Mismo patrón que
 *  `mintCampaignGrant`. La carrera que el pre-chequeo no cubre (dos tx simultáneas
 *  con el mismo dedupeKey) termina en P2002 y la pierde una de las dos, que es lo
 *  correcto: los callers ya envuelven la emisión en try/catch best-effort. */
export async function emitAutomaticReward(tx: Tx, args: {
  rule: AutomaticRule
  businessId: string
  customerId: string
  dedupeKey: string
  config: EmitConfig
  triggeringBookingId?: string | null
  now: Date
}): Promise<EmittedReward> {
  const { rule, businessId, customerId, dedupeKey, config, now } = args
  const triggeringBookingId = args.triggeringBookingId ?? null
  const kind = conditionKind(rule.conditions) ?? 'unknown'
  const meta = { ruleId: rule.id, kind, triggeringBookingId, auto: true } as Prisma.InputJsonValue

  // R-CAP: tope de emisiones de esta regla por clienta (reusa Promotion.maxPerCustomer).
  if (rule.maxPerCustomer != null) {
    const [prevPoints, prevGrants] = await Promise.all([
      tx.loyaltyLedger.count({ where: { businessId, customerId, sourcePromotionId: rule.id } }),
      tx.promotionGrant.count({ where: { businessId, customerId, promotionId: rule.id } }),
    ])
    if (prevPoints + prevGrants >= rule.maxPerCustomer) return null
  }

  // Rama puntos
  if (rule.rewardPoints != null) {
    const alreadyEmitted = await tx.loyaltyLedger.findUnique({
      where: { businessId_dedupeKey: { businessId, dedupeKey } },
      select: { id: true },
    })
    if (alreadyEmitted) return null
    const led = await tx.loyaltyLedger.create({
      data: { businessId, customerId, points: rule.rewardPoints, reason: 'bonus',
        bookingId: null, dedupeKey, triggeringBookingId, sourcePromotionId: rule.id, metadata: meta },
    })
    return { kind: 'points', points: rule.rewardPoints, ledgerId: led.id }
  }

  // Rama grant
  if (rule.rewardType == null) return null
  const alreadyGranted = await tx.promotionGrant.findUnique({
    where: { customerId_requestId: { customerId, requestId: dedupeKey } },
    select: { id: true },
  })
  if (alreadyGranted) return null
  const expiryDays = rule.grantExpiryDays ?? config.grantExpiryDays
  const expiresAt = expiryDays != null ? new Date(now.getTime() + expiryDays * DAY_MS) : null
  const grant = await createGrantInTx(tx, {
    businessId, promotionId: rule.id, customerId, requestId: dedupeKey,
    expiresAt, triggeringBookingId,
    forfeitOnNoShow: config.forfeitGrantOnNoShow, metadata: meta,
  })
  return { kind: 'grant', grantId: grant.id, code: grant.code }
}

/** Clawback de recompensas automáticas gatilladas por una reserva (first_visit/referral),
 *  cuando `LoyaltyConfig.clawbackAutoRewardOnRefund` está activo. Idempotente.
 *  - puntos bonus: asiento `bonus_reversal` por -points (dedup `reversal:${ledgerId}`).
 *  - grants ganados activos: flip a `reversed`. Si ya se aplicaron/redimieron, se respetan.
 *  Filtra por la COLUMNA `triggeringBookingId` (no metadata) y opcionalmente por `businessId`. */
export async function reverseAutoRewardsForBooking(
  tx: Tx, bookingId: string, now: Date, businessId?: string,
): Promise<void> {
  const scope = businessId ? { businessId } : {}
  const bonuses = await tx.loyaltyLedger.findMany({
    where: { ...scope, reason: 'bonus', triggeringBookingId: bookingId },
    select: { id: true, businessId: true, customerId: true, points: true },
  })
  // Mismo motivo que en `emitAutomaticReward`: el P2002 no se puede atajar adentro
  // de la tx. Acá pesa todavía más — esto corre dentro de la tx del refund/chargeback,
  // así que un asiento repetido tumbaría la reversión ENTERA. Una sola consulta para
  // las N claves: el dedupeKey lleva adentro el id del asiento original (un cuid
  // global), así que no puede colisionar entre negocios. Sin bonus no se consulta
  // nada: el caso común (una reserva sin recompensa automática) no paga el viaje.
  const alreadyReversed = new Set(
    bonuses.length === 0 ? [] : (await tx.loyaltyLedger.findMany({
      where: { dedupeKey: { in: bonuses.map((b) => `reversal:${b.id}`) } },
      select: { dedupeKey: true },
    })).map((l) => l.dedupeKey),
  )
  for (const b of bonuses) {
    const dedupeKey = `reversal:${b.id}`
    if (alreadyReversed.has(dedupeKey)) continue
    await tx.loyaltyLedger.create({
      data: { businessId: b.businessId, customerId: b.customerId, points: -b.points,
        reason: 'bonus_reversal', bookingId: null, dedupeKey,
        triggeringBookingId: bookingId,
        metadata: { reversedLedgerId: b.id, triggeringBookingId: bookingId } },
    })
  }

  const grants = await tx.promotionGrant.findMany({
    where: { ...scope, status: 'active', triggeringBookingId: bookingId },
    select: { id: true },
  })
  for (const g of grants) {
    await tx.promotionGrant.updateMany({
      where: { id: g.id, status: 'active' },
      data: { status: 'reversed', reversedAt: now },
    })
  }
}
