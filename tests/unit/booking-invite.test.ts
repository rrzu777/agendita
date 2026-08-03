import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus, ServiceModality } from '@prisma/client'

const findUnique = vi.fn()
vi.mock('@/lib/db', () => ({ prisma: { booking: { findUnique } } }))

const { loadBookingInvite } = await import('@/lib/calendar/booking-invite')

const reserva = {
  id: 'clbooking123',
  bookingNumber: 4738,
  status: BookingStatus.confirmed,
  startDateTime: new Date('2026-08-01T18:30:00Z'),
  endDateTime: new Date('2026-08-01T19:15:00Z'),
  createdAt: new Date('2026-07-20T10:00:00Z'),
  updatedAt: new Date('2026-07-20T10:00:00Z'),
  modality: ServiceModality.on_site,
  serviceAddress: null,
  meetingUrl: null,
  service: { name: 'Corte de pelo' },
  professional: null,
  business: { name: 'Barbería Carlos', slug: 'barberia-carlos', subdomain: null, addressText: 'Santa Isabel 0120' },
}

beforeEach(() => {
  findUnique.mockReset()
})

describe('loadBookingInvite', () => {
  it('devuelve el archivo, el nombre y la URL de una reserva confirmada', async () => {
    findUnique.mockResolvedValue(reserva)

    const encontrada = await loadBookingInvite('clbooking123')

    expect(encontrada?.invite?.filename).toBe('reserva-4738.ics')
    expect(encontrada?.invite?.ics).toContain('BEGIN:VEVENT')
    expect(encontrada?.invite?.url).toBe('http://localhost:3000/api/bookings/clbooking123/calendar')
  })

  // El select se asserta directo: con Prisma mockeado, mirar el `.ics` de
  // salida no prueba que la consulta haya pedido la relación — y sin ella el
  // adjunto de una reprogramación y el archivo de la ruta perderían el "Te
  // atiende" en silencio.
  it('pide a la persona en el select y la descripción dice quién atiende', async () => {
    findUnique.mockResolvedValue({ ...reserva, professional: { name: 'Juan Pérez' } })

    const encontrada = await loadBookingInvite('clbooking123')

    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ professional: { select: { name: true } } }),
      }),
    )
    expect(encontrada?.invite?.ics).toContain('Te atiende: Juan Pérez')
  })

  it('no existe la reserva: null', async () => {
    findUnique.mockResolvedValue(null)
    expect(await loadBookingInvite('no-existe')).toBeNull()
  })

  // El gate que comparten la ruta y los mails. Una cita que todavía puede caerse
  // no puede terminar en el calendario de la clienta: el evento queda ahí para
  // siempre aunque el horario se libere, y nadie lo va a borrar.
  it.each([
    BookingStatus.pending_payment,
    BookingStatus.pending_confirmation,
    BookingStatus.cancelled,
    BookingStatus.expired,
    BookingStatus.completed,
  ])('reserva en %s: sin evento, pero con adónde mandarla', async (status) => {
    findUnique.mockResolvedValue({ ...reserva, status })

    const encontrada = await loadBookingInvite('clbooking123')

    // La reserva EXISTE: no es lo mismo que un id inventado. El link del mail
    // vive para siempre, y quien lo toca con la reserva ya cumplida tiene que
    // caer en su pantalla, no en un "no encontramos esa reserva".
    expect(encontrada?.invite).toBeNull()
    expect(encontrada?.confirmationUrl).toBe(
      'http://localhost:3000/b/barberia-carlos/book/confirmation?bookingId=clbooking123',
    )
  })
})
