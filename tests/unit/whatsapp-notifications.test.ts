import { describe, it, expect } from 'vitest'
import { ServiceModality } from '@prisma/client'
import {
  buildBookingConfirmationWhatsappMessage,
  buildBookingRescheduledWhatsappMessage,
  buildBookingRescheduledWhatsappUrl,
  buildWhatsappBookingSummaryText,
  buildWhatsappReminderMessage,
  buildWhatsappReminderUrl,
} from '@/lib/notifications/whatsapp'

const baseData = {
  customerName: 'Maria',
  customerPhone: '56912345678',
  serviceName: 'Manicure',
  professionalName: null,
  startDateTime: new Date('2026-06-15T14:00:00-04:00'),
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  totalPrice: 20000,
  depositPaid: 5000,
  remainingBalance: 15000,
  modality: ServiceModality.on_site,
  businessAddress: 'Av. Principal 123',
}

describe('buildWhatsappReminderMessage', () => {
  it('includes date, time and service name', () => {
    const msg = buildWhatsappReminderMessage(baseData)

    expect(msg).toContain('Maria')
    expect(msg).toContain('Manicure')
    expect(msg).toContain('junio')
  })

  it('includes remaining balance when > 0', () => {
    const msg = buildWhatsappReminderMessage(baseData)

    expect(msg).toContain('Saldo pendiente')
    expect(msg).toContain('15.000')
  })

  it('omits remaining balance when 0', () => {
    const msg = buildWhatsappReminderMessage({
      ...baseData,
      depositPaid: 20000,
      remainingBalance: 0,
    })

    expect(msg).not.toContain('Saldo pendiente')
  })

  it('includes business address when available', () => {
    const msg = buildWhatsappReminderMessage(baseData)

    expect(msg).toContain('Av. Principal 123')
  })

  it('omits business address when null', () => {
    const msg = buildWhatsappReminderMessage({
      ...baseData,
      businessAddress: null,
    })

    expect(msg).not.toContain('Dirección')
  })

  it('includes price and deposit info', () => {
    const msg = buildWhatsappReminderMessage(baseData)

    expect(msg).toContain('20.000')
    expect(msg).toContain('5.000')
  })
})

// El bug que cierra este archivo: los mensajes imprimían la dirección del LOCAL
// también en citas a domicilio u online. El "dónde" ahora sale de whereRows —
// las mismas filas que el mail y las pantallas de confirmación.
describe('el dónde según la modalidad (whereRows, no la dirección plana)', () => {
  const domicilio = {
    ...baseData,
    modality: ServiceModality.at_home,
    serviceAddress: 'Los Olmos 12',
  }
  const online = {
    ...baseData,
    modality: ServiceModality.online,
    meetingUrl: 'https://meet.example/sala',
  }

  it('a domicilio: la dirección de la clienta, nunca la del local', () => {
    for (const build of [buildWhatsappReminderMessage, buildBookingConfirmationWhatsappMessage]) {
      const msg = build(domicilio)
      expect(msg).toContain('A domicilio')
      expect(msg).toContain('Los Olmos 12')
      expect(msg).not.toContain('Av. Principal 123')
    }
  })

  it('online: el link, nunca la dirección del local', () => {
    for (const build of [buildWhatsappReminderMessage, buildBookingConfirmationWhatsappMessage]) {
      const msg = build(online)
      expect(msg).toContain('Online')
      expect(msg).toContain('https://meet.example/sala')
      expect(msg).not.toContain('Av. Principal 123')
    }
  })

  it('online sin link fijo: avisa que se lo mandamos antes de la cita', () => {
    const msg = buildWhatsappReminderMessage({ ...online, meetingUrl: null })
    expect(msg).toContain('Te lo enviamos antes de la cita')
    expect(msg).not.toContain('Av. Principal 123')
  })

  it('en el local: la dirección del negocio, como siempre', () => {
    const msg = buildBookingConfirmationWhatsappMessage(baseData)
    expect(msg).toContain('Dirección: Av. Principal 123')
  })
})

describe('buildWhatsappBookingSummaryText (resumen para la dueña)', () => {
  it('a domicilio dice a dónde va: la dirección de la clienta', () => {
    const txt = buildWhatsappBookingSummaryText({
      ...baseData,
      modality: ServiceModality.at_home,
      serviceAddress: 'Los Olmos 12',
    })
    expect(txt).toContain('A domicilio: Los Olmos 12')
    expect(txt).not.toContain('Av. Principal 123')
  })

  it('en el local no repite su propia dirección', () => {
    const txt = buildWhatsappBookingSummaryText(baseData)
    expect(txt).not.toContain('Av. Principal 123')
    expect(txt).toContain('Reserva creada para Maria')
  })
})

