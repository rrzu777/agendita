import { describe, it, expect } from 'vitest'
import {
  transferReactivatedCustomerHtml, transferReactivatedCustomerText,
  bankTransferExpiredCustomerHtml,
} from '@/lib/notifications/templates'

const bt = { accountHolder: 'Ana', rut: '1-1', bankName: 'X', accountType: 'corriente', accountNumber: '123', email: null, instructions: null, deadline: new Date('2026-07-15T18:00:00Z'), confirmationUrl: 'https://x/book/confirmation?bookingId=b1' }
const data = { businessName: 'Bella', businessTimezone: 'America/Santiago', customerName: 'Ana', serviceName: 'Corte', depositAmount: 8000, businessCurrency: 'CLP', bankTransfer: bt, bookingNumber: 4738 as number | null }

describe('transfer reactivated templates', () => {
  it('reactivada: aviso + datos bancarios + link', () => {
    const html = transferReactivatedCustomerHtml(data)
    expect(html).toContain('reactiv')
    expect(html).toContain('123')
    expect(html).toContain(bt.confirmationUrl)
    expect(transferReactivatedCustomerText(data)).toContain(bt.confirmationUrl)
  })
  it('email de expirada menciona que el negocio puede reactivarla', () => {
    const html = bankTransferExpiredCustomerHtml({
      businessName: 'Bella', businessTimezone: 'America/Santiago', customerName: 'Ana',
      serviceName: 'Corte', startDateTime: new Date('2026-07-15T18:00:00Z'), bookingNumber: 1,
    })
    expect(html).toContain('reactivar')
  })
})
