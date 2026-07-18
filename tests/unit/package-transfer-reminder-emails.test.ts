import { describe, it, expect } from 'vitest'
import {
  packageTransferReminderCustomerHtml,
  packageTransferReminderCustomerText,
  packageTransferUnverifiedBusinessHtml,
  packageTransferUnverifiedBusinessText,
} from '@/lib/notifications/templates'

const bankTransfer = {
  accountHolder: 'Estudio Luna', rut: '11.111.111-1', bankName: 'Banco Estado', accountType: 'corriente',
  accountNumber: '123456', email: null, instructions: null,
  deadline: new Date('2026-07-18T12:00:00Z'), confirmationUrl: 'https://luna.agendita.cl/paquetes/confirmation?purchaseId=pp1',
}
const customerData = {
  businessName: 'Estudio Luna', businessTimezone: 'America/Santiago', customerName: 'Ana',
  productName: 'Pack 5 sesiones', amount: 50000, businessCurrency: 'CLP', bankTransfer,
}

describe('templates de recordatorio de transferencia de paquete', () => {
  it('clienta: html con producto, datos bancarios y link de retorno', () => {
    const html = packageTransferReminderCustomerHtml(customerData)
    expect(html).toContain('Pack 5 sesiones')
    expect(html).toContain('123456')
    expect(html).toContain('purchaseId=pp1')
  })
  it('clienta: text con el link', () => {
    expect(packageTransferReminderCustomerText(customerData)).toContain('purchaseId=pp1')
  })
  it('dueña: html con clienta, producto y link al dashboard', () => {
    const html = packageTransferUnverifiedBusinessHtml({
      businessName: 'Estudio Luna', customerName: 'Ana', productName: 'Pack 5 sesiones', dashboardUrl: 'https://app/dashboard',
    })
    expect(html).toContain('Ana')
    expect(html).toContain('Pack 5 sesiones')
    expect(html).toContain('https://app/dashboard')
  })
  it('dueña: text', () => {
    expect(packageTransferUnverifiedBusinessText({
      businessName: 'Estudio Luna', customerName: 'Ana', productName: 'Pack 5 sesiones', dashboardUrl: 'https://app/dashboard',
    })).toContain('Pack 5 sesiones')
  })
})
