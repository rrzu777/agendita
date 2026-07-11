'use server'

// NOTE: 'use server' — SOLO funciones async exportadas (helpers privados sin
// export). Flujo DUEÑA: revive una reserva `expired`. Es el ÚNICO camino de
// salida de `expired`: el mapa VALID_STATUS_TRANSITIONS del path genérico
// (bookings.ts) queda en [] a propósito (updateBookingStatus no sabe
// re-validar cupo).

import { prisma } from '@/lib/db'
import { requireBusinessRole } from '@/lib/auth/server'
import { revalidatePath } from 'next/cache'
import { revalidateBusinessPublicPaths } from '@/server/actions/revalidate-business'
import { assertSlotFreeOfConflicts } from '@/lib/availability/validation'
import {
  sendNotificationSafely,
  sendBookingConfirmedNotification,
} from '@/lib/notifications'

// El EXCLUDE parcial Booking_no_overlap puede rechazar el update aun cuando el
// chequeo de solape pasó (p.ej. pending_payment con hold recién vencido que el
// assert considera libre, o confirm de turno pasado sin assert). Postgres tira
// 23P01; Prisma no lo mapea a un código conocido — detectamos por el nombre
// del constraint en message/meta.
function isNoOverlapViolation(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e)
  const meta = (e as { meta?: unknown } | null)?.meta
  return `${msg} ${JSON.stringify(meta ?? {})}`.includes('Booking_no_overlap')
}

export async function reviveBooking(
  bookingId: string,
  mode: 'confirm' | 'reopen',
): Promise<{ ok: true }> {
  const { business, businessId } = await requireBusinessRole(['owner', 'admin'])

  let result: { mode: 'confirm'; isFuture: boolean }
  try {
    result = await prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId, businessId }, // guard cross-tenant
      })
      if (!booking) throw new Error('Reserva no encontrada')
      if (booking.status !== 'expired') {
        throw new Error('Solo se puede revivir una reserva expirada')
      }

      const now = new Date()
      const isFuture = booking.startDateTime > now
      const timezone = business.timezone || 'America/Santiago'

      if (mode === 'confirm') {
        if (isFuture) {
          await assertSlotFreeOfConflicts({
            tx,
            businessId,
            startDateTime: booking.startDateTime,
            endDateTime: booking.endDateTime,
            timezone,
            excludeBookingId: booking.id,
          })
        }
        // Los Payments NO se tocan y la redemption de promo liberada al expirar
        // NO se re-reclama: la revivida mantiene el precio descontado que la
        // clienta aceptó, aceptando el posible sobre-uso del cap de la promo
        // (spec §1.4 — decisión de producto). El abono se registra después con
        // el flujo manual existente.
        const { count } = await tx.booking.updateMany({
          where: { id: bookingId, businessId, status: 'expired' }, // guard cross-tenant + CAS
          data: { status: 'confirmed', holdExpiresAt: null },
        })
        if (count === 0) throw new Error('Solo se puede revivir una reserva expirada')
        return { mode: 'confirm' as const, isFuture }
      }

      // mode === 'reopen' — Task 4 lo implementa; por ahora, guard de alcance.
      throw new Error('Modo de revive no soportado')
    })
  } catch (e) {
    if (isNoOverlapViolation(e)) {
      throw new Error('Ese horario ya está ocupado por otra reserva.')
    }
    throw e
  }

  if (result.mode === 'confirm' && result.isFuture) {
    await sendNotificationSafely('booking confirmed', () =>
      sendBookingConfirmedNotification(bookingId, businessId),
    )
  }

  revalidatePath('/dashboard/bookings')
  revalidatePath('/dashboard/payments')
  revalidatePath('/dashboard')
  await revalidateBusinessPublicPaths(businessId)
  return { ok: true }
}
