/**
 * La cascada de descuento de una reserva nueva: paquete prepago primero, código
 * de promo después.
 *
 * **La precedencia es la regla de negocio que este módulo protege:** si la clienta
 * tiene un paquete que cubre el servicio, se consume el paquete y el código se
 * ignora — no se acumulan. Los dos `createBooking` la implementaban por separado y
 * eso es justo lo que no conviene tener duplicado.
 *
 * Corre SIEMPRE adentro de la transacción de creación: si el código es inválido o
 * está agotado, `applyPromotionInTx` lanza y hace rollback de todo (reserva +
 * canje + incremento), o sea que no queda una reserva con un canje a medias.
 *
 * Sin `'use server'` a propósito: es una función server-side común, no un endpoint.
 */
import type { Prisma } from '@prisma/client'
import { applyPackageInTx } from '@/lib/packages/consume'
import { applyPromotionInTx, type ApplyResult } from '@/lib/promotions/apply'

/**
 * Devuelve el descuento aplicado, o `null` si no hubo ni paquete ni código. El tipo
 * es el de la promo (`PackageApplyResult` le agrega `packagePurchaseId`, que ningún
 * caller de acá usa).
 *
 * `source` y `createdByUserId` son lo único que distingue al funnel público del
 * panel: quedan en el `PromotionRedemption` para saber por dónde entró el canje y
 * quién lo hizo (nadie, en el público).
 */
export async function applyBookingDiscountInTx(
  tx: Prisma.TransactionClient,
  args: {
    businessId: string
    customerId: string
    serviceId: string
    bookingId: string
    totalPrice: number
    promotionCode?: string
    /** El wizard permite reservar sin gastar el paquete (guardarlo para otra vez). */
    skipPackage?: boolean
    source: 'public_booking' | 'dashboard_booking'
    createdByUserId?: string
  },
): Promise<ApplyResult | null> {
  const { businessId, customerId, serviceId, bookingId, totalPrice, source, createdByUserId } = args

  if (!args.skipPackage) {
    const fromPackage = await applyPackageInTx(tx, {
      businessId, customerId, serviceId, bookingId, totalPrice, source, createdByUserId,
    })
    if (fromPackage) return fromPackage
  }

  return applyPromotionInTx(tx, {
    businessId,
    code: args.promotionCode,
    serviceId,
    customerId,
    totalPrice,
    bookingId,
    source,
    createdByUserId,
  })
}
