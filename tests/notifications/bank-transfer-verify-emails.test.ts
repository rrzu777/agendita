import { describe, it, expect } from 'vitest'
import {
  bankTransferRejectedCustomerHtml, bankTransferRejectedCustomerText,
  bankTransferExpiredCustomerHtml, bankTransferExpiredCustomerText,
} from '@/lib/notifications/templates'

const base = {
  businessName: 'Studio Bella', businessTimezone: 'America/Santiago',
  customerName: 'Ana', serviceName: 'Corte', startDateTime: new Date('2026-07-15T14:00:00Z'),
  bookingNumber: 4738 as number | null,
}

describe('bank transfer verify emails', () => {
  it('rejected mentions the reason and contacting the business', () => {
    const html = bankTransferRejectedCustomerHtml(base)
    expect(html).toContain('Ana')
    expect(html).toContain('no pudo verificar')
    expect(bankTransferRejectedCustomerText(base)).toContain('Corte')
  })
  it('expired tells the customer the hold lapsed', () => {
    const html = bankTransferExpiredCustomerHtml(base)
    expect(html).toContain('expiró')
    expect(bankTransferExpiredCustomerText(base)).toContain('Studio Bella')
  })
})
