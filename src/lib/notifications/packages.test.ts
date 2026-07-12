import { describe, it, expect } from 'vitest'
import {
  packagePurchasedCustomerHtml, packagePurchasedCustomerText,
  packageSoldBusinessHtml, packageSoldBusinessText,
} from './templates'

const data = {
  businessName: 'Studio Ana', customerName: 'Ana', productName: 'Pack 5 sesiones',
  totalSessions: 6, pricePaid: 50000, businessCurrency: 'CLP', cardLink: 'https://app/mi/demo',
}

describe('templates de paquete', () => {
  it('customer html incluye producto, sesiones y link', () => {
    const html = packagePurchasedCustomerHtml(data)
    expect(html).toContain('Pack 5 sesiones')
    expect(html).toContain('6')
    expect(html).toContain('https://app/mi/demo')
  })
  it('customer text incluye producto', () => {
    expect(packagePurchasedCustomerText(data)).toContain('Pack 5 sesiones')
  })
  it('business html incluye clienta y producto', () => {
    const html = packageSoldBusinessHtml({ ...data })
    expect(html).toContain('Ana')
    expect(html).toContain('Pack 5 sesiones')
  })
  it('business text incluye clienta', () => {
    expect(packageSoldBusinessText({ ...data })).toContain('Ana')
  })
})
