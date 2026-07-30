/**
 * El aviso a la dueña de que entró un pago sobre un horario que ya no está libre.
 *
 * Vive en su propio módulo porque lo disparan TRES caminos distintos de cobro
 * (webhook de Mercado Pago, confirmación pública post-checkout y pago manual del
 * dashboard) y en los tres el desenlace es el mismo: la plata quedó asentada, la
 * reserva NO se confirmó y nadie más se va a enterar. Si un cuarto camino de pago
 * aparece, tiene que llamar a esto — un no-confirmar silencioso es plata cobrada
 * por una hora que la clienta no tiene.
 *
 * Best-effort como todas las notificaciones: se traga sus propios errores, así
 * que nunca hace fallar el cobro que la disparó. Sin `'use server'` a propósito:
 * es una función server-side común, no un endpoint.
 */
import { prisma } from '@/lib/db'
import { getVocabulary } from '@/lib/vocabulary'
import { formatBookingNumber } from '@/lib/bookings/number'
import { describeSlotConflict } from '@/server/services/finance'
import type { SlotConflict } from '@/lib/availability/validation'
import { sendBookingSlotTakenToBusiness, sendMultiNotificationSafely } from '@/lib/notifications'

export async function fireSlotTakenNotification(args: {
  bookingId: string
  businessId: string
  conflict: SlotConflict
  /** Lo que se cobró recién, para que el mail diga cuánta plata hay que resolver. */
  amount: number
}): Promise<void> {
  const booking = await prisma.booking.findUnique({
    where: { id: args.bookingId },
    select: {
      bookingNumber: true,
      startDateTime: true,
      customer: { select: { name: true } },
      service: { select: { name: true } },
      business: { select: { name: true, currency: true, timezone: true, category: true } },
    },
  })
  if (!booking) return

  await sendMultiNotificationSafely('booking slot taken business', async () =>
    sendBookingSlotTakenToBusiness(args.businessId, {
      businessName: booking.business.name,
      businessCategory: booking.business.category,
      customerName: booking.customer?.name ?? getVocabulary(booking.business.category).Client,
      serviceName: booking.service?.name ?? 'servicio',
      bookingLabel: formatBookingNumber(booking.bookingNumber, args.bookingId),
      startDateTime: booking.startDateTime,
      businessTimezone: booking.business.timezone || 'America/Santiago',
      amount: args.amount,
      businessCurrency: booking.business.currency || 'CLP',
      situation: describeSlotConflict(args.conflict),
    }),
  )
}
