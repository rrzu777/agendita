/**
 * El aviso a la dueña de que entró plata y el turno NO quedó en pie.
 *
 * Vive en su propio módulo porque lo disparan TRES caminos distintos de cobro
 * (webhook de Mercado Pago, confirmación pública post-checkout y pago manual del
 * dashboard) y en los tres el desenlace es el mismo: la plata quedó asentada, la
 * reserva NO se confirmó y nadie más se va a enterar. Si un cuarto camino de pago
 * aparece, tiene que llamar a esto — un no-confirmar silencioso es plata cobrada
 * por una hora que la clienta no tiene.
 *
 * El motivo (horario tomado, reserva vencida, cancelada…) viaja en `reason` y sólo
 * cambia una línea del mail: para la dueña la decisión es la misma, reacomodar o
 * devolver.
 *
 * Best-effort como todas las notificaciones: se traga sus propios errores, así
 * que nunca hace fallar el cobro que la disparó. Sin `'use server'` a propósito:
 * es una función server-side común, no un endpoint.
 */
import { prisma } from '@/lib/db'
import { getVocabulary } from '@/lib/vocabulary'
import { formatBookingNumber } from '@/lib/bookings/number'
import { describeUnconfirmedPayment, type UnconfirmedPaymentReason } from '@/server/services/finance'
import { sendBookingPaymentNotConfirmedToBusiness, sendMultiNotificationSafely } from '@/lib/notifications'

export async function firePaymentNotConfirmedNotification(args: {
  bookingId: string
  businessId: string
  reason: UnconfirmedPaymentReason
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

  await sendMultiNotificationSafely('booking payment not confirmed business', async () =>
    sendBookingPaymentNotConfirmedToBusiness(args.businessId, {
      businessName: booking.business.name,
      businessCategory: booking.business.category,
      customerName: booking.customer?.name ?? getVocabulary(booking.business.category).Client,
      serviceName: booking.service?.name ?? 'servicio',
      bookingLabel: formatBookingNumber(booking.bookingNumber, args.bookingId),
      startDateTime: booking.startDateTime,
      businessTimezone: booking.business.timezone || 'America/Santiago',
      amount: args.amount,
      businessCurrency: booking.business.currency || 'CLP',
      situation: describeUnconfirmedPayment(args.reason),
    }),
  )
}
