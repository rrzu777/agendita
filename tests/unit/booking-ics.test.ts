import { describe, it, expect } from 'vitest'
import { ServiceModality } from '@prisma/client'
import { buildBookingCalendarEvent, bookingIcsFilename, type BookingEventSource } from '@/lib/calendar/booking-event'
import { buildIcs, buildGoogleCalendarUrl } from '@/lib/calendar/ics'

const base: BookingEventSource = {
  id: 'clbooking123',
  bookingNumber: 4738,
  // 14:30 en Santiago (UTC-4 en agosto).
  startDateTime: new Date('2026-08-01T18:30:00Z'),
  endDateTime: new Date('2026-08-01T19:15:00Z'),
  createdAt: new Date('2026-07-20T10:00:00Z'),
  updatedAt: new Date('2026-07-20T10:00:00Z'),
  modality: ServiceModality.on_site,
  serviceAddress: null,
  meetingUrl: null,
  service: { name: 'Corte de pelo' },
  business: { name: 'Barbería Carlos', slug: 'barberia-carlos', subdomain: null, addressText: 'Santa Isabel 0120, Providencia' },
}

function ics(overrides: Partial<BookingEventSource> = {}): string {
  return buildIcs(buildBookingCalendarEvent({ ...base, ...overrides }))
}

/** Las líneas ya desplegadas: deshace el plegado para poder buscar un campo entero. */
function unfold(text: string): string[] {
  return text.replace(/\r\n /g, '').split('\r\n').filter(Boolean)
}

describe('el .ics de una reserva', () => {
  it('arma un VEVENT con las horas en UTC', () => {
    const lines = unfold(ics())
    expect(lines[0]).toBe('BEGIN:VCALENDAR')
    expect(lines).toContain('DTSTART:20260801T183000Z')
    expect(lines).toContain('DTEND:20260801T191500Z')
    expect(lines).toContain('SUMMARY:Corte de pelo en Barbería Carlos')
    expect(lines).toContain('LOCATION:Santa Isabel 0120\\, Providencia')
    expect(lines.at(-1)).toBe('END:VCALENDAR')
  })

  it('todas las líneas terminan en CRLF, incluida la última', () => {
    const text = ics()
    expect(text.endsWith('\r\n')).toBe(true)
    // Ni un solo \n suelto: hay clientes que rechazan el archivo entero.
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
  })

  it('el UID no depende del entorno y es el mismo en cada versión del evento', () => {
    expect(unfold(ics())).toContain('UID:clbooking123@agendita.cl')
    expect(unfold(ics({ startDateTime: new Date('2026-09-09T18:30:00Z') }))).toContain('UID:clbooking123@agendita.cl')
  })

  // Un evento reprogramado tiene que PISAR al anterior, no sumarse: para eso el
  // cliente de calendario mira el UID y se queda con el SEQUENCE más alto.
  it('el SEQUENCE crece cuando la reserva se modifica', () => {
    expect(unfold(ics())).toContain('SEQUENCE:0')
    const modificada = unfold(ics({ updatedAt: new Date('2026-07-20T10:01:40Z') }))
    expect(modificada).toContain('SEQUENCE:100')
  })

  it('escapa las comas, los punto y coma y las barras del texto', () => {
    const lines = unfold(ics({ service: { name: 'Corte, barba; y color \\ extra' } }))
    expect(lines).toContain('SUMMARY:Corte\\, barba\\; y color \\\\ extra en Barbería Carlos')
  })

  it('los saltos de línea de la descripción viajan como \\n, no parten la línea', () => {
    const descripcion = unfold(ics()).find((l) => l.startsWith('DESCRIPTION:'))
    expect(descripcion).toContain('Reserva #4738 en Barbería Carlos.\\n')
    expect(descripcion).toContain('Ver tu reserva: http://localhost:3000/b/barberia-carlos/book/confirmation?bookingId=clbooking123')
  })

  it('pliega las líneas largas a 75 octetos sin partir un carácter al medio', () => {
    const text = ics({ service: { name: 'Tratamiento capilar con keratina brasileña y masaje ñañá'.repeat(3) } })
    for (const linea of text.split('\r\n')) {
      expect(new TextEncoder().encode(linea).length).toBeLessThanOrEqual(75)
    }
    // Y al desplegarlo vuelve a leerse entero.
    expect(unfold(text).find((l) => l.startsWith('SUMMARY:'))).toContain('masaje ñañá')
  })

  it('a domicilio el lugar es la dirección de la clienta', () => {
    const lines = unfold(ics({ modality: ServiceModality.at_home, serviceAddress: 'Los Leones 55, dpto 3' }))
    expect(lines).toContain('LOCATION:Los Leones 55\\, dpto 3')
    expect(lines).toContain('SUMMARY:Corte de pelo con Barbería Carlos')
  })

  it('online el lugar es la videollamada y el link va como URL', () => {
    const lines = unfold(ics({ modality: ServiceModality.online, meetingUrl: 'https://meet.example/sala' }))
    expect(lines).toContain('LOCATION:Videollamada')
    expect(lines).toContain('URL:https://meet.example/sala')
  })

  // Mismo cerrojo que en la pantalla: el link lo escribe la dueña y las filas
  // viejas se guardaron sin validación de esquema.
  it('un link de sala que no es http no entra al archivo', () => {
    const text = ics({ modality: ServiceModality.online, meetingUrl: 'javascript:alert(1)' })
    expect(text).not.toContain('javascript:')
  })

  it('sin dirección cargada no inventa un lugar vacío', () => {
    const lines = unfold(ics({ business: { ...base.business, addressText: null } }))
    expect(lines).toContain('LOCATION:Barbería Carlos')
  })

  it('el nombre del archivo lleva el número de reserva sin el #', () => {
    expect(bookingIcsFilename(base)).toBe('reserva-4738.ics')
    expect(bookingIcsFilename({ id: 'clbooking123', bookingNumber: null })).toBe('reserva-clbookin.ics')
  })
})

describe('el link de Google Calendar', () => {
  it('lleva el título, las fechas en UTC y el lugar', () => {
    const url = new URL(buildGoogleCalendarUrl(buildBookingCalendarEvent(base)))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('Corte de pelo en Barbería Carlos')
    expect(url.searchParams.get('dates')).toBe('20260801T183000Z/20260801T191500Z')
    expect(url.searchParams.get('location')).toBe('Santa Isabel 0120, Providencia')
    expect(url.searchParams.get('details')).toContain('Reserva #4738')
  })
})
