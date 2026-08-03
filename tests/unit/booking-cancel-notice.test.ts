import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BookingStatus, ServiceModality } from '@prisma/client'

const mockFindUnique = vi.fn()
vi.mock('@/lib/db', () => ({
  prisma: { booking: { findUnique: mockFindUnique } },
}))

const { loadBookingCancelNotice } = await import('@/lib/calendar/booking-invite')

const row = {
  id: 'clbooking123',
  bookingNumber: 4738,
  status: BookingStatus.cancelled,
  startDateTime: new Date('2026-08-01T18:30:00Z'),
  endDateTime: new Date('2026-08-01T19:15:00Z'),
  createdAt: new Date('2026-07-20T10:00:00Z'),
  // La cancelación acaba de mover updatedAt: de acá sale el SEQUENCE que pisa.
  updatedAt: new Date('2026-07-25T09:00:00Z'),
  modality: ServiceModality.on_site,
  serviceAddress: null,
  meetingUrl: null,
  service: { name: 'Corte de pelo' },
  professional: null,
  business: { name: 'Barbería Carlos', slug: 'barberia-carlos', subdomain: null, addressText: 'Santa Isabel 0120' },
}

describe('loadBookingCancelNotice', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindUnique.mockResolvedValue(row)
  })

  it('reserva que estaba confirmada → el aviso que pisa al evento por UID', async () => {
    const notice = await loadBookingCancelNotice('clbooking123', BookingStatus.confirmed)
    expect(notice).not.toBeNull()
    expect(notice!.filename).toBe('reserva-4738.ics')
    expect(notice!.ics).toContain('UID:clbooking123@agendita.cl')
    expect(notice!.ics).toContain('STATUS:CANCELLED')
  })

  // A quien nunca se le mandó el .ics (la reserva nunca estuvo confirmada) no
  // hay nada que borrarle: ni archivo ni query.
  it.each([
    BookingStatus.pending_payment,
    BookingStatus.pending_confirmation,
  ])('reserva que era %s → null sin tocar la base', async (previo) => {
    const notice = await loadBookingCancelNotice('clbooking123', previo)
    expect(notice).toBeNull()
    expect(mockFindUnique).not.toHaveBeenCalled()
  })

  it('reserva borrada entre el cancel y la carga → null', async () => {
    mockFindUnique.mockResolvedValue(null)
    expect(await loadBookingCancelNotice('nope', BookingStatus.confirmed)).toBeNull()
  })
})