describe('buildWhatsappReminderUrl', () => {
  it('generates valid wa.me URL', () => {
    const url = buildWhatsappReminderUrl('56912345678', baseData)

    expect(url).toContain('https://wa.me/56912345678')
    expect(url).toContain('?text=')
  })

  it('encoded message is decodable and contains key info', () => {
    const url = buildWhatsappReminderUrl('56912345678', baseData)
    const decoded = decodeURIComponent(url.split('?text=')[1])

    expect(decoded).toContain('Maria')
    expect(decoded).toContain('Manicure')
    expect(decoded).toContain('junio')
  })

  it('sanitizes phone number', () => {
    const url = buildWhatsappReminderUrl('+56 9 1234 5678', baseData)

    expect(url).toContain('https://wa.me/56912345678')
    expect(url).not.toContain('+')
    expect(url).not.toContain(' ')
  })

  it('generates URL when remaining balance is 0', () => {
    const url = buildWhatsappReminderUrl('56912345678', {
      ...baseData,
      depositPaid: 20000,
      remainingBalance: 0,
    })

    const decoded = decodeURIComponent(url.split('?text=')[1])
    expect(decoded).not.toContain('Saldo pendiente')
  })
})

describe('buildBookingRescheduledWhatsappUrl', () => {
  it('generates a prefilled reschedule message with old and new date', () => {
    const url = buildBookingRescheduledWhatsappUrl('56912345678', {
      customerName: 'Maria',
      serviceName: 'Manicure',
      professionalName: null,
      previousStartDateTime: new Date('2026-06-15T14:00:00-04:00'),
      newStartDateTime: new Date('2026-06-16T15:30:00-04:00'),
      businessTimezone: 'America/Santiago',
      modality: ServiceModality.on_site,
      businessAddress: 'Av. Principal 123',
    })

    const decoded = decodeURIComponent(url.split('?text=')[1])
    expect(url).toContain('https://wa.me/56912345678')
    expect(decoded).toContain('Maria')
    expect(decoded).toContain('Manicure')
    expect(decoded).toContain('Horario anterior')
    expect(decoded).toContain('Nuevo horario')
    expect(decoded).toContain('Av. Principal 123')
  })
})

describe('buildBookingRescheduledWhatsappMessage', () => {
  it('omits business address when unavailable', () => {
    const message = buildBookingRescheduledWhatsappMessage({
      customerName: 'Maria',
      serviceName: 'Manicure',
      professionalName: null,
      previousStartDateTime: new Date('2026-06-15T14:00:00-04:00'),
      newStartDateTime: new Date('2026-06-16T15:30:00-04:00'),
      businessTimezone: 'America/Santiago',
      modality: ServiceModality.on_site,
      businessAddress: null,
    })

    expect(message).not.toContain('Dirección')
  })

  it('a domicilio manda la dirección de la clienta, no la del local', () => {
    const message = buildBookingRescheduledWhatsappMessage({
      customerName: 'Maria',
      serviceName: 'Manicure',
      professionalName: null,
      previousStartDateTime: new Date('2026-06-15T14:00:00-04:00'),
      newStartDateTime: new Date('2026-06-16T15:30:00-04:00'),
      businessTimezone: 'America/Santiago',
      modality: ServiceModality.at_home,
      serviceAddress: 'Los Olmos 12',
      businessAddress: 'Av. Principal 123',
    })

    expect(message).toContain('Los Olmos 12')
    expect(message).not.toContain('Av. Principal 123')
  })
})

// El nombre del fixture NO es substring de ningún otro dato del mensaje
// (aprendido en el PR H: 'Juan' matcheaba 'ClientaDeJuan' y el test no podía
// fallar). "atiende" tampoco aparece en ninguna otra línea de los builders.
describe('quién atiende en los mensajes de whatsapp', () => {
  const conPersona = { ...baseData, professionalName: 'RaulBarbero' }

  it.each([
    ['confirmación', buildBookingConfirmationWhatsappMessage, 'Te atiende: RaulBarbero'],
    ['recordatorio', buildWhatsappReminderMessage, 'Te atiende: RaulBarbero'],
    ['resumen para el negocio', buildWhatsappBookingSummaryText, 'Atiende: RaulBarbero'],
  ])('%s nombra a la persona cuando la reserva la tiene', (_name, builder, expected) => {
    expect(builder(conPersona)).toContain(expected)
  })

  it.each([
    ['confirmación', buildBookingConfirmationWhatsappMessage],
    ['recordatorio', buildWhatsappReminderMessage],
    ['resumen para el negocio', buildWhatsappBookingSummaryText],
  ])('%s no dibuja la línea sin persona', (_name, builder) => {
    expect(builder(baseData)).not.toContain('atiende')
  })

  it('la reprogramación nombra a la persona, que se conserva al mover la hora', () => {
    const message = buildBookingRescheduledWhatsappMessage({
      customerName: 'Maria',
      serviceName: 'Manicure',
      professionalName: 'RaulBarbero',
      previousStartDateTime: new Date('2026-06-15T14:00:00-04:00'),
      newStartDateTime: new Date('2026-06-16T15:30:00-04:00'),
      businessTimezone: 'America/Santiago',
      modality: ServiceModality.on_site,
      businessAddress: null,
    })

    expect(message).toContain('Te atiende: RaulBarbero')
  })
})
