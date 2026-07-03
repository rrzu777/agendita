import type { Prisma } from '@prisma/client'

export interface PackageApplyResult { discountAmount: number; packagePurchaseId: string; promotionId: string }

/** Selecciona el grant de paquete activo, no vencido, cuya COMPRA (snapshot) cubre el
 *  servicio. Vence primero lo que vence antes (nulls al final). Filtra expiración en la query. */
export async function findApplicablePackageGrant(
  tx: Prisma.TransactionClient,
  args: { businessId: string; customerId: string; serviceId: string; now?: Date },
) {
  const now = args.now ?? new Date()
  const grants = await tx.promotionGrant.findMany({
    where: {
      businessId: args.businessId, customerId: args.customerId, status: 'active',
      packagePurchaseId: { not: null },
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }],
      packagePurchase: {
        status: 'active',
        OR: [{ coversAll: true }, { coveredServiceIds: { has: args.serviceId } }],
      },
    },
    include: { packagePurchase: { select: { id: true } } },
    orderBy: [{ expiresAt: 'asc' }],
  })
  // Postgres ordena NULLS LAST por defecto en ASC, así que expiresAt null cae al final.
  return grants[0] ?? null
}

/** Aplica un grant de paquete a la reserva (auto-select + flip atómico + PromotionRedemption).
 *  Devuelve null si no hay paquete aplicable. Reusa la mecánica de apply.ts (rama grant). */
export async function applyPackageInTx(
  tx: Prisma.TransactionClient,
  args: {
    businessId: string; customerId: string; serviceId: string; bookingId: string
    totalPrice: number; source: 'public_booking' | 'dashboard_booking'
    createdByUserId?: string | null; now?: Date
  },
): Promise<PackageApplyResult | null> {
  const now = args.now ?? new Date()
  const grant = await findApplicablePackageGrant(tx, {
    businessId: args.businessId, customerId: args.customerId, serviceId: args.serviceId, now,
  })
  if (!grant || !grant.packagePurchase) return null
  const discount = Math.max(0, args.totalPrice) // free_service cubre el total del servicio
  const flipped = await tx.promotionGrant.updateMany({
    where: { id: grant.id, status: 'active' },
    data: { status: 'redeemed', redeemedBookingId: args.bookingId, redeemedAt: now },
  })
  if (flipped.count === 0) return null // carrera: otro booking lo tomó
  await tx.promotionRedemption.create({
    data: {
      businessId: args.businessId, promotionId: grant.promotionId, bookingId: args.bookingId,
      customerId: args.customerId, discountAmount: discount, source: args.source,
      createdByUserId: args.createdByUserId ?? null,
    },
  })
  return { discountAmount: discount, packagePurchaseId: grant.packagePurchase.id, promotionId: grant.promotionId }
}
