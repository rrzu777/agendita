import { describe, it, expect } from 'vitest'
import {
  bookingConfirmationCustomerHtml,
  bookingConfirmationCustomerText,
  bookingReceivedCustomerHtml,
  bookingReceivedCustomerText,
  newBookingBusinessHtml,
  newBookingBusinessText,
  bookingReminderHtml,
  bookingReminderText,
} from '@/lib/notifications/templates'
import {
  buildBookingConfirmationWhatsappMessage,
  buildWhatsappReminderMessage,
} from '@/lib/notifications/whatsapp'

const start = new Date('2026-08-01T15:00:00Z')

const emailBase = {
  businessName: 'Biz',
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  customerName: 'Ana',
  customerPhone: '+56911111111',
  serviceName: 'Corte',
  startDateTime: start,
  totalPrice: 20000,
  depositRequired: 10000,
  depositPaid: 10000,
  remainingBalance: 10000,
}

const businessBase = {
  businessName: 'Biz',
  customerName: 'Ana',
  customerPhone: '+56911111111',
  serviceName: 'Corte',
  startDateTime: start,
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  depositRequired: 10000,
  remainingBalance: 10000,
  dashboardLink: 'https://x.test/dashboard/bookings',
}

const reminderBase = {
  businessName: 'Biz',
  customerName: 'Ana',
  customerEmail: 'ana@test.com',
  serviceName: 'Corte',
  startDateTime: start,
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  totalPrice: 20000,
  remainingBalance: 10000,
  depositPaid: 10000,
}

const whatsappBase = {
  customerName: 'Ana',
  customerPhone: '+56911111111',
  serviceName: 'Corte',
  startDateTime: start,
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  totalPrice: 20000,
  depositPaid: 10000,
  remainingBalance: 10000,
}

describe('booking number in notifications', () => {
  it('email confirmation includes #number when present and omits when absent', () => {
    expect(bookingConfirmationCustomerHtml({ ...emailBase, bookingNumber: 4738 })).toContain('#4738')
    expect(bookingConfirmationCustomerText({ ...emailBase, bookingNumber: 4738 })).toContain('Reserva: #4738')
    expect(bookingConfirmationCustomerHtml({ ...emailBase })).not.toContain('Reserva</td>')
    expect(bookingConfirmationCustomerText({ ...emailBase })).not.toContain('Reserva: #')
  })

  it('email received includes #number', () => {
    expect(bookingReceivedCustomerHtml({ ...emailBase, bookingNumber: 4738 })).toContain('#4738')
    expect(bookingReceivedCustomerText({ ...emailBase, bookingNumber: 4738 })).toContain('Reserva: #4738')
  })

  it('business notification includes #number', () => {
    expect(newBookingBusinessHtml({ ...businessBase, bookingNumber: 4738 })).toContain('#4738')
    expect(newBookingBusinessText({ ...businessBase, bookingNumber: 4738 })).toContain('Reserva: #4738')
  })

  it('reminder includes #number', () => {
    expect(bookingReminderHtml({ ...reminderBase, bookingNumber: 4738 })).toContain('#4738')
    expect(bookingReminderText({ ...reminderBase, bookingNumber: 4738 })).toContain('Reserva #4738')
  })

  it('whatsapp confirmation + reminder include #number when present, omit when absent', () => {
    expect(buildBookingConfirmationWhatsappMessage({ ...whatsappBase, bookingNumber: 4738 })).toContain('Reserva #4738')
    expect(buildWhatsappReminderMessage({ ...whatsappBase, bookingNumber: 4738 })).toContain('Reserva #4738')
    expect(buildBookingConfirmationWhatsappMessage({ ...whatsappBase })).not.toContain('Reserva #')
  })
})
