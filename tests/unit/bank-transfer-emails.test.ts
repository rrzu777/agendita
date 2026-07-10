import { describe, it, expect } from 'vitest'
import {
  bookingReceivedCustomerHtml,
  bookingReceivedCustomerText,
  bankTransferDeclaredBusinessHtml,
  bankTransferDeclaredBusinessText,
} from '@/lib/notifications/templates'

const base = {
  businessName: 'Studio X',
  businessTimezone: 'America/Santiago',
  businessCurrency: 'CLP',
  customerName: 'Ana',
  customerPhone: '56911100001',
  serviceName: 'Corte',
  startDateTime: new Date('2026-08-01T15:00:00Z'),
  totalPrice: 20000,
  depositRequired: 5000,
  depositPaid: 0,
  remainingBalance: 20000,
}

describe('emails de transferencia', () => {
  it('reserva recibida SIN bankTransfer: no menciona datos bancarios', () => {
    const html = bookingReceivedCustomerHtml(base)
    expect(html).not.toContain('Datos para transferir')
  })

  it('reserva recibida CON bankTransfer: datos completos + plazo + link', () => {
    const data = {
      ...base,
      bankTransfer: {
        accountHolder: 'María P', rut: '1-9', bankName: 'BancoEstado', accountType: 'vista',
        accountNumber: '12345678', email: 'm@e.cl', instructions: 'poné tu nombre',
        deadline: new Date('2026-07-11T15:00:00Z'),
        confirmationUrl: 'https://x.agendita.cl/book/confirmation?bookingId=abc',
      },
    }
    const html = bookingReceivedCustomerHtml(data)
    const text = bookingReceivedCustomerText(data)
    for (const out of [html, text]) {
      expect(out).toContain('Datos para transferir')
      expect(out).toContain('BancoEstado')
      expect(out).toContain('12345678')
      expect(out).toContain('Ya transfer')
      expect(out).toContain('bookingId=abc')
      expect(out).toContain('poné tu nombre')
    }
  })

  it('declaró transferencia (dueña): monto, clienta y servicio en ambos formatos', () => {
    const data = {
      businessName: 'Studio X', businessTimezone: 'America/Santiago',
      customerName: 'Ana', serviceName: 'Corte', startDateTime: new Date('2026-08-01T15:00:00Z'),
      amount: 5000, currency: 'CLP', bookingNumber: 4738,
    }
    const text = bankTransferDeclaredBusinessText(data)
    expect(text).toContain('Ana')
    expect(text).toContain('#4738')
    expect(text).toContain('5.000')
    const html = bankTransferDeclaredBusinessHtml(data)
    expect(html).toContain('Ana')
    expect(html).toContain('#4738')
    expect(html).toContain('Corte')
  })
})
