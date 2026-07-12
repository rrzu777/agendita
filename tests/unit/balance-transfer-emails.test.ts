import { describe, it, expect } from 'vitest'
import {
  balanceTransferDeclaredBusinessHtml, balanceTransferDeclaredBusinessText,
  balanceTransferVerifiedCustomerHtml, balanceTransferVerifiedCustomerText,
  balanceTransferRejectedCustomerHtml, balanceTransferRejectedCustomerText,
} from '@/lib/notifications/templates'

const declared = {
  businessName: 'Bella', businessTimezone: 'America/Santiago', customerName: 'Ana',
  serviceName: 'Corte', startDateTime: new Date('2026-07-15T18:00:00Z'),
  amount: 12000, currency: 'CLP', bookingNumber: 4738 as number | null,
}
const verified = { ...declared, customerEmail: 'ana@x.cl', businessReplyToEmail: null }

describe('balance transfer templates', () => {
  it('declarado-saldo dueña: menciona saldo y monto, no "abono"', () => {
    const html = balanceTransferDeclaredBusinessHtml(declared)
    const text = balanceTransferDeclaredBusinessText(declared)
    expect(html.toLowerCase()).toContain('saldo')
    expect(html).toContain('12.000')
    expect(text.toLowerCase()).toContain('saldo')
    // el copy de saldo no debe reintroducir "abono" por un copy-paste del hermano
    expect(html.toLowerCase()).not.toContain('abono')
    expect(text.toLowerCase()).not.toContain('abono')
  })
  it('verificado-saldo clienta: confirma recepción del pago con monto', () => {
    const html = balanceTransferVerifiedCustomerHtml(verified)
    expect(html.toLowerCase()).toContain('saldo')
    expect(html).toContain('12.000')
    expect(balanceTransferVerifiedCustomerText(verified).toLowerCase()).toContain('saldo')
  })
  it('rechazado-saldo clienta: NO menciona cancelación de la reserva', () => {
    const html = balanceTransferRejectedCustomerHtml(verified)
    const text = balanceTransferRejectedCustomerText(verified)
    expect(html.toLowerCase()).toContain('saldo')
    expect(html.toLowerCase()).not.toContain('cancelad')
    expect(text.toLowerCase()).not.toContain('cancelad')
  })
})
