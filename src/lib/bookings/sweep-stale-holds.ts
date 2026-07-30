import { BookingStatus, BookingPaymentStatus, type Prisma, type PrismaClient } from '@prisma/client'
import { releaseRedemptionsOfExpiredBookings } from '@/lib/promotions/release'

/**
 * Marca `expired` holds de pago abandonados, dentro de la transacción del caller.
 *
 * Existe porque el EXCLUDE `Booking_no_overlap` no sabe nada de `holdExpiresAt`:
 * una reserva `pending_payment` con el hold vencido sigue tapando su horario para
 * Postgres aunque la agenda ya lo ofrezca. Hasta que el cron corría (hasta una
 * hora después) reservar ese horario explotaba con un error que nadie podía
 * explicar. Barrerlas acá, en la misma transacción que ya pidió el advisory lock y
 * tiene las filas con `FOR UPDATE`, hace que la BD y la agenda digan lo mismo.
 *
 * Los `ids` los elige `isSweepableExpiredHold`: sólo abandonos sin plata ni
 * transferencia de por medio. Todo lo que le deba un mail a la clienta lo sigue
 * barriendo el cron (`lib/cron/expire-holds.ts`), que sí puede mandarlo.
 *
 * Devuelve cuántas transicionaron de verdad (puede ser menos que `ids.length`: un
 * pago que llegó entre la lectura y esto gana la carrera y se queda con su hora).
 */
export async function sweepStaleHoldsInTx(
  tx: Prisma.TransactionClient | PrismaClient,
  ids: string[],
  now: Date,
): Promise<number> {
  if (ids.length === 0) return 0

  // Las condiciones se repiten acá adentro (mismo patrón que el cron): un pago
  // aprobado en el medio deja de calificar y no se expira.
  const { count } = await tx.booking.updateMany({
    where: {
      id: { in: ids },
      status: BookingStatus.pending_payment,
      paymentStatus: BookingPaymentStatus.unpaid,
      holdExpiresAt: { lt: now },
    },
    data: { status: BookingStatus.expired },
  })

  await releaseRedemptionsOfExpiredBookings(tx, ids)

  return count
}
