import type { Prisma, PromotionReward } from '@prisma/client'
import { generateGrantCode } from './redeem'
import { isP2002 } from './credit'

type Tx = Prisma.TransactionClient

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

/** Emite la recompensa de una regla automática (puntos o grant), idempotente.
 *  - puntos: asiento `bonus` con `dedupeKey` (unique businessId+dedupeKey) y
 *    columnas `triggeringBookingId`/`sourcePromotionId` para el clawback/guard. `bookingId` queda null.
 *  - grant: PromotionGrant ganado (pointsSpent 0, refundOnExpiry false), `requestId = dedupeKey`.
 *  Devuelve null si ya estaba emitido (P2002) o si la regla no define recompensa. */
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
  const kind = (rule.conditions as { kind?: string } | null)?.kind ?? 'unknown'
  const meta = { ruleId: rule.id, kind, triggeringBookingId, auto: true } as Prisma.InputJsonValue

  // Rama puntos
  if (rule.rewardPoints != null) {
    try {
      const led = await tx.loyaltyLedger.create({
        data: { businessId, customerId, points: rule.rewardPoints, reason: 'bonus',
          bookingId: null, dedupeKey, triggeringBookingId, sourcePromotionId: rule.id, metadata: meta },
      })
      return { kind: 'points', points: rule.rewardPoints, ledgerId: led.id }
    } catch (e) {
      if (isP2002(e)) return null
      throw e
    }
  }

  // Rama grant
  if (rule.rewardType == null) return null
  const expiryDays = rule.grantExpiryDays ?? config.grantExpiryDays
  const expiresAt = expiryDays != null ? new Date(now.getTime() + expiryDays * DAY_MS) : null
  try {
    const code = await generateGrantCode(tx, businessId)
    const grant = await tx.promotionGrant.create({
      data: { businessId, promotionId: rule.id, customerId, code, pointsSpent: 0,
        status: 'active', expiresAt, refundOnExpiry: false, triggeringBookingId,
        forfeitOnNoShow: config.forfeitGrantOnNoShow, requestId: dedupeKey, metadata: meta },
    })
    return { kind: 'grant', grantId: grant.id, code: grant.code }
  } catch (e) {
    if (isP2002(e)) return null
    throw e
  }
}
