/**
 * El `.ics` de una reserva, armado de punta a punta: el evento, el archivo, el
 * nombre y la URL que lo sirve. Lo comparten la ruta que baja el archivo y los
 * mails que lo adjuntan, así que los dos mandan exactamente lo mismo.
 *
 * Viene en dos: `bookingInvite` no toca la base y lo usa quien ya tiene la fila
 * (crear y confirmar una reserva la acaban de leer), y `loadBookingInvite` la
 * trae para quien no la tiene o la tiene vieja. Los dos pasan por el mismo
 * `deservesCalendarEvent`, que es donde vive el criterio.
 */
import type { BookingStatus } from '@prisma/client'
import { prisma } from '@/lib/db'
import { getBookingCalendarUrl, getBookingConfirmationUrl } from '@/lib/business/urls'
import {
  buildBookingCalendarEvent,
  bookingIcsFilename,
  deservesCalendarEvent,
  type BookingCalendarEvent,
  type BookingEventSource,
} from './booking-event'
import { buildIcs } from './ics'

export interface BookingCalendarInvite {
  event: BookingCalendarEvent
  filename: string
  ics: string
  /** URL absoluta que sirve este mismo archivo (para el cuerpo del mail). */
  url: string
}

/** El evento de una reserva que ya está leída, o null si no corresponde
 *  ofrecerlo (ver `deservesCalendarEvent`). Sin I/O: lo usa quien acaba de
 *  crear o confirmar la reserva y la tiene en la mano. */
export function bookingInvite(
  booking: BookingEventSource & { status: BookingStatus },
): BookingCalendarInvite | null {
  if (!deservesCalendarEvent(booking.status)) return null

  const event = buildBookingCalendarEvent(booking)
  return {
    event,
    filename: bookingIcsFilename(booking),
    ics: buildIcs(event),
    url: getBookingCalendarUrl(booking.id),
  }
}

/** Lo que se sabe de una reserva buscada por id. `null` = no existe; con
 *  `invite` en null la reserva existe pero ya no hay nada que agendar (se
 *  cumplió, se canceló), y ahí lo que corresponde es mandarla a su pantalla de
 *  confirmación, que sabe contar cada caso. */
export interface BookingInviteLookup {
  invite: BookingCalendarInvite | null
  confirmationUrl: string
}

/** Lo mismo, trayendo la reserva de la base: para quien no la tiene (la ruta que
 *  sirve el archivo) o la tiene vieja (después de reprogramar, la fila en
 *  memoria conserva el horario anterior). */
export async function loadBookingInvite(bookingId: string): Promise<BookingInviteLookup | null> {
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

  if (!booking) return null
  return {
    invite: bookingInvite(booking),
    confirmationUrl: getBookingConfirmationUrl(booking.business, booking.id),
  }
}
