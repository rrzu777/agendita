import { describe, it, expect } from 'vitest'
import { bookingDisputedBusinessHtml, bookingDisputedBusinessText } from '@/lib/notifications/templates'

const DATA = {
  businessName: 'Estudio Mimo', customerName: 'Caro P', serviceName: 'Manicure',
  bookingLabel: '#4738', startDateTime: new Date('2026-07-20T15:00:00Z'),
  businessTimezone: 'America/Santiago', amount: 8000, businessCurrency: 'CLP',
}

describe('BookingDisputed templates', () => {
  it('html incluye clienta, servicio, número, monto y aviso de contracargo', () => {
    const html = bookingDisputedBusinessHtml(DATA)
    expect(html).toContain('Contracargo')
    expect(html).toContain('Caro P')
    expect(html).toContain('Manicure')
    expect(html).toContain('#4738')
    expect(html).toContain('8.000')
  })
  it('text plano incluye lo mismo', () => {
    const text = bookingDisputedBusinessText(DATA)
    expect(text).toContain('Caro P')
    expect(text).toContain('#4738')
  })
})
