/**
 * Serializa un evento a iCalendar (RFC 5545), que es lo que entiende el botón
 * "agregar al calendario" de cualquier teléfono.
 *
 * Escrito a mano y no con una librería porque son cuarenta líneas y el formato
 * no se mueve desde 1998; lo que sí muerde son tres detalles que una librería
 * traería resueltos y hay que respetar igual: fin de línea CRLF, plegado a 75
 * OCTETOS (no caracteres) y escapado de `;` `,` `\` en los campos de texto.
 */
import type { BookingCalendarEvent } from './booking-event'

const CRLF = '\r\n'
const MAX_OCTETS = 75

/** Formato UTC de RFC 5545: `20260731T173000Z`. Todo va en UTC a propósito —
 *  así el archivo no necesita declarar un VTIMEZONE ni depender de que el
 *  cliente de calendario tenga la base de zonas al día. */
function utcStamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`
}

/** Escapado de los campos TEXT. El orden importa: la barra primero, o se
 *  re-escaparían las barras que agregan los otros reemplazos. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/([;,])/g, '\\$1')
}

const encoder = new TextEncoder()

/**
 * Plegado de líneas largas: máximo 75 octetos, y las continuaciones arrancan con
 * un espacio. Se corta por punto de código y se mide en bytes UTF-8 porque una
 * "ñ" o un emoji ocupan más de uno, y partir un carácter al medio deja el
 * archivo ilegible para el cliente que lo abre.
 */
function fold(line: string): string {
  if (encoder.encode(line).length <= MAX_OCTETS) return line

  const chunks: string[] = []
  let current = ''
  let octets = 0

  for (const char of line) {
    const size = encoder.encode(char).length
    // La primera línea usa los 75; las siguientes gastan uno en el espacio.
    const limit = chunks.length === 0 ? MAX_OCTETS : MAX_OCTETS - 1
    if (octets + size > limit) {
      chunks.push(current)
      current = ''
      octets = 0
    }
    current += char
    octets += size
  }
  chunks.push(current)

  return chunks.join(`${CRLF} `)
}

export function buildIcs(event: BookingCalendarEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Agendita//Reservas//ES',
    'CALSCALE:GREGORIAN',
    // PUBLISH y no REQUEST: esto es "acá tenés tu cita", no una invitación que
    // pide respuesta. Con REQUEST el mail muestra botones de Sí/No/Quizás sobre
    // algo que la clienta ya reservó, y las respuestas no las lee nadie.
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${event.uid}`,
    `DTSTAMP:${utcStamp(event.stamp)}`,
    `DTSTART:${utcStamp(event.start)}`,
    `DTEND:${utcStamp(event.end)}`,
    `SEQUENCE:${event.sequence}`,
    `STATUS:${event.status}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(event.description)}`,
    ...(event.location ? [`LOCATION:${escapeText(event.location)}`] : []),
    // URL es de tipo URI: no lleva el escapado de TEXT.
    ...(event.url ? [`URL:${event.url}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]

  // El archivo termina con CRLF: RFC 5545 pide que cada línea de contenido lo
  // tenga, incluida la última.
  return `${lines.map(fold).join(CRLF)}${CRLF}`
}

/**
 * Link de "agregar a Google Calendar". Es el camino de la computadora: en el
 * escritorio un `.ics` se baja como archivo y hay que importarlo a mano, y este
 * link abre el evento ya cargado.
 */
export function buildGoogleCalendarUrl(event: BookingCalendarEvent): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: event.title,
    dates: `${utcStamp(event.start)}/${utcStamp(event.end)}`,
    details: event.description,
  })
  if (event.location) params.set('location', event.location)

  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
