/**
 * Una reserva vista como evento de calendario.
 *
 * Es el modelo del que salen las DOS formas de agregar la cita: el archivo
 * `.ics` (iPhone, Outlook, el adjunto del mail) y el link de Google Calendar.
 * Existe para que las dos digan exactamente lo mismo — el título, el dónde y el
 * link de vuelta se deciden una sola vez, acá.
 */
import { ServiceModality, type BookingStatus } from '@prisma/client'
import { formatBookingNumber } from '@/lib/bookings/number'
import { getBookingConfirmationUrl } from '@/lib/business/urls'
import { linkNavegable } from '@/lib/services/modality'

/**
 * Dominio del UID. Va fijo y NO sale de `APP_DOMAIN` a propósito: el UID es la
 * identidad del evento para siempre, y si saliera del entorno la misma reserva
 * tendría un UID en local y otro en producción. Con el UID estable, el segundo
 * `.ics` de una reserva (la confirmación después del "recibida", una
 * reprogramación) actualiza el evento en vez de duplicarlo.
 */
const UID_DOMAIN = 'agendita.cl'

/**
 * Qué reserva merece un evento de calendario.
 *
 * **Sólo las confirmadas.** Una cita que todavía espera el pago o el visto bueno
 * del negocio puede no existir nunca, y un evento que nadie va a borrar le queda
 * a la clienta en el teléfono para siempre: en el mejor caso se presenta a una
 * hora que se liberó, en el peor lo ve y cree que está todo listo.
 *
 * Vive acá, y no adentro del gate del servidor, porque las pantallas tienen que
 * decidir lo mismo antes de ofrecer el botón: si los criterios se separan, la
 * clienta ve el botón y el endpoint le contesta que no encuentra la reserva.
 */
export function deservesCalendarEvent(status: BookingStatus): boolean {
  return status === 'confirmed'
}

export interface BookingCalendarEvent {
  uid: string
  title: string
  start: Date
  end: Date
  /** Texto de "dónde"; null cuando no hay nada honesto que poner. */
  location: string | null
  /** URL propia del evento (la videollamada). No es el link de la confirmación:
   *  ese va en la descripción, donde no compite con "conectarse". */
  url: string | null
  description: string
  /** Versión del evento para el cliente de calendario: número más alto = pisa a
   *  la anterior. Ver `sequenceOf`. */
  sequence: number
  /** Cuándo se armó esta versión del evento (DTSTAMP). */
  stamp: Date
}

/** La reserva y su contexto, tal como los devuelve Prisma. */
export interface BookingEventSource {
  id: string
  bookingNumber: number | null
  startDateTime: Date
  endDateTime: Date
  createdAt: Date
  updatedAt: Date
  modality: ServiceModality
  serviceAddress: string | null
  meetingUrl: string | null
  service: { name: string }
  /** Quién atiende, para la descripción del evento. Requerido a propósito:
   *  si fuera opcional, la misma reserva daría un `.ics` distinto según qué
   *  caller lo armó (la ruta que sirve el archivo vs. el adjunto del mail), y
   *  este módulo existe para que digan exactamente lo mismo. `null` = sin
   *  persona asignada. */
  professional: { name: string } | null
  business: { name: string; slug: string; subdomain: string | null; addressText: string | null }
}

/**
 * SEQUENCE sin columna nueva: segundos entre el alta y la última modificación.
 *
 * RFC 5545 sólo pide que crezca con cada revisión, y `updatedAt` se mueve con
 * cada cambio de la reserva (Prisma `@updatedAt`), así que la resta crece sola.
 * Empatar dos versiones distintas exigiría dos cambios dentro del mismo segundo
 * del mismo día — y el peor caso es que un cliente de calendario ignore la
 * segunda actualización, no que se corrompa nada.
 */
function sequenceOf(booking: BookingEventSource): number {
  const segundos = Math.floor((booking.updatedAt.getTime() - booking.createdAt.getTime()) / 1000)
  return Math.max(0, segundos)
}

/** El "dónde" del evento, que no es el mismo texto que el de la pantalla: acá
 *  entra tal cual en el mapa del teléfono, así que va la dirección pelada. */
function locationOf(booking: BookingEventSource): string | null {
  if (booking.modality === ServiceModality.at_home) return booking.serviceAddress
  if (booking.modality === ServiceModality.online) return 'Videollamada'
  // En el local: la dirección si está, y si no el nombre — un evento sin lugar
  // se ve incompleto, y el nombre del negocio al menos ubica a quien lo lee.
  return booking.business.addressText ?? booking.business.name
}

function titleOf(booking: BookingEventSource): string {
  // "en" cuando la clienta va a algún lado, "con" cuando no se mueve.
  const preposicion = booking.modality === ServiceModality.on_site ? 'en' : 'con'
  return `${booking.service.name} ${preposicion} ${booking.business.name}`
}

export function buildBookingCalendarEvent(booking: BookingEventSource): BookingCalendarEvent {
  // Sólo si es navegable: la escribe la dueña y acá termina como link en el
  // calendario de la clienta. Ver el comentario de `linkNavegable`.
  const meetingUrl = booking.meetingUrl ? linkNavegable(booking.meetingUrl) : null
  const confirmationUrl = getBookingConfirmationUrl(booking.business, booking.id)

  const description = [
    `Reserva ${formatBookingNumber(booking.bookingNumber, booking.id)} en ${booking.business.name}.`,
    ...(booking.professional ? [`Te atiende: ${booking.professional.name}`] : []),
    ...(meetingUrl ? [`Videollamada: ${meetingUrl}`] : []),
    `Ver tu reserva: ${confirmationUrl}`,
  ].join('\n')

  return {
    uid: `${booking.id}@${UID_DOMAIN}`,
    title: titleOf(booking),
    start: booking.startDateTime,
    end: booking.endDateTime,
    location: locationOf(booking),
    url: meetingUrl,
    description,
    sequence: sequenceOf(booking),
    stamp: booking.updatedAt,
  }
}

/** Nombre del archivo que ve la clienta cuando lo baja o lo recibe adjunto. */
export function bookingIcsFilename(booking: Pick<BookingEventSource, 'id' | 'bookingNumber'>): string {
  // Sin '#': hay clientes de correo que rompen el nombre del adjunto ahí.
  const ref = formatBookingNumber(booking.bookingNumber, booking.id).replace(/^#/, '')
  return `reserva-${ref}.ics`
}
