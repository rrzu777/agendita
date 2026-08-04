import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { BookingStatus, ServiceModality } from '@prisma/client'

/**
 * El tramo de plomería que los tests de `createBooking` no ven: ellos mockean
 * los senders, así que nada verifica que `fireBookingNotifications` pase la
 * persona de la fila a los DOS emails y al evento de calendario. Acá se llama
 * directo, con los senders mockeados y el `.ics` real.
 */

const mockReceived = vi.fn().mockResolvedValue({ success: true })
const mockBusinessNotif = vi.fn().mockResolvedValue([{ success: true }])
vi.mock('@/lib/notifications', () => ({
  sendBookingReceivedToCustomer: (...args: unknown[]) => mockReceived(...args),
  sendNewBookingNotificationToBusiness: (...args: unknown[]) => mockBusinessNotif(...args),
  sendNotificationSafely: (_label: string, fn: () => Promise<unknown>) => fn(),
  sendMultiNotificationSafely: (_label: string, fn: () => Promise<unknown>) => fn(),
  getBusinessReplyToEmail: vi.fn().mockResolvedValue('owner@barberia.cl'),
}))

const { fireBookingNotifications } = await import('@/lib/bookings/notifications')

const business = {
  name: 'Barbería Carlos',
  timezone: 'America/Santiago',
  whatsapp: '+56912345678',
  addressText: 'Santa Isabel 0120',
  currency: 'CLP',
  cancellationPolicy: null,
  slug: 'barberia-carlos',
  subdomain: null,
  category: 'barber' as const,
}

function makeBooking(professional: { name: string } | null) {
  return {
    id: 'booking-1',
    businessId: 'biz-1',
    bookingNumber: 4738,
    customer: { name: 'Maria', phone: '+56987654321', email: 'maria@example.com' },
    startDateTime: new Date('2026-08-15T18:00:00Z'),
    endDateTime: new Date('2026-08-15T18:45:00Z'),
    createdAt: new Date('2026-08-01T12:00:00Z'),
    updatedAt: new Date('2026-08-01T12:00:00Z'),
    totalPrice: 15000,
    discountAmount: 0,
    finalAmount: 15000,
    depositRequired: 0,
    depositPaid: 0,
    remainingBalance: 15000,
    paymentMethod: null,
    holdExpiresAt: null,
    status: BookingStatus.confirmed,
    modality: ServiceModality.on_site,
    serviceAddress: null,
    meetingUrl: null,
    professional,
  }
}

describe('fireBookingNotifications y la persona', () => {
  beforeEach(() => {
    mockReceived.mockClear()
    mockBusinessNotif.mockClear()
  })

  it('el nombre viaja en el email a la clienta, en el aviso al negocio y en el .ics', async () => {
    await fireBookingNotifications(business, makeBooking({ name: 'Juan Pérez' }), 'Corte de pelo', null)

    expect(mockReceived).toHaveBeenCalledWith(
      expect.objectContaining({ professionalName: 'Juan Pérez' }),
    )
    expect(mockBusinessNotif).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ professionalName: 'Juan Pérez' }),
    )
    // El .ics es real (sólo los senders están mockeados): la descripción del
    // evento también dice quién atiende.
    const { calendar } = mockReceived.mock.calls[0][0] as { calendar: { ics: string } }
    expect(calendar.ics).toContain('Te atiende: Juan Pérez')
  })

  it('sin persona asignada los dos emails van sin nombre y el .ics no menciona a nadie', async () => {
    await fireBookingNotifications(business, makeBooking(null), 'Corte de pelo', null)

    expect(mockReceived).toHaveBeenCalledWith(
      expect.objectContaining({ professionalName: null }),
    )
    expect(mockBusinessNotif).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({ professionalName: null }),
    )
    const { calendar } = mockReceived.mock.calls[0][0] as { calendar: { ics: string } }
    expect(calendar.ics).not.toContain('Te atiende')
  })
})

// Coordinación manual: la promesa ("el negocio te contacta") y la ventana
// tienen que viajar en LOS DOS emails — sin esto la clienta cree que debe
// pagar algo que no puede, y la dueña no sabe que la reserva expira sola.
describe('fireBookingNotifications y la coordinación manual', () => {
  beforeEach(() => {
    mockReceived.mockClear()
    mockBusinessNotif.mockClear()
    // El plazo se mide contra AHORA y contra la cita, así que sin un reloj fijo
    // estos casos dependen del día en que corra la suite: con el reloj real, un
    // `holdExpiresAt` de agosto deja de prometer nada en septiembre y el mail
    // pasa a mandar `deadline: null` sin que nadie haya tocado el código.
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-03T12:00:00Z'))
  })
  afterEach(() => { vi.useRealTimers() })

  function manualBooking() {
    return {
      ...makeBooking(null),
      status: BookingStatus.pending_payment,
      paymentMethod: 'manual',
      depositRequired: 5000,
      holdExpiresAt: new Date('2026-08-04T12:00:00Z'),
    }
  }

  it('la clienta recibe la promesa con el plazo y la dueña el pedido de confirmar', async () => {
    await fireBookingNotifications(business, manualBooking(), 'Corte de pelo', null)

    expect(mockReceived).toHaveBeenCalledWith(
      expect.objectContaining({
        manualCoordination: { deadline: { cap: 'window', at: new Date('2026-08-04T12:00:00Z') } },
      }),
    )
    const { paymentNote } = mockBusinessNotif.mock.calls[0][1] as { paymentNote: string }
    expect(paymentNote).toContain('coordinás directamente')
    expect(paymentNote).toContain('Confirmá la reserva antes de que venza')
  })

  it('con el plazo topado por la cita, a la dueña se le dice "la cita" y no "tu cita"', async () => {
    // La ventana de 24h cae después del turno, así que el techo es la cita. El
    // aviso va AL NEGOCIO: es la cita de otra persona.
    await fireBookingNotifications(
      business,
      { ...manualBooking(), holdExpiresAt: new Date('2026-08-16T12:00:00Z') },
      'Corte de pelo',
      null,
    )

    expect(mockReceived).toHaveBeenCalledWith(
      expect.objectContaining({ manualCoordination: { deadline: { cap: 'appointment' } } }),
    )
    const { paymentNote } = mockBusinessNotif.mock.calls[0][1] as { paymentNote: string }
    expect(paymentNote).toContain('el horario queda guardado hasta la cita')
    expect(paymentNote).not.toContain('tu cita')
  })

  it('una reserva común no lleva nada de coordinación manual', async () => {
    await fireBookingNotifications(business, makeBooking(null), 'Corte de pelo', null)

    expect(mockReceived).toHaveBeenCalledWith(
      expect.objectContaining({ manualCoordination: undefined }),
    )
    expect(mockBusinessNotif.mock.calls[0][1].paymentNote).toBeUndefined()
  })
})
