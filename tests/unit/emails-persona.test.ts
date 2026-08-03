import { describe, it, expect } from 'vitest'
import {
  bookingConfirmationCustomerHtml,
  bookingConfirmationCustomerText,
  bookingReceivedCustomerHtml,
  bookingReceivedCustomerText,
  bookingRescheduledCustomerHtml,
  bookingRescheduledCustomerText,
  bookingReminderHtml,
  bookingReminderText,
  newBookingBusinessHtml,
  newBookingBusinessText,
  ownerBookingChangedHtml,
  ownerBookingChangedText,
} from '@/lib/notifications/templates'
import type {
  BookingEmailData,
  ReminderEmailData,
  RescheduledEmailData,
  NewBookingBusinessEmailData,
  OwnerBookingChangedData,
} from '@/lib/notifications/types'

/**
 * La fila "quién atiende" en los seis emails de una cita.
 *
 * El contrato es el mismo en todos: con `professionalName` aparece la fila
 * ("Te atiende" a la clienta, "Atiende" al negocio); sin él no aparece NI el
 * label — una reserva sin persona asignada (negocio sin equipo, o anterior al
 * track 5) no tiene nada honesto que poner ahí.
 */

const bookingData: BookingEmailData = {
  businessName: 'Barbería Carlos',
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  customerName: 'Maria',
  customerEmail: 'maria@example.com',
  customerPhone: '+56987654321',
  serviceName: 'Corte de pelo',
  startDateTime: new Date('2026-08-15T18:00:00Z'),
  totalPrice: 15000,
  depositRequired: 5000,
  depositPaid: 5000,
  remainingBalance: 10000,
}

const reminderData: ReminderEmailData = {
  businessName: 'Barbería Carlos',
  customerName: 'Maria',
  customerEmail: 'maria@example.com',
  serviceName: 'Corte de pelo',
  startDateTime: new Date('2026-08-15T18:00:00Z'),
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  totalPrice: 15000,
  remainingBalance: 10000,
  depositPaid: 5000,
}

const rescheduleData: RescheduledEmailData = {
  businessName: 'Barbería Carlos',
  businessTimezone: 'America/Santiago',
  customerName: 'Maria',
  customerEmail: 'maria@example.com',
  customerPhone: '+56987654321',
  serviceName: 'Corte de pelo',
  previousStartDateTime: new Date('2026-08-15T18:00:00Z'),
  newStartDateTime: new Date('2026-08-16T19:30:00Z'),
}

const businessData: NewBookingBusinessEmailData = {
  businessCategory: 'barber',
  businessName: 'Barbería Carlos',
  customerName: 'Maria',
  customerPhone: '+56987654321',
  customerEmail: 'maria@example.com',
  serviceName: 'Corte de pelo',
  startDateTime: new Date('2026-08-15T18:00:00Z'),
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  depositRequired: 5000,
  remainingBalance: 10000,
  dashboardLink: 'https://agendita.app/dashboard/bookings',
}

const ownerChangedData: OwnerBookingChangedData = {
  businessCategory: 'barber',
  businessId: 'biz1',
  businessName: 'Barbería Carlos',
  businessTimezone: 'America/Santiago',
  customerName: 'Maria',
  serviceName: 'Corte de pelo',
  bookingNumber: 4738,
  change: { kind: 'cancelled' },
  startDateTime: new Date('2026-08-15T18:00:00Z'),
}

// [render, data, label] de cada template: el mismo contrato se verifica en todos.
const surfaces: [string, (name?: string) => string, string][] = [
  ['bookingConfirmationCustomerHtml', (n) => bookingConfirmationCustomerHtml({ ...bookingData, professionalName: n }), 'Te atiende'],
  ['bookingConfirmationCustomerText', (n) => bookingConfirmationCustomerText({ ...bookingData, professionalName: n }), 'Te atiende'],
  ['bookingReceivedCustomerHtml', (n) => bookingReceivedCustomerHtml({ ...bookingData, professionalName: n }), 'Te atiende'],
  ['bookingReceivedCustomerText', (n) => bookingReceivedCustomerText({ ...bookingData, professionalName: n }), 'Te atiende'],
  ['bookingReminderHtml', (n) => bookingReminderHtml({ ...reminderData, professionalName: n }), 'Te atiende'],
  ['bookingReminderText', (n) => bookingReminderText({ ...reminderData, professionalName: n }), 'Te atiende'],
  ['bookingRescheduledCustomerHtml', (n) => bookingRescheduledCustomerHtml({ ...rescheduleData, professionalName: n }), 'Te atiende'],
  ['bookingRescheduledCustomerText', (n) => bookingRescheduledCustomerText({ ...rescheduleData, professionalName: n }), 'Te atiende'],
  ['newBookingBusinessHtml', (n) => newBookingBusinessHtml({ ...businessData, professionalName: n }), 'Atiende'],
  ['newBookingBusinessText', (n) => newBookingBusinessText({ ...businessData, professionalName: n }), 'Atiende'],
  ['ownerBookingChangedHtml', (n) => ownerBookingChangedHtml({ ...ownerChangedData, professionalName: n }), 'Atiende'],
  ['ownerBookingChangedText', (n) => ownerBookingChangedText({ ...ownerChangedData, professionalName: n }), 'Atiende'],
]

describe.each(surfaces)('%s', (_name, render, label) => {
  it('con persona muestra la fila con el nombre', () => {
    const out = render('Juan Pérez')
    expect(out).toContain(label)
    expect(out).toContain('Juan Pérez')
  })

  it('sin persona no muestra ni el label', () => {
    expect(render(undefined)).not.toContain(label)
  })
})

describe('escape del nombre', () => {
  it('los templates HTML escapan el nombre de la persona', () => {
    const html = bookingReceivedCustomerHtml({ ...bookingData, professionalName: '<b>Juan</b>' })
    expect(html).not.toContain('<b>Juan</b>')
    expect(html).toContain('&lt;b&gt;Juan&lt;/b&gt;')
  })
})

describe('la reprogramada al negocio', () => {
  it('también dice quién atiende', () => {
    const html = ownerBookingChangedHtml({
      ...ownerChangedData,
      professionalName: 'Juan Pérez',
      change: {
        kind: 'rescheduled',
        previousStartDateTime: new Date('2026-08-15T18:00:00Z'),
        newStartDateTime: new Date('2026-08-16T19:30:00Z'),
      },
    })
    expect(html).toContain('Atiende')
    expect(html).toContain('Juan Pérez')
  })
})
