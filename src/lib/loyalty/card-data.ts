import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getLoyaltyBalance, getLoyaltyHistory } from '@/lib/loyalty/balance'
import { reconcileExpiredGrants } from '@/lib/loyalty/grant'
import { conditionKind } from '@/lib/loyalty/automatic-match'
import { ensureReferralToken } from '@/lib/loyalty/token'
import { getBookingFunnelUrl } from '@/lib/business/urls'

export interface CardCustomer {
  id: string
  name: string
  businessId: string
  referralToken: string | null
  business: {
    id: string
    name: string
    slug: string
    subdomain: string | null
    logoUrl: string | null
    loyaltyConfig: { isActive: boolean; programName: string; pointsLabel: string; cardMessage: string | null } | null
  }
}

export type LoyaltyCardData = Awaited<ReturnType<typeof loadLoyaltyCardData>>

/** Datos de la tarjeta de beneficios de UNA clienta en UN negocio. Corre la
 *  reconciliación (tx interactiva) SOLA antes de las lecturas en paralelo
 *  (pgbouncer connection_limit=1 → P2028 si se mezclan). */
export async function loadLoyaltyCardData(customer: CardCustomer) {
  await prisma.$transaction((tx) => reconcileExpiredGrants(tx, customer.id, customer.businessId))

  const config = customer.business.loyaltyConfig
  // La reconciliación ya corrió; las 4 lecturas son independientes => en paralelo.
  const [balance, history, catalog, grants, referralRules, packages] = await Promise.all([
    getLoyaltyBalance(prisma, customer.id, customer.businessId),
    getLoyaltyHistory(prisma, customer.id, customer.businessId, 50),
    config?.isActive
      ? prisma.promotion.findMany({
          where: { businessId: customer.businessId, triggerType: 'granted', pointsCost: { not: null }, isActive: true },
          orderBy: { pointsCost: 'asc' },
          select: { id: true, name: true, pointsCost: true },
        })
      : Promise.resolve([] as { id: string; name: string; pointsCost: number | null }[]),
    prisma.promotionGrant.findMany({
      // Excluir grants de paquete prepago (packagePurchaseId no null): se consumen
      // automáticamente en la reserva, no son recompensas al portador para la tarjeta.
      where: { customerId: customer.id, businessId: customer.businessId, status: 'active', packagePurchaseId: null },
      orderBy: { createdAt: 'desc' },
      include: { promotion: { select: { name: true } } },
    }),
    config?.isActive
      ? prisma.promotion.findMany({
          where: { businessId: customer.businessId, triggerType: 'automatic', isActive: true },
          select: { id: true, conditions: true },
        })
      : Promise.resolve([] as { id: string; conditions: Prisma.JsonValue }[]),
    prisma.packagePurchase.findMany({
      where: { customerId: customer.id, status: 'active' },
      orderBy: { createdAt: 'desc' },
      // Página pública: seleccionar solo lo que la UI usa (evita traer coveredServiceIds,
      // paymentMethod, refundedAmount, createdByUserId, etc.).
      select: {
        id: true,
        expiresAt: true,
        product: { select: { name: true } },
        _count: {
          select: {
            grants: { where: { status: 'active', OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] } },
          },
        },
      },
    }),
  ])

  // Bloque "Referí a una amiga": solo si la fidelización está activa y existe una
  // regla automática `referral` activa. El token de referido se genera lazy.
  const hasReferralRule = referralRules.some(
    (r) => conditionKind(r.conditions) === 'referral',
  )
  const referralUrl = hasReferralRule
    ? getBookingFunnelUrl(customer.business, `ref=${await ensureReferralToken(prisma, customer)}`)
    : null

  return { config, balance, history, catalog, grants, packages, referralUrl }
}
