/**
 * El `.ics` de una reserva, cargado desde la base.
 *
 * Es el único lugar donde se decide QUÉ reserva merece un evento de calendario,
 * y por eso lo comparten la ruta que sirve el archivo y los mails que lo
 * adjuntan: si el criterio viviera en cada uno, el mail podría mandar un
 * archivo que la ruta después no sirve.
 */
import { BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getBookingCalendarUrl } from '@/lib/business/urls'
import { buildBookingCalendarEvent, bookingIcsFilename, type BookingCalendarEvent } from './booking-event'
import { buildIcs } from './ics'

export interface BookingCalendarInvite {
  event: BookingCalendarEvent
  filename: string
  ics: string
  /** URL absoluta que sirve este mismo archivo (para el cuerpo del mail). */
  url: string
}

/**
 * Devuelve el evento de una reserva, o null si no corresponde ofrecerlo.
 *
 * **Sólo reservas confirmadas.** Una cita que todavía espera el pago o el visto
 * bueno del negocio puede no existir nunca, y un evento que nadie va a borrar le
 * queda a la clienta en el teléfono para siempre: en el mejor caso se presenta a
 * una hora que se liberó, en el peor lo ve y cree que está todo listo. Cuando la
 * reserva se confirma de verdad sale el mail de confirmación, y ahí sí va.
 */
export async function loadBookingInvite(bookingId: string): Promise<BookingCalendarInvite | null> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    select: {
      id: true,
      bookingNumber: true,
      status: true,
      startDateTime: true,
      endDateTime: true,
      createdAt: true,
      updatedAt: true,
      modality: true,
      serviceAddress: true,
      meetingUrl: true,
      service: { select: { name: true } },
      business: { select: { name: true, slug: true, subdomain: true, addressText: true } },
    },
  })

  if (!booking || booking.status !== BookingStatus.confirmed) return null

  const event = buildBookingCalendarEvent(booking)
  return {
    event,
    filename: bookingIcsFilename(booking),
    ics: buildIcs(event),
    url: getBookingCalendarUrl(booking.id),
  }
}
