import { describe, it, expect } from 'vitest'
import {
  transferReminderCustomerHtml, transferReminderCustomerText,
  transferReminderBusinessHtml, transferReminderBusinessText,
} from '@/lib/notifications/templates'

const bt = { accountHolder: 'Ana', rut: '1-1', bankName: 'X', accountType: 'corriente', accountNumber: '123', email: null, instructions: null, deadline: new Date('2026-07-15T18:00:00Z'), confirmationUrl: 'https://x/book/confirmation?bookingId=b1' }
const cust = { businessName: 'Bella', businessTimezone: 'America/Santiago', customerName: 'Ana', serviceName: 'Corte', depositLabel: '$8.000 CLP', bankTransfer: bt, bookingNumber: 4738 as number | null }
const biz = { businessName: 'Bella', customerName: 'Ana', serviceName: 'Corte', dashboardUrl: 'https://x/dashboard/bookings', bookingNumber: 4738 as number | null }

describe('transfer reminder templates', () => {
  it('clienta: pocas horas + datos + link', () => {
    const html = transferReminderCustomerHtml(cust)
    expect(html).toContain('pocas horas'); expect(html).toContain('123'); expect(html).toContain(bt.confirmationUrl)
    expect(transferReminderCustomerText(cust)).toContain(bt.confirmationUrl)
  })
  it('dueña: por verificar + link dashboard', () => {
    const html = transferReminderBusinessHtml(biz)
    expect(html).toContain('por verificar'); expect(html).toContain(biz.dashboardUrl)
    expect(transferReminderBusinessText(biz)).toContain('Bella')
  })
})
